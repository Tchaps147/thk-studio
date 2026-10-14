// App state. The song is immutable: every change goes through edit() (one undoable command),
// a gesture (live preview, one command on release) or a Try (previewed, committed by Keep).
import { create } from "zustand";
import type { Patch } from "immer";
import { clamp, clipById, trackById, type Song, type SoundKind, type VariationSpec } from "@thk/song";
import { emptyHistory, push, record, redo as redoH, undo as undoH, type Command, type History } from "./history.ts";

export interface Sel {
  tid: string | null;
  cid: string | null;
  /** Selected pad row on drum tracks (0-7). */
  row: number;
}
export interface ChatAction {
  text: string;
  err?: boolean;
}
export interface ChatMsg {
  id: string;
  kind: "user" | "bot";
  who?: string;
  text: string;
  thinking?: boolean;
  actions: ChatAction[];
  groupIds?: string[];
  /** "Undo these changes" for an assistant turn. */
  undo?: { before: Song; cmd: Command; done: boolean };
}
export interface VarGroup {
  id: string;
  title: string;
  specs: VariationSpec[];
  tried: number | null;
  kept: number | null;
}
/** A Try in progress: the song before it and the command that Keep will record. */
export interface Pending {
  groupId: string;
  base: Song;
  cmd: Command;
}
interface Gesture {
  base: Song;
  recipe: ((d: Song) => void) | null;
}

export interface StudioState {
  song: Song;
  history: History;
  sel: Sel;
  pending: Pending | null;
  gesture: Gesture | null;
  ui: { tab: SoundKind; ppb: number; cw: number; noteLen: number; follow: boolean };
  playing: boolean;
  toast: { n: number; text: string } | null;
  status: string;
  chat: ChatMsg[];
  groups: Record<string, VarGroup>;
  ai: { available: boolean; busy: boolean };
}

export const useStudio = create<StudioState>()(() => ({
  song: { v: 1, name: "", bpm: 125, swing: 54, key: 5, loop: { on: false, start: 0, end: 4 }, tracks: [] },
  history: emptyHistory(),
  sel: { tid: null, cid: null, row: 0 },
  pending: null,
  gesture: null,
  ui: { tab: "kick", ppb: 48, cw: 22, noteLen: 2, follow: true },
  playing: false,
  toast: null,
  status: "Autosaves in this browser",
  chat: [],
  groups: {},
  ai: { available: false, busy: false },
}));

export const get = () => useStudio.getState();
const set = useStudio.setState;

let uid = 0;
export const localId = (p = "m") => p + ++uid;

/** Keeps the selection pointing at things that exist. */
export function fixSel(song: Song, sel: Sel): Sel {
  let { tid, cid } = sel;
  if (!trackById(song, tid)) {
    tid = song.tracks[0]?.id ?? null;
    cid = null;
  }
  if (cid && !clipById(trackById(song, tid), cid)) cid = null;
  return { tid, cid, row: clamp(sel.row, 0, 7) };
}

export function select(p: Partial<Sel>) {
  const s = get();
  const sel = { ...s.sel, ...p };
  if (p.tid !== undefined && p.tid !== s.sel.tid && p.cid === undefined) sel.cid = null;
  if (p.tid !== undefined && p.tid !== s.sel.tid && p.row === undefined) sel.row = 0;
  set({ sel: fixSel(s.song, sel) });
}

export function toast(text: string) {
  set((s) => ({ toast: { n: (s.toast?.n ?? 0) + 1, text } }));
}

/** Commits a pending Try as kept (any other edit, undo or a Try elsewhere settles it first). */
export function settlePending() {
  const { pending, history, groups } = get();
  if (!pending) return;
  const g = groups[pending.groupId];
  set({
    pending: null,
    history: push(history, pending.cmd),
    ...(g ? { groups: { ...groups, [g.id]: { ...g, kept: g.tried } } } : {}),
  });
}

export interface EditOptions<R> {
  /** Slider drags: consecutive edits with the same key merge into one undo step. */
  key?: string;
  /** Selection to apply after the edit, computed from the recipe's result. */
  select?: (result: R, song: Song) => Partial<Sel>;
}

