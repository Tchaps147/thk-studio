import { describe, expect, it } from "vitest";
import {
  N,
  crc32,
  emptySong,
  encodeMidi,
  encodeWav,
  exportReadme,
  makeClip,
  makeZip,
  slug,
  type Song,
} from "../src/index.ts";

/** Minimal SMF reader: header fields and each track's [tick, status, data1, data2] channel events. */
function readMidi(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
  expect(tag(0)).toBe("MThd");
  const format = dv.getUint16(8),
    ntrks = dv.getUint16(10),
    ppq = dv.getUint16(12);
  const tracks: { name: string; events: number[][]; meta: number[][] }[] = [];
  let o = 14;
  for (let t = 0; t < ntrks; t++) {
    expect(tag(o)).toBe("MTrk");
    const len = dv.getUint32(o + 4),
      end = o + 8 + len;
    let p = o + 8,
      tick = 0,
      name = "";
    const events: number[][] = [],
      meta: number[][] = [];
    while (p < end) {
      let delta = 0,
        b: number;
      do {
        b = bytes[p++]!;
        delta = (delta << 7) | (b & 0x7f);
      } while (b & 0x80);
      tick += delta;
      const st = bytes[p++]!;
      if (st === 0xff) {
        const type = bytes[p++]!,
          l = bytes[p++]!;
        const data = Array.from(bytes.slice(p, p + l));
        if (type === 0x03) name = new TextDecoder().decode(bytes.slice(p, p + l));
        meta.push([tick, type, ...data]);
        p += l;
      } else {
        events.push([tick, st, bytes[p]!, bytes[p + 1]!]);
        p += 2;
      }
    }
    expect(p).toBe(end);
    tracks.push({ name, events, meta });
    o = end;
  }
  expect(o).toBe(bytes.length);
  return { format, ntrks, ppq, tracks };
}

function song(): Song {
  const s = emptySong();
  s.bpm = 125;
  const [drums, bass] = s.tracks;
  drums!.clips.push(makeClip(0, 2, 1, [N(0, 1, 0), N(4, 1, 1, 0.55)]));
  bass!.clips.push(makeClip(1, 1, 1, [N(2, 2, 41), N(15, 4, 36)]));
  return s;
}

describe("encodeMidi", () => {
  it("writes format 1 at 96 PPQ with a tempo track plus one track per song track", () => {
    const m = readMidi(encodeMidi(song()));
    expect([m.format, m.ntrks, m.ppq]).toEqual([1, 3, 96]);
    expect(m.tracks[0]!.meta[0]).toEqual([0, 0x51, 0x07, 0x53, 0x00]); // 480000 us per beat = 125 BPM
    expect(m.tracks[0]!.meta[1]).toEqual([0, 0x58, 4, 2, 24, 8]); // 4/4
    expect(m.tracks.slice(1).map((t) => t.name)).toEqual(["Drums", "Bass"]);
  });
  it("maps drum pad n to MIDI 36 + n and repeats the pattern across the clip", () => {
    const d = readMidi(encodeMidi(song())).tracks[1]!.events;
    expect(d).toEqual([
      [0, 0x90, 36, 120],
      [23, 0x80, 36, 0],
      [96, 0x90, 37, 70],
      [119, 0x80, 37, 0],
      [384, 0x90, 36, 120],
      [407, 0x80, 36, 0],
      [480, 0x90, 37, 70],
      [503, 0x80, 37, 0],
    ]);
  });
  it("shifts synth notes up two octaves on their own channel and clamps length to the clip end", () => {
    const b = readMidi(encodeMidi(song())).tracks[2]!.events;
    expect(b).toEqual([
      [384 + 48, 0x91, 65, 120],
      [384 + 48 + 47, 0x81, 65, 0],
      [384 + 360, 0x91, 60, 120],
      [384 + 383, 0x81, 60, 0],
    ]);
  });
});

describe("encodeWav", () => {
  it("writes a 16-bit stereo header and interleaved samples", () => {
    const w = encodeWav([new Float32Array([0, 0.5]), new Float32Array([-0.5, 0])], 44100);
    const dv = new DataView(w.buffer);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe("RIFF");
    expect([dv.getUint16(22, true), dv.getUint32(24, true), dv.getUint16(34, true), dv.getUint32(40, true)]).toEqual([
      2, 44100, 16, 8,
    ]);
    expect([dv.getInt16(44, true), dv.getInt16(46, true), dv.getInt16(48, true), dv.getInt16(50, true)]).toEqual([
      0, -16383, 16384, 0,
    ]);
  });
  it("normalizes to -0.26 dBFS only when the mix is hotter", () => {
    const hot = new DataView(encodeWav([new Float32Array([2, -1])], 44100).buffer);
    expect(hot.getInt16(44, true)).toBe(Math.round(0.97 * 32767));
    expect(hot.getInt16(46, true)).toBe(Math.round(-0.485 * 32767));
    const quiet = new DataView(encodeWav([new Float32Array([0.5])], 44100).buffer);
    expect(quiet.getInt16(44, true)).toBe(Math.round(0.5 * 32767));
  });
});

describe("zip", () => {
  it("computes CRC-32", () => {
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it("stores files with local headers, a central directory and an end record", () => {
    const data = new TextEncoder().encode("abc");
    const z = makeZip(
      [
        { name: "a.txt", data },
        { name: "b/ü.txt", data: new Uint8Array([1, 2]) },
      ],
      new Date(2026, 9, 14, 12, 0, 0),
    );
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(14, true)).toBe(crc32(data));
    expect(new TextDecoder().decode(z.slice(30, 35))).toBe("a.txt");
    expect(new TextDecoder().decode(z.slice(35, 38))).toBe("abc");
    const end = z.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
    const cdOffset = dv.getUint32(end + 16, true);
    expect(dv.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(dv.getUint32(end + 12, true)).toBe(end - cdOffset);
  });
});

describe("readme and names", () => {
  it("slugs song names for files", () => {
    expect(slug("Late Shift (demo)")).toBe("Late_Shift_demo");
    expect(slug("!!!")).toBe("song");
  });
  it("lists every track's sounds", () => {
    const r = exportReadme(song());
    expect(r).toContain("Untitled song\n125 BPM, 2 bars.");
    expect(r).toContain("Bass: Rolling Saw Pluck");
    expect(r).toContain("Drums: pad 1 Classic 909, pad 2 Classic");
  });
});
