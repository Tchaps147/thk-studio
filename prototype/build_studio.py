"""Builds the single-file prototype: embeds every WAV (as 16-bit base64) and the alias map into the template.

    python prototype/build_studio.py      ->  prototype/dist/studio.html  (~8 MB)

The output is what was published as the claude.ai artifact. It expects the claude.ai artifact runtime
(window.claude) for cloud save, export and the assistant; without it those features hide themselves.
"""
import base64, io, json, os, re
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
KIT = os.path.join(ASSETS, "TechHouse_Synth_Kit")
ORDER = ["kick", "clap", "snare", "hat_closed", "hat_open", "ride", "shaker", "rim", "perc", "tom", "bass"]

meta = json.load(open(os.path.join(ASSETS, "kit_meta.json")))
alias = json.load(open(os.path.join(ASSETS, "kit_alias.json")))
meta.sort(key=lambda m: (ORDER.index(m["kind"]), m["file"]))
out = []
for m in meta:
    x, sr = sf.read(os.path.join(KIT, m["file"]))
    buf = io.BytesIO(); sf.write(buf, x, sr, format="WAV", subtype="PCM_16")
    peaks = [round(float(c.max()), 3) for c in np.array_split(np.abs(x), 60)]
    sid = os.path.splitext(os.path.basename(m["file"]))[0]
    out.append({"id": sid, "kind": m["kind"], "name": m["name"], "note": m["note"], "dur": m["dur"], "peaks": peaks,
                "b64": base64.b64encode(buf.getvalue()).decode()})

tpl = open(os.path.join(HERE, "studio.template.html")).read()
ids = {o["id"] for o in out}
missing = [i for i in set(re.findall(r'"(THK_[A-Za-z0-9_]+)"', tpl)) if i not in ids and i not in alias]
assert not missing, f"template references unknown sound ids: {missing}"
html = tpl.replace("__ALIAS__", json.dumps(alias)).replace("__DATA__", json.dumps(out, separators=(",", ":")))
os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
open(os.path.join(HERE, "dist", "studio.html"), "w").write(html)
print(f"{len(out)} sounds -> prototype/dist/studio.html ({len(html) / 1e6:.1f} MB)")
