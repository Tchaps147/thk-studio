"""Checks every sound in assets/: format, levels, DC, NaN, tuning, and (optionally) checksums.

    python sound-engine/verify_kit.py            # quality checks
    python sound-engine/verify_kit.py --md5      # also compare against assets/checksums.md5

Kicks must have their tail within 30 cents of the note in their name; basses must be rooted on C2 (65.41 Hz).
Exit code is non-zero if anything fails.
"""
import hashlib, json, os, sys
import numpy as np
import soundfile as sf

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets")
KIT = os.path.join(ASSETS, "TechHouse_Synth_Kit")


def measured_pitch(x, sr, kind, target):
    env = np.abs(x); k = int(0.01 * sr); sm = np.convolve(env, np.ones(k) / k, "same")
    start = int((0.12 if kind == "kick" else 0.08) * sr)
    above = np.where(sm > sm.max() * 10 ** (-30 / 20))[0]
    end = max(above[-1], start + int(0.08 * sr))
    seg = x[start:end] * np.hanning(end - start)
    N = 1 << 20; S = np.abs(np.fft.rfft(seg, N)); f = np.fft.rfftfreq(N, 1 / sr)
    band = (f > target * 0.75) & (f < target * 1.3)
    return f[band][np.argmax(S[band])]


def main():
    meta = json.load(open(os.path.join(ASSETS, "kit_meta.json")))
    failures = 0
    for m in meta:
        path = os.path.join(KIT, m["file"])
        x, sr = sf.read(path); info = sf.info(path)
        problems = []
        if info.subtype != "PCM_24" or sr != 44100: problems.append("format")
        if np.isnan(x).any(): problems.append("NaN")
        if np.max(np.abs(x)) > 0.9: problems.append("peak above -1 dBFS")
        if abs(np.mean(x)) > 0.01: problems.append("DC offset")
        note = ""
        if m["kind"] in ("kick", "bass"):
            fp = measured_pitch(x, sr, m["kind"], m["hz"]); cents = 1200 * np.log2(fp / m["hz"])
            note = f"{cents:+.1f} c"
            if abs(cents) > 30: problems.append(f"tuning {cents:+.0f} cents")
        failures += bool(problems)
        if problems: print(f"FAIL {m['file']}: {', '.join(problems)} {note}")
    print(f"{len(meta)} sounds checked, {failures} failed")
    if "--md5" in sys.argv:
        bad = 0
        for line in open(os.path.join(ASSETS, "checksums.md5")):
            digest, rel = line.split(maxsplit=1); rel = rel.strip()
            got = hashlib.md5(open(os.path.join(ASSETS, rel), "rb").read()).hexdigest()
            if got != digest: bad += 1; print("CHECKSUM MISMATCH", rel)
        print("checksums:", "all match" if not bad else f"{bad} differ")
        failures += bad
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
