// Assistant client (HANDOFF.md 4.7, Phase 3). Requests go to apps/api, which runs Claude's tool
// loop on a copy of the song and returns the edits that succeeded; they are replayed here through
// the same tools as one undo step. Inside claude.ai (and in the ported prototype tests) the
// artifact runtime's `sample` capability can drive the tools directly instead.
import type { AssistantResponse, Tier } from "@thk/api";
import {
  OFFER_RESULT,
  RULES,
  TOOLS,
  dryRunVariations,
  parseVariations,
  stateText,
  type AssistantTool,
  type EditTool,
  type Song,
} from "@thk/song";
import { merge, push, record, type Command } from "./history.ts";
import {
  addGroup,
  addMsg,
  get,
  replaceSong,
  setSongQuiet,
  setState,
  settlePending,
  undo,
  updateMsg,
  type ChatAction,
} from "./store.ts";

export interface SamplerTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, ctx?: { signal: AbortSignal }) => Promise<string> | string;
}
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface SampleOptions {
  signal: AbortSignal;
  tools: SamplerTool[];
  modelTier: string;
  onText?: (p: { text: string; delta?: string }) => void;
}
export interface Sampler {
  (input: ChatTurn[], opts: SampleOptions): Promise<{ text: string; truncated?: boolean }>;
  limits?: () => Promise<{ tools?: unknown }>;
}
interface ClaudeRuntime {
  use: (name: string) => Promise<unknown>;
}

let backend: { kind: "api" } | { kind: "sampler"; sampler: Sampler } | null = null;
let abort: AbortController | null = null;
const chatTurns: ChatTurn[] = [];

const NO_KEY =
  "The assistant needs an Anthropic API key. Put ANTHROPIC_API_KEY=… in .env.local in the project folder, then restart the studio. Groove presets and 3 variations in the piano roll work without it.";
const NO_SERVER =
  "The assistant's server isn't running. Start the studio with `corepack pnpm dev` (it starts both). Groove presets and 3 variations still work.";
const NO_EDIT = "This view can't let the assistant edit the song. Groove presets and 3 variations still work.";

function disable(note?: string) {
  setState((s) => ({ ai: { ...s.ai, available: false } }));
  if (note) addMsg({ kind: "bot", who: "Studio", text: note });
}

/** Picks the backend: the API when it has a key, else the claude.ai runtime, else explains what's missing. */
export async function initAssistant() {
  let status: { configured?: boolean } | null = null;
  try {
    const r = await fetch("/api/assistant/status");
    status = r.ok ? ((await r.json()) as { configured?: boolean }) : null;
  } catch {
    status = null;
  }
  if (status?.configured) {
    backend = { kind: "api" };
    setState((s) => ({ ai: { ...s.ai, available: true } }));
    return;
  }
  const rt = (window as unknown as { claude?: ClaudeRuntime }).claude;
  const s = rt?.use ? ((await rt.use("sample").catch(() => null)) as Sampler | null) : null;
  if (s) {
    let tools = false;
    try {
      tools = !!(await s.limits?.())?.tools;
    } catch {
      /* treated as no tool support */
    }
    if (!tools) return disable(NO_EDIT);
    backend = { kind: "sampler", sampler: s };
    setState((st) => ({ ai: { ...st.ai, available: true } }));
    return;
  }
  disable(status ? NO_KEY : NO_SERVER);
}

interface CodedError {
  code?: string;
  text?: string;
}
function errorCopy(e: CodedError | undefined): string {
  switch (e?.code) {
    case "cancelled":
      return "Stopped.";
    case "not_configured":
      disable(NO_KEY);
      return "No API key on the server.";
    case "auth":
      return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local, then restart the studio.";
    case "not_signed_in":
      return "Sign in to your Claude account first: run `claude auth login` in Terminal, then ask again.";
    case "not_granted":
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
    case "capability_removed":
      disable(
        "The assistant isn't allowed to use Claude in this view. Groove presets and 3 variations in the piano roll still work.",
      );
      return "Claude isn't available here.";
    case "tools_unavailable":
      disable(NO_EDIT);
      return "Editing isn't available here.";
    case "rate_limited":
      return "Claude is busy or you've reached a usage limit. Try again in a little while.";
    case "refused":
      return "Claude declined that request. Try asking another way.";
    case "prompt_too_large":
      return "The song is too big to send in one go. Ask about fewer tracks or bars.";
    case "empty_completion":
      return "No answer came back. Try rephrasing.";
    default:
      return "The connection to Claude dropped. Try again.";
  }
}

const action = (id: string, a: ChatAction) => updateMsg(id, (m) => ({ actions: [...m.actions, a] }));
const editTool = (name: string) => TOOLS.find((t) => t.name === name && t.kind === "edit") as EditTool | undefined;
type Turn = { before: Song | null; cmds: Command[] };

/** Applies one edit to the live song (no history yet); a failure leaves the song unchanged and throws. */
function applyEdit(turn: Turn, tool: EditTool, input: Record<string, unknown>) {
  settlePending();
  const song = get().song;
  turn.before ??= song;
  const { next, cmd, result } = record(song, tool.name, (d) => tool.run(d, input));
  if (cmd) {
    setSongQuiet(next, result.trackId ? { tid: result.trackId, cid: result.clipId ?? null } : undefined);
    turn.cmds.push(cmd);
  }
  return result.summary;
}

