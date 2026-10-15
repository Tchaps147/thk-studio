// The assistant's contract (HANDOFF.md 4.7): rules text, catalog, song state text and the six
// tools. Pure, so the Phase 3 server can run the same tool loop against a copy of the song.
import { CATS, KIT, NOTE_NAMES, SPB, soundOf } from "./kit.ts";
import { clipById, pname, songEnd, trackById } from "./model.ts";
import {
  PatternError,
  deleteBars,
  lanesOf,
  setSong,
  setTrack,
  writeDrums,
  writeNotes,
  type SongInput,
  type TrackInput,
  type WriteResult,
} from "./pattern.ts";
import { applyVariation, type VariationSpec } from "./grooves.ts";
import { CHORD_VOICINGS, INSTRUMENTS, PARAMS, isBool, isEnum } from "./patch.ts";
import { chordFamilyLabel } from "./chords.ts";
import { addSound, editSound } from "./sounds.ts";
import type { Song } from "./types.ts";

export const CATALOG = CATS.map(
  ([k, plural]) =>
    `${plural} (${k}): ${
      KIT.filter((s) => s.kind === k)
        .map((s) =>
          s.kind === "chord" && s.family
            ? `${s.id} [${chordFamilyLabel(s.family)}; ${s.patch?.chord}; ${s.description ?? ""}]`
            : s.description
              ? `${s.id} [${s.description}]`
              : s.id,
        )
        .join(", ") || "No factory presets yet; design_sound can create one."
    }`,
).join("\n");

export const RULES = `You are the arranging assistant built into THK Studio, a browser groovebox for tech house. The user asks you to build and change their song. You change the song only by calling the page tools; then reply in one to three short plain sentences saying what you did (tracks, bars, sounds). No markdown headings, lists or tables.

How the song works
- Time: 16 steps per bar (16th notes), bars numbered from 1. A clip covers some bars of one track and repeats a pattern of pattern_bars (1, 2, 4 or 8) bars.
- Drum tracks have 8 pads, each holding one sound. Write drums as lanes: a sound plus a steps string with one character per 16th: x = hit, o = soft hit, - = rest, length pattern_bars x 16 (a space between bars is fine). Four-to-the-floor: x---x---x---x---. Offbeat open hat: --x---x---x---x-. Clap on 2 and 4: ----x-------x---.
- Synth tracks play one sample chromatically. Notes are names like F2 or C#3 (C2 = 65 Hz); step is 0-based within the pattern, len is in 16ths. Tech house bass usually sits between C1 and C3, mostly in the gaps between kicks (steps 2, 3, 6, 7, 10, 11, 14, 15) with lengths of 1 or 2. Stay in the song key unless asked; minor keys suit tech house.
- Sounds: a category (kick, clap, snare, closed hat, open hat, ride, shaker, rim, perc, tom) or an exact sound id from the catalog. Choose ids when the user describes a character ("dark hats", "tight clap", "acid bass").
- For realistic acoustic or clean electric guitar, use recorded entries such as THK_RecordedGuitar_01_Acoustic or THK_RecordedGuitar_02_Electric. These use actual recorded picks. Write guitar parts around C3-C5, use varied soft/hard notes, and offset chord notes slightly for strums.
- The catalog also includes recorded grand/upright pianos, FM keyboards, organs, basses, nylon/steel guitars, mallets, strings, brass, drums and vocal phrases. Prefer those when the user requests real instruments. For guitar/piano chords use a synth track with mono false so notes can overlap. Recorded vocal phrases are untimed one-shots: put them on drum pads to preserve their original speed and let the whole phrase play; they do not automatically stretch to the song BPM. Only the explicitly synthesized guitar presets are synth interpretations.

Rules
- Only change what was asked. write_drums keeps the other lanes of an existing pattern unless replace is true, so "add hats" means sending only the hat lanes.
- When parts should work with each other, read the existing patterns in the state: leave room around the kick, put hats and percussion in the gaps, and don't stack percussion on every bass note.
- If the user doesn't say where, use the bars where the related parts already play, or bars 1-16 in an empty song.
- When the user asks to see, hear or compare options or variations, call offer_variations with complete alternatives (3 unless told otherwise) instead of writing them. The user loops each one in place and keeps one, so never also write them yourself.
- set_track changes sounds and mix; set_song changes tempo, key and swing.

Making sounds
- When no sound in the catalog fits what the user describes ("a bass that isn't in the app", "a darker pad", "a squelchy acid lead"), make one with design_sound: pick the instrument, optionally start_from the closest catalog sound, and set only the settings that matter. Put it on a track or pad with track (and pad) when the user wants to hear it in the song.
- Chord presets play their full voicing from a single root note. Use one root per hit rather than stacking a chord of chord presets. Available voicings: ${Object.keys(
  CHORD_VOICINGS,
)
  .filter((c) => c !== "none")
  .join(
    ", ",
  )}. Prefer C3-C4 for house chord roots unless the user wants a lower register. For classic club keyboards choose Piano house or Organ & garage; for tight modern stabs choose Tech house or Minimal; for soulful harmony choose Deep & soulful. fmDecay fades the FM strike for keyboard-like attacks. These presets are original synthesized interpretations, not sampled hardware replicas.
- Vocal presets are synthesized vowel chops and choir textures, not recorded speech or sung words. Vowel settings are ah, eh, ee, oh and oo. Never promise lyrics or real vocal recordings from this engine.
- Melodic sounds are rooted on C2: keep tune at 0 for them unless asked, so notes stay in key. Drums can use tune freely.
- edit_sound changes one of the song's own sounds (listed in the song state). Built-in sounds never change; to tweak one, design_sound with start_from it.
- Settings guide: darker = lower cutoff; brighter = higher cutoff; plucky = short filter decay with filter env 2-5; squelchy/acid = resonance 8-15 with filter env; fatter = sub, unison or a detuned osc 2; punchier = shorter attack and decay; gritty = drive 0.4+; longer = bigger length and release; metallic = FM amount 3+.

Sound catalog
${CATALOG}`;

