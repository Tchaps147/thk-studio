import { renderOffline } from "@thk/audio";
import { encodeMidi, encodeWav, exportReadme, makeZip, slug, type Song } from "@thk/song";
import { audio } from "./audio.ts";

/** Renders the song and packs the WAV mixdown, a MIDI file and a README into one zip. */
export async function buildExport(song: Song): Promise<{ filename: string; zip: Uint8Array; buffer: AudioBuffer }> {
  const { bank } = audio();
  await bank.loadSong(song);
  const buffer = await renderOffline(song, bank);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const base = slug(song.name);
  const zip = makeZip([
    { name: base + ".wav", data: encodeWav(channels, buffer.sampleRate) },
    { name: base + ".mid", data: encodeMidi(song) },
    { name: "README.txt", data: new TextEncoder().encode(exportReadme(song)) },
  ]);
  return { filename: base + ".zip", zip, buffer };
}

export function download(filename: string, data: Uint8Array, type = "application/zip") {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
