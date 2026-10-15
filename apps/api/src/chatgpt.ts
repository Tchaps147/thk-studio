import { RULES, TOOLS } from "@thk/song";
import { emptyResponse, runTool, userPrompt, type AssistantRequest, type AssistantResponse } from "./assistant.ts";
import { ChatGPTError, initializeCodex, openCodex, type StudioRpc } from "./codex-rpc.ts";

interface Account {
  account: { type: string } | null;
}
interface Model {
  model: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string }[];
}
interface Models {
  data: Model[];
}
interface Item {
  type: string;
  text?: string;
}
interface Turn {
  status: string;
  error?: { message: string; codexErrorInfo?: unknown } | null;
}
interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
}

export async function chatGPTStatus(): Promise<{ configured: boolean; code?: string }> {
  const rpc = openCodex(AbortSignal.timeout(10000));
  try {
    await initializeCodex(rpc);
    const { account } = await rpc.request<Account>("account/read", { refreshToken: false });
    return account?.type === "chatgpt" ? { configured: true } : { configured: false, code: "chatgpt_not_signed_in" };
  } catch (e) {
    return { configured: false, code: e instanceof ChatGPTError ? e.code : "connection" };
  } finally {
    rpc.close();
  }
}

export function chatGPTFailure(message: string): ChatGPTError {
  const code = /usage.?limit|rate.?limit|quota|overloaded/i.test(message)
    ? "rate_limited"
    : /auth|sign.?in|unauthorized|401/i.test(message)
      ? "chatgpt_not_signed_in"
      : /context.*(length|window)|too.*(large|long)/i.test(message)
        ? "prompt_too_large"
        : "connection";
  return new ChatGPTError(code, message);
}

/** Same song tools and transaction as Claude; only the model transport changes. */
export async function runOnChatGPT(
  req: AssistantRequest,
  signal?: AbortSignal,
  connect: (signal?: AbortSignal) => StudioRpc = openCodex,
): Promise<AssistantResponse> {
  const timeout = AbortSignal.timeout(req.tier === "default" ? 300000 : 180000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const rpc = connect(combined);
  const song = structuredClone(req.song);
  const out = emptyResponse();
  let finish: () => void = () => {};
  let fail: (e: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Register before starting the turn: notifications can arrive before turn/start's response.
  void done.catch(() => {});
  rpc.onFailure = fail;
  rpc.onMessage = (m) => {
    const p = m.params ?? {};
    if (m.id != null && m.method) {
      if (m.method !== "item/tool/call") {
        // This client never approves filesystem, shell, connector or permission requests.
        rpc.respond(m.id, { decision: "decline" });
        fail(new ChatGPTError("server", "ChatGPT requested an unsupported tool."));
        return;
      }
      if (combined.aborted || out.steps.length >= 48) {
        rpc.respond(m.id, { success: false, contentItems: [{ type: "inputText", text: "Tool limit reached." }] });
        out.stop = "rounds";
        finish();
        return;
      }
      const args = p.arguments;
      const step = runTool(
        song,
        String(p.tool),
        args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
        out,
      );
      rpc.respond(m.id, { success: step.ok, contentItems: [{ type: "inputText", text: step.text }] });
    } else if (m.method === "item/completed") {
      const item = p.item as Item | undefined;
      if (item?.type === "agentMessage" && item.text) out.text = item.text.trim();
    } else if (m.method === "thread/tokenUsage/updated") {
      const u = (p.tokenUsage as { total?: Usage } | undefined)?.total;
      if (u)
        out.usage = {
          input: Math.max(0, u.inputTokens - u.cachedInputTokens),
          output: u.outputTokens,
          cacheRead: u.cachedInputTokens,
          cacheWrite: u.cacheWriteInputTokens ?? 0,
        };
    } else if (m.method === "turn/completed") {
      const turn = p.turn as Turn;
      if (turn.status === "completed") finish();
      else if (turn.status === "interrupted") fail(new ChatGPTError("cancelled", "Stopped."));
      else fail(chatGPTFailure(turn.error?.message ?? "ChatGPT turn failed."));
    }
  };
  try {
    await initializeCodex(rpc);
    const { account } = await rpc.request<Account>("account/read", { refreshToken: false });
    if (account?.type !== "chatgpt") throw new ChatGPTError("chatgpt_not_signed_in", "Sign in with codex login.");
    const catalog = await rpc.request<Models>("model/list", { includeHidden: false });
    const requested = process.env.THK_CHATGPT_MODEL;
    const model = requested
      ? catalog.data.find((m) => m.model === requested)
      : (catalog.data.find((m) => m.isDefault) ?? catalog.data[0]);
    if (!model) throw new ChatGPTError("server", "The selected ChatGPT model is unavailable.");
    out.model = model.model;
    out.provider = "chatgpt";
    const { config } = await rpc.request<{
      config: { mcp_servers?: Record<string, unknown>; plugins?: Record<string, unknown> };
    }>("config/read", { includeLayers: false });
    const overrides: Record<string, unknown> = { project_doc_max_bytes: 0 };
    for (const name of Object.keys(config.mcp_servers ?? {})) overrides[`mcp_servers.${name}.enabled`] = false;
    for (const name of Object.keys(config.plugins ?? {})) overrides[`plugins.${name}.enabled`] = false;
    const { thread } = await rpc.request<{ thread: { id: string } }>("thread/start", {
      model: model.model,
      modelProvider: "openai",
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      environments: [],
      selectedCapabilityRoots: [],
      baseInstructions: RULES,
      developerInstructions:
        "You are the THK Studio music co-producer. Use only the supplied studio tools. Respond in plain text. Do not use files, shell, web, skills or other apps.",
      config: overrides,
      dynamicTools: TOOLS.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
    const desired = req.tier === "default" ? "high" : "low";
    const effort = model.supportedReasoningEfforts.some((e) => e.reasoningEffort === desired)
      ? desired
      : model.defaultReasoningEffort;
    const history = (req.history ?? [])
      .slice(-8)
      .map((h) => `${h.role}: ${h.content}`)
      .join("\n");
    await rpc.request("turn/start", {
      threadId: thread.id,
      effort,
      input: [{ type: "text", text: (history ? `Earlier conversation:\n${history}\n\n` : "") + userPrompt(req, song) }],
    });
    await done;
    return out;
  } catch (e) {
    if (combined.aborted)
      throw new ChatGPTError(signal?.aborted ? "cancelled" : "provider_timeout", "ChatGPT request stopped.");
    throw e;
  } finally {
    rpc.close();
  }
}
