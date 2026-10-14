"""Renders the whole kit into a temporary folder and compares it with assets/checksums.md5.

    python tools/reproduce_kit.py            # strict: every file must be bit-identical
    python tools/reproduce_kit.py --lsb 1    # also accept files within 1 LSB (24-bit) of the original

Proves the sound engine still produces the committed files without touching assets/.
Floating-point libraries differ slightly between CPUs (e.g. Apple Silicon vs x86 numpy sin),
so a file can differ by one least-significant bit in a sample or two; --lsb reports those
separately instead of failing. CI runs the strict check.
Exit code is non-zero if any file is missing or differs beyond the tolerance.
"""
import argparse, hashlib, os, subprocess, sys, tempfile

import numpy as np
import soundfile as sf

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ASSETS = os.path.join(ROOT, "assets")


def lsb_diff(a_path, b_path):
    a, _ = sf.read(a_path, dtype="int32")
    b, _ = sf.read(b_path, dtype="int32")
    if a.shape != b.shape:
        return None, None
    d = np.abs((a >> 8).astype(np.int64) - (b >> 8).astype(np.int64))
    return int(d.max()), int((d > 0).sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lsb", type=int, default=0, help="accept files whose samples differ by at most this many 24-bit LSBs")
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "TechHouse_Synth_Kit")
        env = dict(os.environ, THK_KIT_OUT=out)
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "sound-engine", "build_kit.py")], env=env, check=True)
        exact = near = bad = total = 0
        for line in open(os.path.join(ASSETS, "checksums.md5")):
            digest, rel = line.split(maxsplit=1)
            rel = rel.strip()
            total += 1
            path = os.path.join(tmp, rel)
            if not os.path.exists(path):
                bad += 1
                print("MISSING", rel)
                continue
            if hashlib.md5(open(path, "rb").read()).hexdigest() == digest:
                exact += 1
                continue
            mx, n = lsb_diff(os.path.join(ASSETS, rel), path)
            if mx is not None and mx <= args.lsb:
                near += 1
                print(f"WITHIN {mx} LSB ({n} samples)", rel)
            else:
                bad += 1
                print("DIFFERS", rel, "" if mx is None else f"max {mx} LSB over {n} samples")
        print(f"{exact}/{total} bit-identical" + (f", {near} within {args.lsb} LSB" if args.lsb else "") + f", {bad} failed")
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