/**
 * Applies one undoable edit. The recipe mutates a draft of the song and may throw; then nothing
 * changes and the error propagates. Returns the recipe's result.
 */
export function edit<R>(label: string, recipe: (draft: Song) => R, o: EditOptions<R> = {}): R {
  settlePending();
  const s = get();
  const { next, cmd, result } = record(s.song, label, recipe, o.key);
  if (!cmd) return result;
  const sel = o.select ? { ...s.sel, ...o.select(result, next) } : s.sel;
  set({ song: next, history: push(s.history, cmd), sel: fixSel(next, sel) });
  return result;
}

/** Replaces the whole song as one undoable step (New, Open). */
export function replaceSong(next: Song, label: string, sel?: Partial<Sel>) {
  settlePending();
  const s = get();
  const cmd: Command = {
    label,
    patches: [{ op: "replace", path: [], value: next }] as Patch[],
    inverse: [{ op: "replace", path: [], value: s.song }] as Patch[],
    at: Date.now(),
  };
  set({ song: next, history: push(s.history, cmd), sel: fixSel(next, { ...s.sel, ...sel }) });
}

/** Records an already-built command and moves to its result (assistant turns, Keep). */
export function commitCommand(next: Song, cmd: Command) {
  const s = get();
  set({ song: next, history: push(s.history, cmd), sel: fixSel(next, s.sel) });
}

/** Sets the song without history: Try previews and the steps of an assistant turn. */
export function setSongQuiet(next: Song, sel?: Partial<Sel>) {
  const s = get();
  set({ song: next, sel: fixSel(next, { ...s.sel, ...sel }) });
}

// ---------- gestures: drag a clip, a note, a fader ----------
export function beginGesture() {
  settlePending();
  set({ gesture: { base: get().song, recipe: null } });
}
/** Re-applies the gesture's recipe to the song as it was when the gesture began. */
export function updateGesture(recipe: (d: Song) => void) {
  const g = get().gesture;
  if (!g) return;
  const { next } = record(g.base, "", recipe);
  set({ gesture: { ...g, recipe }, song: next });
}
/** Ends the gesture as one command (or nothing if it changed nothing). */
export function endGesture(label: string, sel?: Partial<Sel>) {
  const s = get(),
    g = s.gesture;
  if (!g) return;
  if (!g.recipe) {
    set({ gesture: null, song: g.base });
    return;
  }
  const { next, cmd } = record(g.base, label, g.recipe);
  set({
    gesture: null,
    song: next,
    history: cmd ? push(s.history, cmd) : s.history,
    sel: fixSel(next, { ...s.sel, ...sel }),
  });
}
export function cancelGesture() {
  const g = get().gesture;
  if (g) set({ gesture: null, song: g.base });
}

export function undo() {
  settlePending();
  const s = get();
  const r = undoH(s.song, s.history);
  if (r) set({ song: r.state, history: r.history, sel: fixSel(r.state, s.sel) });
}
export function redo() {
  settlePending();
  const s = get();
  const r = redoH(s.song, s.history);
  if (r) set({ song: r.state, history: r.history, sel: fixSel(r.state, s.sel) });
}

export function setUi(p: Partial<StudioState["ui"]>) {
  set((s) => ({ ui: { ...s.ui, ...p } }));
}

// ---------- chat ----------
export function addMsg(m: Omit<ChatMsg, "id" | "actions"> & { actions?: ChatAction[] }): string {
  const id = localId("msg");
  set((s) => ({ chat: [...s.chat, { actions: [], ...m, id }] }));
  return id;
}
export function updateMsg(id: string, p: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) {
  set((s) => ({ chat: s.chat.map((m) => (m.id === id ? { ...m, ...(typeof p === "function" ? p(m) : p) } : m)) }));
}
export function addGroup(title: string, specs: VariationSpec[]): string {
  const id = localId("grp");
  set((s) => ({ groups: { ...s.groups, [id]: { id, title, specs, tried: null, kept: null } } }));
  return id;
}
export function updateGroup(id: string, p: Partial<VarGroup>) {
  set((s) => {
    const g = s.groups[id];
    return g ? { groups: { ...s.groups, [id]: { ...g, ...p } } } : {};
  });
}
export { set as setState };