export interface Selection {
  tid: string | null;
  cid: string | null;
}

/** The song as text for the model: tracks, pads, clips, drum lanes as step strings, notes as step:note/len. */
export function stateText(song: Song, sel?: Selection): string {
  const L = [
    `Song "${song.name}": ${song.bpm} BPM, key ${NOTE_NAMES[song.key]}, swing ${song.swing}%, ${songEnd(song)} bars long.`,
  ];
  const st = trackById(song, sel?.tid),
    sc = clipById(st, sel?.cid);
  if (st) L.push(`Selected: ${st.name}${sc ? `, clip bars ${sc.start + 1}-${sc.start + sc.len}` : ""}.`);
  if (song.sounds?.length)
    L.push(
      "The song's own sounds (editable with edit_sound): " +
        song.sounds.map((x) => `${x.id} (${x.kind}, "${x.name}")`).join(", "),
    );
  L.push("Tracks:");
  song.tracks.forEach((t, i) => {
    const mix = `vol ${t.vol.toFixed(2)}${t.mute ? ", muted" : ""}${t.solo ? ", solo" : ""}${t.cutoff < 19000 ? `, filter ${t.cutoff} Hz` : ""}${t.send ? `, reverb ${Math.round(t.send * 100)}%` : ""}`;
    if (t.type === "drums")
      L.push(
        `${i + 1}. "${t.name}" (drums; ${mix}). Pads: ` +
          t.pads
            .map((p, j) => (soundOf(song, p) ? `${j + 1}=${soundOf(song, p)!.kind}:${p}` : `${j + 1}=empty`))
            .join(", "),
      );
    else
      L.push(
        `${i + 1}. "${t.name}" (synth; sound ${t.sample}; ${t.mono ? "mono" : "poly"}${t.duck ? ", ducks to kick" : ""}; ${mix})`,
      );
    if (!t.clips.length) L.push("   no clips");
    for (const c of t.clips) {
      L.push(`   clip bars ${c.start + 1}-${c.start + c.len}, ${c.loop}-bar pattern${c.name ? ` "${c.name}"` : ""}:`);
      const Ln = c.loop * SPB;
      if (t.type === "drums") {
        const lanes = lanesOf(c).sort((a, b) => a.pad - b.pad);
        for (const l of lanes)
          L.push(
            `     pad ${l.pad + 1} ${soundOf(song, t.pads[l.pad])?.kind ?? "?"}: ${(l.steps.match(/.{1,16}/g) ?? []).join(" ")}`,
          );
        if (!lanes.length) L.push("     (empty)");
      } else {
        const ns = c.notes
          .filter((n) => n.t < Ln)
          .sort((a, b) => a.t - b.t || a.p - b.p)
          .map((n) => `${n.t}:${pname(n.p)}/${n.d}${n.v < 0.8 ? "o" : ""}`);
        L.push("     " + (ns.join(" ") || "(empty)") + "   (step:note/len)");
      }
    }
  });
  return L.join("\n");
}

