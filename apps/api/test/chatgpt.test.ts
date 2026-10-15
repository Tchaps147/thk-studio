import { describe, expect, it } from "vitest";
import { demoSong, findTrack } from "@thk/song";
import { runOnChatGPT } from "../src/chatgpt.ts";
import { ChatGPTError, type RpcMessage, type StudioRpc } from "../src/codex-rpc.ts";

function scripted(events: RpcMessage[], turnStatus = "completed") {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const responses: { id: string | number; result: unknown }[] = [];
  let closed = false;
  const rpc: StudioRpc = {
    onMessage: () => {},
    onFailure: () => {},
    notify: () => {},
    close: () => {
      closed = true;
    },
    respond: (id, result) => {
      responses.push({ id, result });
    },
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      const results: Record<string, unknown> = {
        initialize: {},
        "account/read": { account: { type: "chatgpt" } },
        "model/list": {
          data: [
            {
              model: "account-default",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [{ reasoningEffort: "low" }],
            },
          ],
        },
        "config/read": { config: { mcp_servers: { unrelated: {} }, plugins: { "example@local": {} } } },
        "thread/start": { thread: { id: "thread" } },
        "turn/start": { turn: { id: "turn" } },
      };
      if (method === "turn/start")
        queueMicrotask(() => {
          events.forEach((e) => rpc.onMessage(e));
          rpc.onMessage({
            method: "turn/completed",
            params: { turn: { status: turnStatus, error: { message: "Usage limit reached" } } },
          });
        });
      return results[method] as T;
    },
  };
  return { rpc, calls, responses, closed: () => closed };
}
const tool = (id: number, name: string, args: Record<string, unknown>): RpcMessage => ({
  id,
  method: "item/tool/call",
  params: { tool: name, arguments: args },
});
describe("personal ChatGPT studio tools", () => {
  it("runs edits on a copy, reports invalid sounds, and supplies the same tools and isolated configuration", async () => {
    const song = demoSong(),
      before = structuredClone(song);
    const f = scripted([
      tool(90, "write_drums", {
        track: "Groove",
        start_bar: 1,
        bars: 4,
        pattern_bars: 1,
        lanes: [{ sound: "kick", steps: "x---x---x---x---" }],
      }),
      tool(91, "write_drums", {
        track: "Bad",
        start_bar: 1,
        bars: 4,
        pattern_bars: 1,
        lanes: [{ sound: "banana", steps: "x---" }],
      }),
      { method: "item/completed", params: { item: { type: "agentMessage", text: "Your kick is ready." } } },
      {
        method: "thread/tokenUsage/updated",
        params: { tokenUsage: { total: { inputTokens: 120, cachedInputTokens: 100, outputTokens: 12 } } },
      },
    ]);
    const out = await runOnChatGPT(
      { song, request: "Kick", history: [{ role: "user", content: "Keep the bass" }] },
      undefined,
      () => f.rpc,
    );
    expect(song).toEqual(before);
    expect(out.provider).toBe("chatgpt");
    expect(out.steps.map((s) => s.ok)).toEqual([true, false]);
    expect(out.edits).toHaveLength(1);
    expect(out.text).toBe("Your kick is ready.");
    expect(out.usage).toEqual({ input: 20, output: 12, cacheRead: 100, cacheWrite: 0 });
    expect(f.responses[1]?.result).toMatchObject({ success: false });
    expect(f.calls.find((c) => c.method === "thread/start")?.params).toMatchObject({
      ephemeral: true,
      environments: [],
      sandbox: "read-only",
      config: { "mcp_servers.unrelated.enabled": false, "plugins.example@local.enabled": false },
    });
    expect(f.calls.find((c) => c.method === "turn/start")?.params).toMatchObject({ effort: "low" });
    expect(f.closed()).toBe(true);
  });
  it("offers validated variations and designs sounds through the existing tools", async () => {
    const song = demoSong();
    const before = structuredClone(song);
    const bass = findTrack(song, "Bass")!;
    const f = scripted([
      tool(90, "design_sound", { name: "Rubber Test", instrument: "bass", settings: { cutoff: 400 } }),
      tool(91, "offer_variations", {
        title: "Choose a bass",
        variations: [
          {
            name: "Bounce",
            kind: "notes",
            track: bass.id,
            start_bar: 1,
            bars: 4,
            pattern_bars: 1,
            notes: [{ step: 2, note: "F2", len: 1 }],
          },
        ],
      }),
    ]);
    const out = await runOnChatGPT({ song, request: "A rubber bass and a variation" }, undefined, () => f.rpc);
    expect(out.steps.map((s) => [s.tool, s.ok])).toEqual([
      ["design_sound", true],
      ["offer_variations", true],
    ]);
    expect(out.variations).toHaveLength(1);
    expect(out.edits).toHaveLength(1);
    expect(song).toEqual(before);
  });
  it("rejects failed and cancelled turns and always closes the connection", async () => {
    for (const status of ["failed", "interrupted"]) {
      const f = scripted([], status);
      await expect(runOnChatGPT({ song: demoSong(), request: "Kick" }, undefined, () => f.rpc)).rejects.toBeInstanceOf(
        ChatGPTError,
      );
      expect(f.closed()).toBe(true);
    }
  });
});
