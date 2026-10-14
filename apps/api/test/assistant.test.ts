import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { demoSong, findTrack, TOOLS, type EditTool } from "@thk/song";
import { MODEL, runAssistant, type CreateMessage } from "../src/assistant.ts";

type Msg = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** A scripted Claude: returns the queued responses in order and records each request. */
function script(...replies: Partial<Msg>[]) {
  const calls: Params[] = [];
  const create: CreateMessage = async (params) => {
    calls.push(structuredClone(params));
    const r = replies.shift();
    if (!r) throw new Error("no more scripted replies");
    return {
      id: "msg",
      type: "message",
      role: "assistant",
      model: MODEL,
      stop_reason: "end_turn",
      content: [],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
      ...r,
    } as Msg;
  };
  return { create, calls };
}
const use = (id: string, name: string, input: Record<string, unknown>) => ({
  type: "tool_use" as const,
  id,
  name,
  input,
});
const text = (t: string) => ({ type: "text" as const, text: t, citations: null });

describe("runAssistant", () => {
  it("runs the prototype's TEST1 tool calls: failures roll back and are reported to Claude", async () => {
    const { create, calls } = script(
      {
        stop_reason: "tool_use",
        content: [
          use("a", "write_drums", { track: "Groove", start_bar: 1, bars: 16, pattern_bars: 1, lanes: [{ sound: "kick", steps: "x---x---x---x---" }] }),
          use("b", "write_drums", { track: "Groove", start_bar: 1, bars: 16, pattern_bars: 1, lanes: [{ sound: "closed hat", steps: "oo-xoo-xoo-xoo-x" }, { sound: "THK_HatO_04_Dark", steps: "--x---x---x---x-" }] }),
          use("c", "write_drums", { track: "Groove", start_bar: 1, bars: 4, pattern_bars: 1, lanes: [{ sound: "banana", steps: "x---" }] }),
          use("d", "write_notes", { track: "Bass", start_bar: 9, bars: 8, pattern_bars: 1, notes: [{ step: 2, note: "F2", len: 2 }, { step: 6, note: "G#2", len: 1 }], sound: "THK_Bass_25_Fat_Ladder_C" }),
          use("e", "set_song", { key: "G", bpm: 126 }),
        ] as Msg["content"],
      }, // prettier-ignore
      { content: [text("Wrote a kick and hats on Groove.")] as Msg["content"] },
    );
    const song = demoSong();
    const out = await runAssistant({ song, request: "TEST1", tier: "quick" }, create);

    expect(out.steps.map((s) => s.ok)).toEqual([true, true, false, true, true]);
    expect(out.steps[2]!.text).toMatch(/^Unknown drum sound "banana"/);
    expect(out.edits.map((e) => e.tool)).toEqual(["write_drums", "write_drums", "write_notes", "set_song"]);
    expect(out.text).toBe("Wrote a kick and hats on Groove.");
    expect(out.stop).toBe("done");
    expect(out.usage).toEqual({ input: 200, output: 40, cacheRead: 8000, cacheWrite: 0 });
    expect(song.tracks).toHaveLength(4); // the request's song is never touched

    // Replaying the edits on the client's copy gives the same song the server ended with.
    const replay = demoSong();
    for (const e of out.edits) (TOOLS.find((t) => t.name === e.tool) as EditTool).run(replay, e.input);
    expect(findTrack(replay, "Groove")!.clips[0]!.notes).toHaveLength(20);
    expect([replay.key, replay.bpm]).toEqual([7, 126]);

    // The second request carries every tool result, the failure flagged as an error.
    const results = calls[1]!.messages.at(-1)!.content as Anthropic.Beta.Messages.BetaToolResultBlockParam[];
    expect(results.map((r) => [r.tool_use_id, !!r.is_error])).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
      ["d", false],
      ["e", false],
    ]);
  });

  it("sends the cached rules, the song state, the model, effort and fallbacks", async () => {
    const { create, calls } = script({ content: [text("ok")] as Msg["content"] });
    await runAssistant(
      { song: demoSong(), request: "make it darker", tier: "default", history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] },
      create,
    ); // prettier-ignore
    const p = calls[0]!;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.output_config).toEqual({ effort: "high" });
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    const sys = p.system as Anthropic.Beta.Messages.BetaTextBlockParam[];
    expect(sys[0]!.text).toContain("Sound catalog");
    expect(sys[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(p.tools!.map((t) => (t as { name: string }).name)).toEqual(TOOLS.map((t) => t.name));
    expect(p.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(p.messages[2]!.content).toMatch(
      /^Current song state:\nSong "Late Shift \(demo\)"[\s\S]*Request: make it darker$/,
    );
  });

  it("returns offered variations without changing the song (prototype TEST2)", async () => {
    const { create } = script(
      {
        stop_reason: "tool_use",
        content: [
          use("v", "offer_variations", { title: "Drums for the bass", variations: [
            { name: "Sparse", kind: "drums", track: "Tops", start_bar: 9, bars: 16, pattern_bars: 1, lanes: [{ sound: "open hat", steps: "--x---x---x---x-" }] },
            { name: "Busy", kind: "drums", track: "Tops", start_bar: 9, bars: 16, pattern_bars: 2, lanes: [{ sound: "ride", steps: "o-xo" }, { sound: "clap", steps: "----x-------x---" }] },
            { name: "Bass alt", kind: "notes", track: "Bass", start_bar: 9, bars: 16, pattern_bars: 1, notes: [{ step: 3, note: "F1", len: 1 }] } ] }),
        ] as Msg["content"],
      }, // prettier-ignore
      { content: [text("Here are three.")] as Msg["content"] },
    );
    const out = await runAssistant({ song: demoSong(), request: "TEST2" }, create);
    expect(out.edits).toEqual([]);
    expect(out.variations).toHaveLength(1);
    expect(out.variations[0]!.specs.map((s) => s.name)).toEqual(["Sparse", "Busy", "Bass alt"]);
    expect(out.steps[0]!.text).toMatch(/^Shown 3 variations/);
  });

  it("stops on a refusal and never runs tools from a cut-off answer", async () => {
    const refused = await runAssistant(
      { song: demoSong(), request: "x" },
      script({ stop_reason: "refusal", content: [] }).create,
    );
    expect(refused.stop).toBe("refused");
    const cut = await runAssistant(
      { song: demoSong(), request: "x" },
      script({ stop_reason: "max_tokens", content: [use("a", "set_song", { bpm: 90 })] as Msg["content"] }).create,
    );
    expect(cut.stop).toBe("max_tokens");
    expect(cut.edits).toEqual([]);
  });
});