// ---------- tools ----------
type Schema = Record<string, unknown>;
const S_TRACK = { type: "string", description: "Track name (or id)." };
const S_START = { type: "integer", minimum: 1, description: "First bar, numbered from 1." };
const S_BARS = { type: "integer", minimum: 1, description: "How many bars the clip covers." };
const S_PAT = { type: "integer", enum: [1, 2, 4, 8], description: "Length of the repeating pattern in bars." };
const S_LANES = {
  type: "array",
  items: {
    type: "object",
    properties: {
      sound: { type: "string", description: "Category or sound id." },
      steps: { type: "string", description: "x hit, o soft, - rest; pattern_bars*16 characters." },
    },
    required: ["sound", "steps"],
  },
};
const S_NOTES = {
  type: "array",
  items: {
    type: "object",
    properties: {
      step: { type: "integer", description: "0-based 16th within the pattern." },
      note: { type: "string", description: "e.g. F2" },
      len: { type: "integer", description: "Length in 16ths." },
      soft: { type: "boolean" },
    },
    required: ["step", "note"],
  },
};

type Input = Record<string, unknown>;

/** A tool that changes the song. run() mutates the song it's given and throws PatternError on bad input. */
export interface EditTool {
  name: string;
  description: string;
  inputSchema: Schema;
  kind: "edit";
  run: (song: Song, input: Input) => WriteResult;
}
/** offer_variations: validated and dry-run, never applied; the client shows Try / Keep cards. */
export interface OfferTool {
  name: "offer_variations";
  description: string;
  inputSchema: Schema;
  kind: "offer";
}
export type AssistantTool = EditTool | OfferTool;

const bar0 = (v: unknown) => (+(v as number) || 1) - 1;

export const TOOLS: readonly AssistantTool[] = [
  {
    name: "write_drums",
    kind: "edit",
    description:
      "Write a drum pattern clip on a drum track (created if missing), replacing whatever that track had in those bars. Listed lanes are written; other lanes of the existing pattern are kept unless replace is true. Returns a summary.",
    inputSchema: {
      type: "object",
      properties: { track: S_TRACK, start_bar: S_START, bars: S_BARS, pattern_bars: S_PAT, lanes: S_LANES, replace: { type: "boolean", description: "Clear lanes not listed." }, clip_name: { type: "string" } }, // prettier-ignore
      required: ["track", "start_bar", "bars", "pattern_bars", "lanes"],
    },
    run: (song, i) =>
      writeDrums(song, {
        track: i.track,
        start: bar0(i.start_bar),
        len: i.bars,
        loop: i.pattern_bars,
        lanes: i.lanes,
        replace: !!i.replace,
        name: i.clip_name as string | undefined,
      }),
  },
  {
    name: "write_notes",
    kind: "edit",
    description:
      "Write a note pattern clip on a synth track (created if missing), replacing whatever that track had in those bars. Optionally sets the track's sound (a sound id). Returns a summary.",
    inputSchema: {
      type: "object",
      properties: { track: S_TRACK, start_bar: S_START, bars: S_BARS, pattern_bars: S_PAT, notes: S_NOTES, sound: { type: "string", description: "Sound id, usually from Bass." }, clip_name: { type: "string" } }, // prettier-ignore
      required: ["track", "start_bar", "bars", "pattern_bars", "notes"],
    },
    run: (song, i) =>
      writeNotes(song, {
        track: i.track,
        start: bar0(i.start_bar),
        len: i.bars,
        loop: i.pattern_bars,
        notes: i.notes,
        sound: i.sound,
        name: i.clip_name as string | undefined,
      }),
  },
  {
    name: "set_track",
    kind: "edit",
    description:
      "Create or change a track: sound (synth) or a pad's sound (drums; pad 1-8, or omit pad to use the pad of that sound's category), volume 0-1, mute, solo, filter_hz (60-20000), reverb 0-1, pan -1..1, duck (synth sidechain to kick), mono, rename.",
    inputSchema: {
      type: "object",
      properties: { track: S_TRACK, create: { type: "string", enum: ["drums", "synth"] }, sound: { type: "string" }, pad: { type: "integer", minimum: 1, maximum: 8 }, volume: { type: "number" }, mute: { type: "boolean" }, solo: { type: "boolean" }, filter_hz: { type: "number" }, reverb: { type: "number" }, pan: { type: "number" }, duck: { type: "boolean" }, mono: { type: "boolean" }, rename: { type: "string" } }, // prettier-ignore
      required: ["track"],
    },
    run: (song, i) => setTrack(song, i as TrackInput),
  },
  {
    name: "delete_clips",
    kind: "edit",
    description: "Remove everything on a track from from_bar to to_bar inclusive, splitting clips at the edges.",
    inputSchema: {
      type: "object",
      properties: { track: S_TRACK, from_bar: S_START, to_bar: { type: "integer", minimum: 1 } },
      required: ["track", "from_bar", "to_bar"],
    },
    run: (song, i) => ({ summary: deleteBars(song, i.track, i.from_bar, i.to_bar), trackId: "" }),
  },
  {
    name: "set_song",
    kind: "edit",
    description: "Change tempo (bpm 80-170), key (C to B, e.g. F or F#), swing (50-66 percent) or the song name.",
    inputSchema: {
      type: "object",
      properties: {
        bpm: { type: "number" },
        key: { type: "string" },
        swing: { type: "number" },
        name: { type: "string" },
      },
    },
    run: (song, i) => ({ summary: setSong(song, i as SongInput), trackId: "" }),
  },
  {
    name: "design_sound",
    kind: "edit",
    description:
      "Make a new sound with the synth (or by reshaping a catalog sound) and add it to the song. Optionally put it on a track: a synth track plays it, a drum track gets it on a pad. Returns the new sound's id.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name, e.g. Rubber Acid Bass." },
        instrument: { type: "string", enum: INSTRUMENTS.map((x) => x.kind), description: "What kind of sound it is." },
        start_from: {
          type: "string",
          description: "Optional catalog sound id to start from (a synth preset, or a kit sample to reshape).",
        },
        settings: settingsSchema(),
        track: S_TRACK,
        pad: { type: "integer", minimum: 1, maximum: 8, description: "Drum track pad 1-8 (optional)." },
      },
      required: ["name", "instrument"],
    },
    run: (song, i) => addSound(song, i),
  },
  {
    name: "edit_sound",
    kind: "edit",
    description: "Change the settings (or name) of one of the song's own sounds. Every track using it updates.",
    inputSchema: {
      type: "object",
      properties: {
        sound: { type: "string", description: "The sound's id or name." },
        settings: settingsSchema(),
        rename: { type: "string" },
      },
      required: ["sound", "settings"],
    },
    run: (song, i) => editSound(song, i),
  },
  {
    name: "offer_variations",
    kind: "offer",
    description:
      "Show alternatives as cards the user can loop in place and keep. Use for 'show me', 'options', 'variations'. Each variation is a complete drums clip (lanes) or notes clip for one track and bar range. Nothing changes until the user keeps one.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        variations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" }, why: { type: "string", description: "One short sentence on how it fits." }, kind: { type: "string", enum: ["drums", "notes"] }, track: S_TRACK, start_bar: S_START, bars: S_BARS, pattern_bars: S_PAT,
              lanes: S_LANES, notes: S_NOTES, sound: { type: "string" }, replace: { type: "boolean", description: "Drums only. Default true: the variation is the whole pattern." },
            }, // prettier-ignore
            required: ["name", "kind", "track", "start_bar", "bars", "pattern_bars"],
          },
        },
      },
      required: ["variations"],
    },
  },
];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/** The sound settings as a JSON Schema object, from the same table the sound maker's knobs use. */
function settingsSchema(): Schema {
  const properties: Record<string, unknown> = {};
  for (const p of PARAMS) {
    if (p.key === "source") continue;
    if (isEnum(p)) properties[p.key] = { type: "string", enum: [...p.options], description: p.help };
    else if (isBool(p)) properties[p.key] = { type: "boolean", description: p.help };
    else
      properties[p.key] = {
        type: "number",
        minimum: p.min,
        maximum: p.max,
        description: p.help + (p.unit ? ` (${p.unit})` : ""),
      };
  }
  return {
    type: "object",
    properties,
    description: "Only the settings to change; everything else keeps its starting value.",
  };
}

