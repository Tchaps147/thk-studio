// The assistant's tool loop, run on the server (HANDOFF.md Phase 3). Claude edits a copy of the
// song through the same six tools as the prototype; the client gets back the edits that succeeded
// (it replays them as one undo step) and any variations to show as Try / Keep cards.
import Anthropic from "@anthropic-ai/sdk";
import {
  OFFER_RESULT,
  PatternError,
  RULES,
  TOOLS,
  dryRunVariations,
  parseVariations,
  stateText,
  type Selection,
  type Song,
  type VariationSpec,
} from "@thk/song";

export const MODEL = "claude-opus-5-5";
/** "quick" answers in seconds; "default" thinks longer and writes more musical parts. */
export const EFFORT = { quick: "low", default: "high" } as const;
export type Tier = keyof typeof EFFORT;
export type AssistantProvider = "auto" | "claude" | "chatgpt";
const MAX_ROUNDS = 12;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface AssistantRequest {
  song: Song;
  sel?: Selection;
  request: string;
  /** Earlier turns, plain text; the last 8 are sent. */
  history?: ChatTurn[];
  tier?: Tier;
  provider?: AssistantProvider;
}
export interface Step {
  tool: string;
  ok: boolean;
  /** Summary on success, the error on failure. */
  text: string;
}
/** An empty response to fill in (both backends). */
export const emptyResponse = (): AssistantResponse => ({
  text: "",
  steps: [],
  edits: [],
  variations: [],
  stop: "done",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

/** The request as a user message: song state plus the ask. */
export const userPrompt = (req: AssistantRequest, song: Song) =>
  `Current song state:\n${stateText(song, req.sel)}\n\nRequest: ${req.request}`;

export interface AssistantResponse {
  provider?: "claude" | "chatgpt";
  model?: string;
  fallback?: { from: "claude"; code: string };
  text: string;
  /** Every tool call, in order, with its outcome (shown under the reply). */
  steps: Step[];
  /** Edits that succeeded, in order; the client replays them as one undo step. */
  edits: { tool: string; input: Record<string, unknown> }[];
  variations: { title: string; specs: VariationSpec[] }[];
  /** "refused": Claude declined; "max_tokens": the answer was cut short. */
  stop: "done" | "refused" | "max_tokens" | "rounds";
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** The part of the SDK client the loop uses, so tests can script responses. */
export type CreateMessage = (
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
) => Promise<Anthropic.Beta.Messages.BetaMessage>;

export const sdkCreate =
  (client: Anthropic): CreateMessage =>
  (params, options) =>
    client.beta.messages.create(params, options);

const TOOL_DEFS: Anthropic.Beta.Messages.BetaTool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
}));

export async function runAssistant(
  req: AssistantRequest,
  create: CreateMessage,
  signal?: AbortSignal,
): Promise<AssistantResponse> {
  const song = structuredClone(req.song);
  const out = emptyResponse();
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    ...(req.history ?? []).slice(-8),
    { role: "user", content: userPrompt(req, song) },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const msg = await create(
      {
        model: MODEL,
        max_tokens: 16000,
        // Rules + catalog are identical on every request: cache tools and system together.
        system: [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }],
        tools: TOOL_DEFS,
        messages,
        output_config: { effort: EFFORT[req.tier ?? "quick"] },
        // On a policy decline, retry server-side on Anthropic's recommended fallback model.
        fallbacks: "default",
        betas: ["server-side-fallback-2026-07-01"],
      },
      { signal },
    );
    const u = msg.usage;
    out.usage.input += u.input_tokens;
    out.usage.output += u.output_tokens;
    out.usage.cacheRead += u.cache_read_input_tokens ?? 0;
    out.usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
    const text = msg.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (text) out.text = text;

    if (msg.stop_reason === "refusal") {
      out.stop = "refused";
      return out;
    }
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    const uses = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason === "max_tokens") {
      // A tool input cut off here may be partial: don't run it.
      out.stop = "max_tokens";
      return out;
    }
    if (!uses.length) return out;

    messages.push({ role: "assistant", content: msg.content });
    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = uses.map((use) => {
      const r = runTool(song, use.name, (use.input ?? {}) as Record<string, unknown>, out);
      return { type: "tool_result", tool_use_id: use.id, content: r.text, ...(r.ok ? {} : { is_error: true }) };
    });
    messages.push({ role: "user", content: results });
  }
  out.stop = "rounds";
  return out;
}

/** Runs one tool against the server's copy of the song. A failed edit leaves the copy unchanged. */
export function runTool(song: Song, name: string, input: Record<string, unknown>, out: AssistantResponse): Step {
  const tool = TOOLS.find((t) => t.name === name);
  let step: Step;
  try {
    if (!tool) throw new PatternError(`Unknown tool "${name}".`);
    if (tool.kind === "offer") {
      const v = parseVariations(input);
      dryRunVariations(song, v.specs);
      out.variations.push(v);
      step = { tool: name, ok: true, text: OFFER_RESULT(v.specs.length) };
    } else {
      const draft = structuredClone(song);
      const r = tool.run(draft, input);
      Object.assign(song, draft);
      out.edits.push({ tool: name, input });
      step = { tool: name, ok: true, text: r.summary };
    }
  } catch (e) {
    if (!(e instanceof PatternError) && !(e instanceof Error)) throw e;
    step = { tool: name, ok: false, text: e.message };
  }
  out.steps.push(step);
  return step;
}
