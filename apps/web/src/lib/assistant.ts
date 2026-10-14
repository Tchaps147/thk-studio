// Assistant client (HANDOFF.md 4.7). The model call goes through a Sampler; today that is the
// claude.ai artifact runtime's `sample` capability when the page runs there (and a scripted stub in
// tests). Phase 3 replaces it with apps/api. The tools, rules and undo behaviour are final.
import {
  OFFER_RESULT,
  RULES,
  TOOLS,
  dryRunVariations,
  parseVariations,
  stateText,
  type AssistantTool,
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

let sampler: Sampler | null = null;
let abort: AbortController | null = null;
const chatTurns: ChatTurn[] = [];

const NOT_HERE =
  "The assistant needs Claude, which isn't available in this view. Groove presets and 3 variations in the piano roll still work.";
const NO_EDIT = "This view can't let the assistant edit the song. Groove presets and 3 variations still work.";

function disable(note?: string) {
  setState((s) => ({ ai: { ...s.ai, available: false } }));
  if (note) addMsg({ kind: "bot", who: "Studio", text: note });
}

export async function initAssistant() {
  const rt = (window as unknown as { claude?: ClaudeRuntime }).claude;
  const s = rt?.use ? ((await rt.use("sample").catch(() => null)) as Sampler | null) : null;
  if (!s) return disable(NOT_HERE);
  let tools = false;
  try {
    tools = !!(await s.limits?.())?.tools;
  } catch {
    /* treated as no tool support */
  }
  if (!tools) return disable(NO_EDIT);
  sampler = s;
  setState((st) => ({ ai: { ...st.ai, available: true } }));
}

interface CodedError {
  code?: string;
  text?: string;
  message?: string;
}
function errorCopy(e: CodedError | undefined): string {
  switch (e?.code) {
    case "cancelled":
      return "Stopped.";
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
    case "session_expired":
      return "Your session expired. Sign in again, then retry.";
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

/** Tools bound to one turn: each edit applies immediately, all of them become one undo step. */
function bindTools(botId: string, turn: { before: Song | null; cmds: Command[] }): SamplerTool[] {
  return TOOLS.map((t: AssistantTool) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    execute:
      t.kind === "edit"
        ? (input: unknown) => {
            settlePending();
            const song = get().song;
            turn.before ??= song;
            try {
              const { next, cmd, result } = record(song, t.name, (d) =>
                t.run(d, (input ?? {}) as Record<string, unknown>),
              );
              if (cmd) {
                setSongQuiet(next, result.trackId ? { tid: result.trackId, cid: result.clipId ?? null } : undefined);
                turn.cmds.push(cmd);
              }
              action(botId, { text: result.summary });
              return result.summary;
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

export async function sendPrompt(raw: string, modelTier = "quick") {
  const text = raw.trim(),
    st = get();
  if (!text || !sampler || st.ai.busy || !st.ai.available) return;
  addMsg({ kind: "user", text });
  const botId = addMsg({ kind: "bot", text: "Thinking…", thinking: true });
  const ctl = new AbortController(),
    turn = { before: null as Song | null, cmds: [] as Command[] };
  abort = ctl;
  setState((s) => ({ ai: { ...s.ai, busy: true } }));
  const input: ChatTurn[] = [
    { role: "user", content: RULES },
    ...chatTurns.slice(-8),
    { role: "user", content: `Current song state:\n${stateText(get().song, get().sel)}\n\nRequest: ${text}` },
  ];
  try {
    const res = await sampler(input, {
      signal: ctl.signal,
      tools: bindTools(botId, turn),
      modelTier,
      onText: ({ text: t }) => updateMsg(botId, { text: t, thinking: false }),
    });
    updateMsg(botId, { text: res.text, thinking: false });
    chatTurns.push({ role: "user", content: text }, { role: "assistant", content: res.text.slice(0, 1500) });
    if (res.truncated) action(botId, { text: "The answer was cut short. Ask for less at a time.", err: true });
  } catch (err) {
    const e = err as CodedError;
    updateMsg(botId, { text: e?.text && e.code !== "refused" ? e.text : "", thinking: false });
    action(botId, { text: errorCopy(e), err: e?.code !== "cancelled" });
    chatTurns.push({ role: "user", content: text });
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
