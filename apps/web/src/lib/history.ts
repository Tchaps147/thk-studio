// Command-based undo. Every edit is a command holding Immer patches (forward and inverse), so
// undo/redo replays small diffs instead of whole-song snapshots. Several edits can be merged into
// one command (an assistant turn, a kept variation); slider drags coalesce by key.
import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";

enablePatches();

export interface Command {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** Consecutive commands with the same key within COALESCE_MS merge into one undo step. */
  key?: string;
  at: number;
}
export interface History {
  past: Command[];
  future: Command[];
}

export const LIMIT = 200;
export const COALESCE_MS = 1500;
export const emptyHistory = (): History => ({ past: [], future: [] });

/**
 * Runs a recipe against `base` and records it. The recipe mutates the draft; its return value is
 * passed back as `result` (it never replaces the draft). Throws whatever the recipe throws, and
 * `base` is untouched in that case.
 */
export function record<T extends object, R>(
  base: T,
  label: string,
  recipe: (draft: T) => R,
  key?: string,
  now = Date.now(),
): { next: T; cmd: Command | null; result: R } {
  let result!: R;
  const [next, patches, inverse] = produceWithPatches(base, (d) => {
    result = recipe(d as T);
  });
  const cmd = patches.length ? { label, patches, inverse, ...(key ? { key } : {}), at: now } : null;
  return { next: next as T, cmd, result };
}

/** Merges commands applied in order into one. */
export function merge(label: string, cmds: Command[], now = Date.now()): Command {
  return {
    label,
    patches: cmds.flatMap((c) => c.patches),
    inverse: cmds
      .slice()
      .reverse()
      .flatMap((c) => c.inverse),
    at: now,
  };
}

export function push(h: History, cmd: Command): History {
  const last = h.past[h.past.length - 1];
  if (cmd.key && last?.key === cmd.key && cmd.at - last.at < COALESCE_MS) {
    const merged = { ...merge(last.label, [last, cmd], cmd.at), key: cmd.key };
    return { past: [...h.past.slice(0, -1), merged], future: [] };
  }
  const past = [...h.past, cmd];
  return { past: past.length > LIMIT ? past.slice(past.length - LIMIT) : past, future: [] };
}

export function undo<T>(state: T, h: History): { state: T; history: History; cmd: Command } | null {
  const cmd = h.past[h.past.length - 1];
  if (!cmd) return null;
  return {
    state: applyPatches(state as object, cmd.inverse) as T,
    history: { past: h.past.slice(0, -1), future: [...h.future, cmd] },
    cmd,
  };
}

export function redo<T>(state: T, h: History): { state: T; history: History; cmd: Command } | null {
  const cmd = h.future[h.future.length - 1];
  if (!cmd) return null;
  return {
    state: applyPatches(state as object, cmd.patches) as T,
    history: { past: [...h.past, { ...cmd, key: undefined }], future: h.future.slice(0, -1) },
    cmd,
  };
}
