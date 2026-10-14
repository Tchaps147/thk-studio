// HTTP server for the assistant. Dev and preview proxy /api here (apps/web/vite.config.ts).
//
//   POST /api/assistant         body: AssistantRequest -> AssistantResponse
//   GET  /api/assistant/status  { configured: boolean, model }
//
// Two ways to reach Claude:
// - "account" (default): the user's own Claude account through the Agent SDK, signed in the way
//   Claude Code is on this machine. Personal use only.
// - "api": ANTHROPIC_API_KEY from the environment or .env.local (git-ignored). Used when a key is
//   set, or forced with THK_ASSISTANT=api.
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { validSong } from "@thk/song";
import { AccountError, runOnAccount } from "./account.ts";
import { MODEL, runAssistant, sdkCreate, type AssistantRequest } from "./assistant.ts";

const ROOT = join(import.meta.dirname, "../../..");
const envFile = join(ROOT, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const PORT = Number(process.env.THK_API_PORT ?? 5191);
const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const mode = (): "api" | "account" =>
  process.env.THK_ASSISTANT === "api" || (hasKey() && process.env.THK_ASSISTANT !== "account") ? "api" : "account";
const configured = () => mode() === "account" || hasKey();
let client: Anthropic | null = null;

// Per-client rate limit: 30 requests per 10 minutes.
const WINDOW_MS = 10 * 60 * 1000,
  LIMIT = 30;
const hits = new Map<string, number[]>();
function allow(key: string): boolean {
  const now = Date.now(),
    recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// Running cost tally for this process (Claude Opus 5.5: $4 / $20 per MTok, cache reads $0.20).
const spend = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const dollars = () => (spend.input * 4 + spend.cacheWrite * 5 + spend.cacheRead * 0.2 + spend.output * 20) / 1e6;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error("body too large");
  }
  return JSON.parse(raw);
}

/** Maps SDK errors to the codes the client turns into plain copy. */
function errorCode(e: unknown): { status: number; code: string } {
  if (e instanceof AccountError) return { status: e.code === "rate_limited" ? 429 : 502, code: e.code };
  if (e instanceof Anthropic.APIUserAbortError) return { status: 499, code: "cancelled" };
  if (e instanceof Anthropic.AuthenticationError) return { status: 502, code: "auth" };
  if (e instanceof Anthropic.PermissionDeniedError) return { status: 502, code: "auth" };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, code: "rate_limited" };
  if (e instanceof Anthropic.BadRequestError) return { status: 502, code: "bad_request" };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, code: "connection" };
  if (e instanceof Anthropic.APIError) return { status: 502, code: "server" };
  return { status: 500, code: "server" };
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? "";
  if (req.method === "GET" && url === "/api/assistant/status")
    return send(res, 200, { configured: configured(), mode: mode(), model: MODEL });
  if (req.method !== "POST" || url !== "/api/assistant") return send(res, 404, { code: "not_found" });
  if (!configured()) return send(res, 503, { code: "not_configured" });
  if (!allow(req.socket.remoteAddress ?? "local")) return send(res, 429, { code: "rate_limited" });

  let body: AssistantRequest;
  try {
    body = (await readJson(req)) as AssistantRequest;
    if (!validSong(body.song) || typeof body.request !== "string" || !body.request.trim()) throw new Error("bad body");
  } catch {
    return send(res, 400, { code: "bad_request" });
  }
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const started = Date.now();
  try {
    let out;
    if (mode() === "account") out = await runOnAccount(body, abort.signal);
    else {
      client ??= new Anthropic();
      out = await runAssistant(body, sdkCreate(client), abort.signal);
    }
    spend.requests++;
    spend.input += out.usage.input;
    spend.output += out.usage.output;
    spend.cacheRead += out.usage.cacheRead;
    spend.cacheWrite += out.usage.cacheWrite;
    console.log(
      `[assistant] ${out.steps.length} tool calls, ${out.stop}, ${Date.now() - started} ms, ` +
        `in ${out.usage.input} (+${out.usage.cacheRead} cached) out ${out.usage.output} | ` +
        (mode() === "api"
          ? `session: ${spend.requests} requests, $${dollars().toFixed(3)}`
          : `session: ${spend.requests} requests on your Claude account`),
    );
    send(res, 200, out);
  } catch (e) {
    const { status, code } = errorCode(e);
    console.error(`[assistant] ${code}:`, e instanceof Error ? e.message : e);
    if (!res.writableEnded) send(res, status, { code });
  }
}

if (process.argv[1] === import.meta.filename) {
  createServer((req, res) => void handle(req, res)).listen(PORT, "127.0.0.1", () =>
    console.log(
      `[assistant] API on http://127.0.0.1:${PORT} (${mode() === "api" ? "using ANTHROPIC_API_KEY" : "using your Claude account, as signed in to Claude Code"})`,
    ),
  );
}
