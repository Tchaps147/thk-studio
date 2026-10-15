import { describe, expect, it, vi } from "vitest";
import { demoSong } from "@thk/song";
import { AccountError } from "../src/account.ts";
import { emptyResponse, type AssistantRequest } from "../src/assistant.ts";
import { executeAssistant } from "../src/providers.ts";

const request = (): AssistantRequest => ({ song: demoSong(), request: "Make a beat" });
describe("assistant provider routing", () => {
  it("uses ChatGPT directly when selected", async () => {
    const claude = vi.fn();
    const chatgpt = vi.fn(async () => emptyResponse());
    const out = await executeAssistant({ ...request(), provider: "chatgpt" }, undefined, { claude, chatgpt });
    expect(out.provider).toBe("chatgpt");
    expect(claude).not.toHaveBeenCalled();
    expect(chatgpt).toHaveBeenCalledOnce();
  });
  it("retries a failed Claude attempt with the original song and history", async () => {
    const req = {
      ...request(),
      provider: "auto" as const,
      history: [{ role: "user" as const, content: "Keep it minimal" }],
    };
    const original = structuredClone(req);
    const claude = vi.fn(async () => {
      throw new AccountError("rate_limited", "Usage limit");
    });
    const chatgpt = vi.fn(async () => emptyResponse());
    const out = await executeAssistant(req, undefined, { claude, chatgpt });
    expect(out.fallback).toEqual({ from: "claude", code: "rate_limited" });
    expect(chatgpt.mock.calls[0]).toEqual([original, undefined]);
    expect(req).toEqual(original);
  });
  it("keeps a successful Claude reply and never retries a refusal", async () => {
    const chatgpt = vi.fn();
    for (const stop of ["done", "refused"] as const) {
      const out = await executeAssistant({ ...request(), provider: "auto" }, undefined, {
        claude: async () => ({ ...emptyResponse(), stop }),
        chatgpt,
      });
      expect(out.stop).toBe(stop);
      expect(out.provider).toBe("claude");
    }
    expect(chatgpt).not.toHaveBeenCalled();
  });
  it("does not fall back for explicit Claude, invalid input or user cancellation", async () => {
    const chatgpt = vi.fn();
    for (const [provider, code] of [
      ["claude", "rate_limited"],
      ["auto", "bad_request"],
      ["auto", "cancelled"],
    ] as const) {
      await expect(
        executeAssistant({ ...request(), provider }, undefined, {
          claude: async () => {
            throw new AccountError(code, code);
          },
          chatgpt,
        }),
      ).rejects.toThrow(code);
    }
    const controller = new AbortController();
    await expect(
      executeAssistant({ ...request(), provider: "auto" }, controller.signal, {
        claude: async () => {
          controller.abort();
          throw new Error("Stopped");
        },
        chatgpt,
      }),
    ).rejects.toThrow("Stopped");
    expect(chatgpt).not.toHaveBeenCalled();
  });
});
