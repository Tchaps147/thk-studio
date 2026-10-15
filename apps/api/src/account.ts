// The assistant on the user's own Claude account (subscription), through the Claude Agent SDK.
// It signs in the way Claude Code does on this machine, so no API key is needed. For personal use
// only: an app other people use must call the API with a key (assistant.ts).
//
// Claude gets exactly the six studio tools (no files, shell or web) on an in-process MCP server;
// each tool runs against the server's copy of the song through the same runTool() as the API path.
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { RULES, TOOLS } from "@thk/song";
import { z } from "zod";
import {
  EFFORT,
  MODEL,
  emptyResponse,
  runTool,
  userPrompt,
  type AssistantRequest,
  type AssistantResponse,
} from "./assistant.ts";

type Json = { type?: string; enum?: unknown[]; items?: Json; properties?: Record<string, Json>; required?: string[]; description?: string; minimum?: number; maximum?: number }; // prettier-ignore

/** JSON Schema (the subset the studio tools use) -> Zod, so the tool definitions stay in one place. */
function toZod(s: Json): z.ZodType {
  let t: z.ZodType;
  if (s.enum?.every((v) => typeof v === "string")) t = z.enum(s.enum as [string, ...string[]]);
  else if (s.enum)
    t = z.union(s.enum.map((v) => z.literal(v as number)) as [z.ZodLiteral, z.ZodLiteral, ...z.ZodLiteral[]]);
  else if (s.type === "string") t = z.string();
  else if (s.type === "integer" || s.type === "number") {
    let n = s.type === "integer" ? z.number().int() : z.number();
    if (s.minimum != null) n = n.min(s.minimum);
    if (s.maximum != null) n = n.max(s.maximum);
    t = n;
  } else if (s.type === "boolean") t = z.boolean();
  else if (s.type === "array") t = z.array(s.items ? toZod(s.items) : z.unknown());
  else if (s.type === "object") t = z.object(shape(s));
  else t = z.unknown();
  return s.description ? t.describe(s.description) : t;
}
function shape(s: Json): Record<string, z.ZodType> {
  const req = new Set(s.required ?? []);
  return Object.fromEntries(
    Object.entries(s.properties ?? {}).map(([k, v]) => [k, req.has(k) ? toZod(v) : toZod(v).optional()]),
  );
}

const SERVER = "studio";

/** Turns an Agent SDK failure into the codes the client shows as plain copy. */
export class AccountError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
const ERROR_CODES: Record<string, string> = {
  rate_limit: "rate_limited",
  overloaded: "rate_limited",
  authentication_failed: "not_signed_in",
  billing_error: "not_signed_in",
};

export async function runOnAccount(req: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
  const song = structuredClone(req.song);
  const out = emptyResponse();
  const server = createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    alwaysLoad: true,
    tools: TOOLS.map((t) =>
      tool(t.name, t.description, shape(t.inputSchema as Json), async (args) => {
        const step = runTool(song, t.name, args as Record<string, unknown>, out);
        return { content: [{ type: "text" as const, text: step.text }], ...(step.ok ? {} : { isError: true }) };
      }),
    ),
  });
  const history = (req.history ?? [])
    .slice(-8)
    .map((h) => `${h.role === "user" ? "User" : "You"}: ${h.content}`)
    .join("\n");
  const abortController = new AbortController();
  signal?.addEventListener("abort", () => abortController.abort());

  for await (const msg of query({
    prompt: (history ? `Earlier in this conversation:\n${history}\n\n` : "") + userPrompt(req, song),
    options: {
      model: MODEL,
      effort: EFFORT[req.tier ?? "quick"],
      systemPrompt: RULES,
      tools: [], // no built-in tools: only the studio's
      mcpServers: { [SERVER]: server },
      // Only the studio server: without this the CLI also loads the account's claude.ai connectors
      // (Gmail, Drive, ...), which added ~145k tokens of tool schemas from the second turn on.
      strictMcpConfig: true,
      allowedTools: TOOLS.map((t) => `mcp__${SERVER}__${t.name}`),
      settingSources: [], // ignore CLAUDE.md files and user settings
      persistSession: false,
      maxTurns: 12,
      abortController,
    },
  })) {
    if (msg.type === "assistant") {
      if (msg.error) throw new AccountError(ERROR_CODES[msg.error] ?? "server", msg.error);
      const text = msg.message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("")
        .trim();
      if (text) out.text = text;
      if (msg.message.stop_reason === "refusal") out.stop = "refused";
    } else if (msg.type === "result") {
      out.usage = {
        input: msg.usage.input_tokens,
        output: msg.usage.output_tokens,
        cacheRead: msg.usage.cache_read_input_tokens,
        cacheWrite: msg.usage.cache_creation_input_tokens,
      };
      if (msg.subtype === "success") out.text = msg.result.trim() || out.text;
      else if (msg.subtype === "error_max_turns") out.stop = "rounds";
      else throw new AccountError("server", msg.subtype);
    }
  }
  return out;
}
