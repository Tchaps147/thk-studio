// Local, documented Codex app-server protocol. Authentication stays in Codex's credential store.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export class ChatGPTError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message: string };
}
export interface StudioRpc {
  request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
  notify(method: string, params: Record<string, unknown>): void;
  respond(id: number | string, result: unknown): void;
  onMessage: (message: RpcMessage) => void;
  onFailure: (error: Error) => void;
  close(): void;
}

export function openCodex(signal?: AbortSignal): StudioRpc {
  const cwd = mkdtempSync(join(tmpdir(), "thk-chatgpt-"));
  const child = spawn(
    process.env.THK_CODEX_BIN || "codex",
    [
      "app-server",
      "--stdio",
      "-c",
      'model_provider="openai"',
      "-c",
      'forced_login_method="chatgpt"',
      "-c",
      'web_search="disabled"',
      ...["shell_tool", "apps", "multi_agent", "hooks", "remote_plugin", "memories"].flatMap((f) => ["--disable", f]),
    ],
    { cwd, stdio: ["pipe", "pipe", "pipe"] },
  );
  let nextId = 0;
  let closed = false;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  const send = (value: unknown) => {
    if (!closed) child.stdin.write(JSON.stringify(value) + "\n");
  };
  const rpc: StudioRpc = {
    onMessage: () => {},
    onFailure: () => {},
    request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      if (closed) return Promise.reject(new ChatGPTError("connection", "ChatGPT connection closed."));
      return new Promise<T>((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ChatGPTError("connection", `ChatGPT did not answer ${method}.`));
        }, 20000);
        pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
        send({ id, method, params });
      });
    },
    notify: (method, params) => send({ method, params }),
    respond: (id, result) => send({ id, result }),
    close() {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", cancelled);
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new ChatGPTError("cancelled", "Stopped."));
      }
      pending.clear();
      child.kill();
      const kill = setTimeout(() => child.kill("SIGKILL"), 1000);
      kill.unref();
      child.once("exit", () => clearTimeout(kill));
    },
  };
  const fail = (error: Error) => {
    if (closed) return;
    rpc.onFailure(error);
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
    rpc.close();
  };
  const cancelled = () => fail(new ChatGPTError("cancelled", "Stopped."));
  signal?.addEventListener("abort", cancelled, { once: true });
  child.on("error", (e: NodeJS.ErrnoException) =>
    fail(
      new ChatGPTError(
        e.code === "ENOENT" ? "chatgpt_not_installed" : "connection",
        "The local Codex client could not start.",
      ),
    ),
  );
  child.stdin.on("error", () => fail(new ChatGPTError("connection", "ChatGPT connection closed.")));
  // Drain diagnostics without forwarding account details or credentials to the browser.
  child.stderr.resume();
  child.on("exit", () => {
    fail(new ChatGPTError("connection", "The local ChatGPT process stopped."));
  });
  child.once("close", () => rmSync(cwd, { recursive: true, force: true }));
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return fail(new ChatGPTError("connection", "Invalid ChatGPT response."));
    }
    if (typeof message.id === "number" && !message.method) {
      const p = pending.get(message.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(message.id);
      if (message.error) p.reject(new ChatGPTError("server", message.error.message));
      else p.resolve(message.result);
    } else rpc.onMessage(message);
  });
  if (signal?.aborted) cancelled();
  return rpc;
}

export async function initializeCodex(rpc: StudioRpc) {
  await rpc.request("initialize", {
    clientInfo: { name: "thk_studio", title: "THK Studio", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  rpc.notify("initialized", {});
}
