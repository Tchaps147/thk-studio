import type { Sound } from "./types.ts";

/** Select a nearby recorded pitch, then a dynamic layer and deterministic alternating take. */
export function recordedSample(sound: Sound, note: number, velocity = 1, take = 0) {
  const zones = sound.sampleMap;
  if (!zones?.length) return undefined;
  const root = zones.reduce(
    (best, z) => (Math.abs(z.root - note) < Math.abs(best - note) ? z.root : best),
    zones[0]!.root,
  );
  const layers = zones.filter((z) => z.root === root).sort((a, b) => a.maxVelocity - b.maxVelocity);
  const layer = layers.find((z) => velocity <= z.maxVelocity) ?? layers[layers.length - 1]!;
  return { file: layer.files[take % layer.files.length]!, rate: 2 ** ((note - root) / 12) };
}