/** Tools for the claude.ai sampler: each edit applies immediately; all of them become one undo step. */
function bindTools(botId: string, turn: Turn): SamplerTool[] {
  return TOOLS.map((t: AssistantTool) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    execute:
      t.kind === "edit"
        ? (input: unknown) => {
            try {
              const summary = applyEdit(turn, t, (input ?? {}) as Record<string, unknown>);
              action(botId, { text: summary });
              return summary;
            } catch (e) {
              action(botId, { text: (e as Error).message, err: true });
              throw e;
            }
          }
        : (input: unknown) => {
            const { title, specs } = parseVariations((input ?? {}) as Record<string, unknown>);
            dryRunVariations(get().song, specs);
            const gid = addGroup(title, specs);
            updateMsg(botId, (m) => ({ groupIds: [...(m.groupIds ?? []), gid] }));
            action(botId, { text: `Offered ${specs.length} variations` });
            return OFFER_RESULT(specs.length);
          },
  }));
}

/** Asks the API, then replays its edits in order and shows its variations. Returns the reply text. */
async function viaApi(text: string, tier: string, botId: string, turn: Turn, signal: AbortSignal): Promise<string> {
  const { song, sel } = get();
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ song, sel, request: text, history: chatTurns.slice(-8), tier: tier as Tier }),
    signal,
  });
  if (!res.ok) throw (await res.json().catch(() => ({}))) as CodedError;
  const out = (await res.json()) as AssistantResponse;
  let edit = 0,
    offer = 0;
  for (const step of out.steps) {
    if (!step.ok) {
      action(botId, { text: step.text, err: true });
    } else if (step.tool === "offer_variations") {
      const v = out.variations[offer++];
      if (!v) continue;
      const gid = addGroup(v.title, v.specs);
      updateMsg(botId, (m) => ({ groupIds: [...(m.groupIds ?? []), gid] }));
      action(botId, { text: `Offered ${v.specs.length} variations` });
    } else {
      const e = out.edits[edit++],
        tool = e && editTool(e.tool);
      if (!e || !tool) continue;
      try {
        action(botId, { text: applyEdit(turn, tool, e.input) });
      } catch (err) {
        action(botId, { text: "Couldn't apply here: " + (err as Error).message, err: true });
      }
    }
  }
  if (out.stop === "refused") action(botId, { text: errorCopy({ code: "refused" }), err: true });
  if (out.stop === "max_tokens")
    action(botId, { text: "The answer was cut short. Ask for less at a time.", err: true });
  if (out.stop === "rounds")
    action(botId, { text: "Stopped after too many steps. Ask for less at a time.", err: true });
  return out.text;
}

export async function sendPrompt(raw: string, modelTier = "quick") {
  const text = raw.trim(),
    st = get();
  if (!text || !backend || st.ai.busy || !st.ai.available) return;
  addMsg({ kind: "user", text });
  const botId = addMsg({ kind: "bot", text: "Thinking…", thinking: true });
  const ctl = new AbortController(),
    turn: Turn = { before: null, cmds: [] };
  abort = ctl;
  setState((s) => ({ ai: { ...s.ai, busy: true } }));
  try {
    let reply: string;
    if (backend.kind === "api") reply = await viaApi(text, modelTier, botId, turn, ctl.signal);
    else {
      const input: ChatTurn[] = [
        { role: "user", content: RULES },
        ...chatTurns.slice(-8),
        { role: "user", content: `Current song state:\n${stateText(get().song, get().sel)}\n\nRequest: ${text}` },
      ];
      const res = await backend.sampler(input, {
        signal: ctl.signal,
        tools: bindTools(botId, turn),
        modelTier,
        onText: ({ text: t }) => updateMsg(botId, { text: t, thinking: false }),
      });
      if (res.truncated) action(botId, { text: "The answer was cut short. Ask for less at a time.", err: true });
      reply = res.text;
    }
    updateMsg(botId, { text: reply, thinking: false });
    chatTurns.push(
      { role: "user", content: text },
      { role: "assistant", content: reply.slice(0, 1500) || "(no reply)" },
    );
  } catch (err) {
    const e = (ctl.signal.aborted ? { code: "cancelled" } : err) as CodedError;
    updateMsg(botId, { text: e?.text && e.code !== "refused" ? e.text : "", thinking: false });
    action(botId, { text: errorCopy(e), err: e?.code !== "cancelled" });
    chatTurns.push({ role: "user", content: text }, { role: "assistant", content: "(failed)" });
  } finally {
    abort = null;
    setState((s) => ({ ai: { ...s.ai, busy: false } }));
    if (turn.before && turn.cmds.length) {
      const cmd = merge(`Assistant: ${text.slice(0, 40)}`, turn.cmds);
      setState((s) => ({ history: push(s.history, cmd) }));
      updateMsg(botId, { undo: { before: turn.before, cmd, done: false } });
    }
  }
}

export function stopPrompt() {
  abort?.abort();
}

/** "Undo these changes": undo the turn if it is the latest step, else restore the song from before it. */
export function undoTurn(msgId: string) {
  const m = get().chat.find((x) => x.id === msgId);
  if (!m?.undo || m.undo.done) return;
  const { past } = get().history;
  if (past[past.length - 1] === m.undo.cmd) undo();
  else replaceSong(m.undo.before, "Undo assistant changes");
  updateMsg(msgId, { undo: { ...m.undo, done: true } });
}