/** offer_variations input -> specs (at most 6). Throws PatternError when empty. */
export function parseVariations(input: Input): { title: string; specs: VariationSpec[] } {
  const list = Array.isArray(input.variations) ? (input.variations as Input[]).slice(0, 6) : [];
  if (!list.length) throw new PatternError("variations is empty.");
  const specs = list.map((v, k): VariationSpec => {
    const kind = v.kind === "notes" || (Array.isArray(v.notes) && !Array.isArray(v.lanes)) ? "notes" : "drums";
    return {
      name: String(v.name || `Option ${k + 1}`).slice(0, 60),
      why: String(v.why || "").slice(0, 220),
      kind,
      track: v.track,
      start: bar0(v.start_bar),
      len: +(v.bars as number) || +(v.pattern_bars as number) || 1,
      loop: +(v.pattern_bars as number) || 1,
      lanes: v.lanes,
      notes: v.notes,
      sound: v.sound,
      replace: v.replace !== false,
    };
  });
  return { title: String(input.title || "Variations").slice(0, 80), specs };
}

/** Applies each spec to its own copy of the song; throws "Variation n: ..." for the first that fails. */
export function dryRunVariations(song: Song, specs: VariationSpec[]): void {
  specs.forEach((sp, k) => {
    try {
      applyVariation(structuredClone(song), sp);
    } catch (e) {
      throw new PatternError(`Variation ${k + 1}: ${(e as Error).message}`);
    }
  });
}

export const OFFER_RESULT = (n: number) =>
  `Shown ${n} variations as cards. The user will try them and keep one. Do not write them yourself.`;
