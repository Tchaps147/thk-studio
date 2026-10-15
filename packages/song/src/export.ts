// Export encoders (HANDOFF.md 4.8): WAV, MIDI and an uncompressed zip. Pure byte builders.
import { SPB, soundOf } from "./kit.ts";
import { clamp, songEnd } from "./model.ts";
import type { Song } from "./types.ts";

/**
 * 16-bit PCM WAV from planar channels. Peak-normalizes to 0.97 (-0.26 dBFS) only when the mix is
 * hotter than that.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const ch = channels.length,
    len = channels[0]?.length ?? 0;
  let peak = 0;
  for (const d of channels) for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]!));
  const gain = peak > 0.97 ? 0.97 / peak : 1;
  const dv = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  dv.setUint32(4, 36 + len * ch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * ch * 2, true);
  dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, len * ch * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++)
    for (let c = 0; c < ch; c++) {
      dv.setInt16(o, clamp(Math.round(channels[c]![i]! * gain * 32767), -32768, 32767), true);
      o += 2;
    }
  return new Uint8Array(dv.buffer);
}

/**
 * Standard MIDI file, format 1 at 96 PPQ: a tempo track plus one track per song track.
 * Synth notes are shifted +24 so the sample's root (C2) lands on C3, Ableton Simpler's
 * original-pitch key; drum pad n maps to MIDI 36 + n (Drum Rack's first pad). Swing is ignored.
 */
export function encodeMidi(song: Song): Uint8Array {
  const PPQ = 96,
    TPS = PPQ / 4,
    enc = new TextEncoder();
  const vlq = (n: number) => {
    const b = [n & 0x7f];
    while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80);
    return b;
  };
  const chunk = (id: string, bytes: number[]) =>
    [...id]
      .map((c) => c.charCodeAt(0))
      .concat(
        [(bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255],
        bytes,
      );
  const tempo = Math.round(60000000 / song.bpm);
  const tracks = [
    chunk(
      "MTrk",
      [0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255]
        .concat([0, 0xff, 0x58, 4, 4, 2, 24, 8])
        .concat([0, 0xff, 0x2f, 0]),
    ),
  ];
  song.tracks.forEach((tr, i) => {
    const ch = i % 16,
      evs: [number, number, number, number][] = [];
    for (const c of tr.clips) {
      const L = c.loop * SPB,
        start = c.start * SPB,
        endS = (c.start + c.len) * SPB;
      for (let base = start; base < endS; base += L)
        for (const n of c.notes) {
          if (n.t >= L || base + n.t >= endS) continue;
          const abs = base + n.t,
            d = Math.min(n.d, endS - abs),
            pitch = tr.type === "drums" ? 36 + n.p : clamp(n.p + 24, 0, 127);
          const vel = clamp(Math.round(n.v * 112) + 8, 1, 127);
          evs.push([abs * TPS, 0x90 | ch, pitch, vel], [(abs + d) * TPS - 1, 0x80 | ch, pitch, 0]);
        }
    }
    evs.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0));
    const name = Array.from(enc.encode(tr.name)).slice(0, 120);
    const bytes = [0, 0xff, 0x03, name.length, ...name];
    let last = 0;
    for (const e of evs) {
      bytes.push(...vlq(Math.max(0, e[0] - last)), e[1], e[2], e[3]);
      last = Math.max(last, e[0]);
    }
    bytes.push(0, 0xff, 0x2f, 0);
    tracks.push(chunk("MTrk", bytes));
  });
  const head = chunk("MThd", [0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array(head.concat(...tracks));
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(u8: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Uncompressed (stored) zip with UTF-8 names. */
export function makeZip(files: { name: string; data: Uint8Array }[], date = new Date()): Uint8Array {
  const enc = new TextEncoder(),
    parts: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  for (const f of files) {
    const name = enc.encode(f.name),
      crc = crc32(f.data),
      size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, day, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, day, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0),
    endRec = new DataView(new ArrayBuffer(22));
  endRec.setUint32(0, 0x06054b50, true);
  endRec.setUint16(8, files.length, true);
  endRec.setUint16(10, files.length, true);
  endRec.setUint32(12, cdSize, true);
  endRec.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(endRec.buffer)],
    out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const slug = (s: string | undefined) =>
  (s || "song")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 60) || "song";

/** README packed with the export. */
export function exportReadme(song: Song): string {
  const base = slug(song.name);
  return (
    `${song.name}\n${song.bpm} BPM, ${songEnd(song)} bars.\n\n${base}.wav  full mixdown, 44.1 kHz 16-bit stereo.\n${base}.mid  one MIDI track per song track.\n\n` +
    `MIDI notes for synth tracks are placed so the sample's own pitch (C) lands on C3, the note Ableton Simpler plays at original pitch.\n` +
    `Drum tracks use one note per pad, starting at C1 (Ableton Drum Rack's first pad).\n` +
    song.tracks
      .map((t) =>
        t.type === "synth"
          ? `\n${t.name}: ${soundOf(song, t.sample)?.name ?? "?"}`
          : `\n${t.name}: ` + t.pads.map((p, i) => `pad ${i + 1} ${soundOf(song, p)?.name || "-"}`).join(", "),
      )
      .join("")
  );
}
