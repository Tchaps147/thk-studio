import Anthropic from "@anthropic-ai/sdk";
import { AccountError, runOnAccount } from "./account.ts";
import { MODEL, runAssistant, sdkCreate, type AssistantRequest, type AssistantResponse } from "./assistant.ts";
import { runOnChatGPT } from "./chatgpt.ts";
import { ChatGPTError } from "./codex-rpc.ts";

export const claudeMode = (): "account" | "api" =>
  process.env.THK_ASSISTANT === "api" ||
  (!!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.THK_ASSISTANT !== "account")
    ? "api"
    : "account";
export const claudeConfigured = () =>
  claudeMode() === "account" || !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const defaultProvider = () => {
  const p = process.env.THK_PROVIDER;
  return p === "claude" || p === "chatgpt" ? p : "auto";
};
let client: Anthropic | null = null;
async function claude(req: AssistantRequest, signal?: AbortSignal) {
  if (!claudeConfigured()) throw new AccountError("not_configured", "Claude is not configured.");
  if (claudeMode() === "account") return runOnAccount(req, signal);
  client ??= new Anthropic();
  return runAssistant(req, sdkCreate(client), signal);
}

export function errorCode(e: unknown): { status: number; code: string } {
  if (e instanceof AccountError || e instanceof ChatGPTError)
    return { status: e.code === "rate_limited" ? 429 : e.code === "cancelled" ? 499 : 502, code: e.code };
  if (e instanceof Anthropic.APIUserAbortError) return { status: 499, code: "cancelled" };
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return { status: 502, code: "auth" };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, code: "rate_limited" };
  if (e instanceof Anthropic.BadRequestError) return { status: 502, code: "bad_request" };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, code: "connection" };
  return { status: 502, code: "server" };
}
type Runner = (req: AssistantRequest, signal?: AbortSignal) => Promise<AssistantResponse>;
const RECOVERABLE = new Set([
  "auth",
  "not_signed_in",
  "not_configured",
  "rate_limited",
  "connection",
  "server",
  "provider_timeout",
]);

export async function executeAssistant(
  req: AssistantRequest,
  signal?: AbortSignal,
  runners: { claude: Runner; chatgpt: Runner } = { claude, chatgpt: runOnChatGPT },
): Promise<AssistantResponse> {
  signal?.throwIfAborted();
  const provider = req.provider ?? defaultProvider();
  if (provider === "chatgpt") return { ...(await runners.chatgpt(req, signal)), provider: "chatgpt" };
  try {
    const timeout = AbortSignal.timeout(req.tier === "default" ? 180000 : 90000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let out;
    try {
      out = await runners.claude(req, combined);
    } catch (e) {
      if (timeout.aborted && !signal?.aborted) throw new AccountError("provider_timeout", "Claude took too long.");
      throw e;
    }
    return { ...out, provider: "claude", model: MODEL };
  } catch (e) {
    const { code } = errorCode(e);
    // Refusals, invalid requests and user cancellation never trigger a provider retry.
    if (provider !== "auto" || signal?.aborted || !RECOVERABLE.has(code)) throw e;
    return { ...(await runners.chatgpt(req, signal)), provider: "chatgpt", fallback: { from: "claude", code } };
  }
}
