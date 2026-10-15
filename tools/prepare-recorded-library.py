"""Prepare an explicitly curated CC0/public-domain library. No changes to the original synth kit."""
import hashlib
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "assets/recorded-library"
CACHE = Path(sys.argv[1])
PLAN = json.loads((DIR / "import-plan.json").read_text())
INDEX = {f["asset"]: f for f in json.loads((CACHE / "index.json").read_text())}
RATE = 44100
files = {}
sounds = []
skipped = []
shot_hashes = {}


def digest(b):
    return hashlib.sha256(b).hexdigest()


def prepare(f, seconds):
    data, sr = sf.read(CACHE / f["asset"], dtype="float32", always_2d=True)
    if not np.isfinite(data).all():
        raise ValueError("Non-finite source: " + f["path"])
    mono = data.mean(axis=1)
    # Preserve antiphase recordings rather than canceling their sound on downmix.
    if np.mean(mono * mono) < np.max(np.mean(data * data, axis=0)) * 0.05:
        mono = data[:, np.argmax(np.mean(data * data, axis=0))]
    if sr != RATE:
        divisor = math.gcd(sr, RATE)
        mono = resample_poly(mono, RATE // divisor, sr // divisor)
    mono = mono - mono.mean()
    peak = np.max(np.abs(mono))
    if peak < 1e-5:
        raise ValueError("Silent source: " + f["path"])
    active = np.flatnonzero(np.abs(mono) > max(peak * 0.001, 1e-5))
    start = max(0, int(active[0]) - int(0.004 * RATE))
    end = min(len(mono), int(active[-1]) + int(0.04 * RATE), start + int(seconds * RATE))
    mono = mono[start:max(start + int(0.05 * RATE), end)].copy()
    return fade(mono)


def fade(d):
    n = min(int(0.001 * RATE), len(d) // 4)
    d[:n] *= np.linspace(0, 1, n)
    n = min(int(0.025 * RATE), len(d) // 4)
    d[-n:] *= np.linspace(1, 0, n)
    return d


def wav(d):
    out = io.BytesIO()
    sf.write(out, d, RATE, format="WAV", subtype="PCM_16")
    return out.getvalue()


def tune_kalimba(d, root):
    """The traditional mbira has uneven tuning; align its recorded tone to the labeled MIDI key."""
    expected = 440 * 2 ** ((root - 69) / 12)
    segment = d[int(0.15 * RATE):min(len(d), int(1.1 * RATE))]
    spectrum = np.abs(np.fft.rfft(segment * np.hanning(len(segment)), n=262144))
    frequencies = np.fft.rfftfreq(262144, 1 / RATE)
    candidates = np.flatnonzero((frequencies > expected / 2 ** (1 / 12)) & (frequencies < expected * 2 ** (1 / 12)))
    index = candidates[np.argmax(spectrum[candidates])]
    measured = frequencies[index]
    speed = expected / measured
    out = np.interp(np.arange(int(len(d) / speed)) * speed, np.arange(len(d)), d).astype("float32")
    return fade(out)


def save(asset, d, source=None):
    b = wav(d)
    (DIR / (asset + ".wav")).write_bytes(b)
    meta = {"asset": asset, "sha256": digest(b), "bytes": len(b), "seconds": len(d) / RATE}
    if source:
        original = INDEX[source["asset"]]
        meta.update({"source": original["source"], "sourcePath": original["path"], "sourceSha256": original["sourceSha256"]})
        if "root" in source:
            meta["root"] = source["root"]
    files[asset] = meta


for item in PLAN["sounds"]:
    data = [(f, prepare(f, item["maxSeconds"])) for f in item["files"]]
    if item["name"] == "Tanzanian Kalimba":
        data = [(f, tune_kalimba(d, f["root"])) for f, d in data]
    gain = 0.891 / max(float(np.max(np.abs(d))) for _, d in data)
    data = [(f, d * gain) for f, d in data]
    pitched = "root" in data[0][0]
    if pitched:
        for f, d in data:
            save(f["asset"], d, f)
        f, d = min(data, key=lambda pair: (abs(pair[0]["root"] - 36), -pair[0]["maxVelocity"]))
        rate = 2 ** ((36 - f["root"]) / 12)
        reference = np.interp(np.arange(min(int(len(d) / rate), RATE * 6)) * rate, np.arange(len(d)), d).astype("float32")
        reference = fade(reference)
        groups = {}
        for f, _ in data:
            key = (f["root"], f["maxVelocity"])
            groups.setdefault(key, []).append(f["asset"])
        zones = [{"root": r, "maxVelocity": v, "files": values} for (r, v), values in sorted(groups.items())]
    else:
        reference = data[0][1]
        content_hash = digest(wav(reference))
        if content_hash in shot_hashes:
            skipped.append({"id": item["id"], "sameAs": shot_hashes[content_hash], "reason": "identical prepared audio"})
            continue
        shot_hashes[content_hash] = item["id"]
    save(item["id"], reference, data[0][0] if not pitched else None)
    source = PLAN["sources"][item["source"]]
    bins = [round(float(np.max(np.abs(chunk))), 3) for chunk in np.array_split(reference, 60)]
    sound = {"id": item["id"], "kind": item["kind"], "name": item["name"], "description": item["description"],
             "note": "", "hz": 0, "dur": len(reference) / RATE, "peaks": bins, "tags": item["tags"],
             "recording": {"pack": source["pack"], "author": source["author"], "license": source["license"], "source": "https://github.com/" + source["repo"]}}
    if pitched:
        sound["sampleMap"] = zones
        sound["previewNote"] = min((z["root"] for z in zones), key=lambda root: abs(root - item["previewNote"]))
    sounds.append(sound)
    if len(sounds) % 50 == 0:
        print(f"Prepared {len(sounds)} library sounds", flush=True)

manifest = {"version": 1, "sources": PLAN["sources"], "sounds": sounds, "files": list(files.values()), "skipped": skipped}
(DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
for path in DIR.glob("*.wav"):
    if path.stem not in files:
        path.unlink()
print(f"Ready: {len(sounds)} sounds, {len(files)} WAV files, {len(skipped)} duplicates excluded", flush=True)
