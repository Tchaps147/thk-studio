"""Renders the whole kit in a fixed order so earlier sounds stay bit-identical across versions.

Run from anywhere: python sound-engine/build_kit.py  (writes assets/TechHouse_Synth_Kit, assets/kit_meta.json, assets/kit_alias.json).
Random streams: batch 1 uses seed 7, batch 2 + the 12 original perc use 2026, the v3 drums use 77.
NEVER reorder or insert renders before existing ones; only append, or every later sound changes."""
import json, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import soundfile as sf
import synth_kit as K
import drums2 as D

OUT = K.OUT
shutil.rmtree(OUT, ignore_errors=True)
for d in ["Kicks", "Bass"] + [f for f, _ in D.CATS.values()]:
    os.makedirs(f"{OUT}/{d}", exist_ok=True)
meta, alias = [], {}
counters = {c: 0 for c in D.CATS}

def write_drum(cat, name, x):
    counters[cat] += 1
    folder, prefix = D.CATS[cat]
    sid = f"THK_{prefix}_{counters[cat]:02d}_{name}"
    sf.write(f"{OUT}/{folder}/{sid}.wav", x, K.SR, subtype="PCM_24")
    meta.append(dict(file=f"{folder}/{sid}.wav", kind=cat, name=name.replace("_", " "), note="", hz=0, dur=round(len(x) / K.SR, 2)))
    return sid

K.rng = np.random.default_rng(7)
K.write_kicks(K.KICKS, 1, meta); K.write_basses(K.BASSES, 1, meta)
K.rng = np.random.default_rng(2026)
K.write_kicks(K.KICKS_2, 21, meta); K.write_basses(K.BASSES_2, 21, meta)
for i, (old, cat, name) in enumerate(D.OLD_PERC, 1):        # same render order as v2
    sid = write_drum(cat, name, K.perc(old))
    alias[f"THK_Perc_{i:02d}_{old}"] = sid
K.rng = np.random.default_rng(77)
order = list(D.CATS)
for cat in order:                                            # new sounds, grouped by category
    for c, name, fn in D.NEW:
        if c == cat:
            write_drum(cat, name, K.finish(fn(), hp=40))
ASSETS = os.path.dirname(os.path.abspath(OUT))
json.dump(meta, open(os.path.join(ASSETS, "kit_meta.json"), "w"), indent=1)
json.dump(alias, open(os.path.join(ASSETS, "kit_alias.json"), "w"), indent=1)
ids = {os.path.splitext(os.path.basename(m["file"]))[0] for m in meta}
print(len(meta), "files;", {c: counters[c] for c in order}, "| alias collisions:", [a for a in alias if a in ids])
