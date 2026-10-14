"""Tech house kick + bass one-shot generator. Pure synthesis, 44.1 kHz / 24-bit WAV."""
import json, os
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly, butter, sosfilt

SR = 44100
OS = 8  # oversampling factor for aliasing-prone oscillators
OUT = os.environ.get("THK_KIT_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "TechHouse_Synth_Kit"))
NOTES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
rng = np.random.default_rng(7)


def hz(note):
    name, octave = note[:-1], int(note[-1])
    midi = 12 * (octave + 1) + NOTES[name]
    return 440.0 * 2 ** ((midi - 69) / 12)


def tvec(dur, sr=SR):
    return np.arange(int(dur * sr)) / sr


def phase_from(freq, sr=SR):
    return np.cumsum(freq) / sr  # in cycles


# ---------- oscillators ----------
def osc(freq, shape="sine", pw=0.5, phase0=0.0):
    """freq: per-sample array at SR. Non-sine shapes are rendered at OS x and decimated."""
    if shape == "sine":
        return np.sin(2 * np.pi * (phase_from(freq) + phase0))
    f_os = np.repeat(freq, OS)
    ph = (phase_from(f_os, SR * OS) + phase0) % 1.0
    if shape == "saw":
        y = 1 - 2 * ph  # polarity chosen so the fundamental is in phase with sine/square
    elif shape == "square":
        y = np.where(ph < 0.5, 1.0, -1.0)
    elif shape == "pulse":
        pw_os = np.repeat(np.broadcast_to(pw, freq.shape), OS)
        y = np.where(ph < pw_os, 1.0, -1.0)
    elif shape == "tri":
        y = 4 * np.abs(ph - 0.5) - 1
    y = resample_poly(y, 1, OS)
    return y[: len(freq)]


def svf(x, fc, q=0.707, mode="lp", drive=0.0):
    """TPT state-variable filter with per-sample cutoff."""
    fc = np.clip(np.broadcast_to(fc, x.shape).astype(float), 10, SR * 0.45)
    g = np.tan(np.pi * fc / SR)
    k = 1.0 / q
    a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2
    out = np.empty_like(x)
    ic1 = ic2 = 0.0
    xs = np.tanh(x * drive) / np.tanh(drive) if drive > 0 else x
    for n in range(len(x)):
        v3 = xs[n] - ic2
        v1 = a1[n] * ic1 + a2[n] * v3
        v2 = ic2 + a2[n] * ic1 + a3[n] * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        if mode == "lp":
            out[n] = v2
        elif mode == "bp":
            out[n] = v1
        else:
            out[n] = xs[n] - k * v1 - v2
    return out


# ---------- helpers ----------
def sat(x, drive):
    return np.tanh(x * drive) / np.tanh(drive)


def decay(t, tau, hold=0.0):
    return np.where(t < hold, 1.0, np.exp(-(t - hold) / tau))


def adsr(t, a, d, s, r_start, r):
    env = np.interp(t, [0, a, a + d], [0, 1, s])
    rel = np.clip((t - r_start) / r, 0, 1)
    return env * np.where(t > r_start, np.exp(-5 * rel), 1.0)


def fade(x, fin=0.0, fout=0.012):
    n_in, n_out = int(fin * SR), int(fout * SR)
    if n_in:
        x[:n_in] *= np.linspace(0, 1, n_in)
    x[-n_out:] *= np.cos(np.linspace(0, np.pi / 2, n_out)) ** 2
    return x


def highpass(x, fc):
    return sosfilt(butter(2, fc, "hp", fs=SR, output="sos"), x)


def lowpass(x, fc, order=2):
    return sosfilt(butter(order, fc, "lp", fs=SR, output="sos"), x)


def finish(x, hp=18, fin=0.0):
    x = highpass(x, hp)
    x = fade(x, fin)
    return x / np.max(np.abs(x)) * 10 ** (-1 / 20)  # peak -1 dBFS


# ---------- kick engine ----------
def kick(note, dur, f_start, tau1, amp_tau, hold=0.0, f_mid=None, tau2=0.0,
         shape="sine", click=0.0, click_tone=3500, noise=0.0, noise_tau=0.02,
         drive=1.0, hard_clip=None, lp=None, start_phase=0.0, partial2=0.0, crush=0.0):
    t = tvec(dur)
    f_end = hz(note)
    if f_mid:  # two-stage sweep: fast drop to f_mid, slower settle to note
        f = f_end + (f_mid - f_end) * np.exp(-t / tau2) + (f_start - f_mid) * np.exp(-t / tau1)
    else:
        f = f_end + (f_start - f_end) * np.exp(-t / tau1)
    body = osc(f, shape, phase0=start_phase)
    if partial2:
        body += partial2 * np.sin(2 * np.pi * phase_from(f * 2.0)) * decay(t, 0.04)
    env = decay(t, amp_tau, hold)
    x = body * env
    if click:
        n = rng.standard_normal(len(t))
        c = svf(n, click_tone, 1.2, "bp") * decay(t, 0.0025) * 1.2
        c += 0.5 * np.sin(2 * np.pi * click_tone * 0.6 * t) * decay(t, 0.0015)
        x += click * c
    if noise:
        n = highpass(rng.standard_normal(len(t)), 2500)
        x += noise * n * decay(t, noise_tau)
    if crush:
        k = np.round(x * 24) / 24
        k = np.repeat(k[::6], 6)[: len(x)]
        mix = decay(t, 0.05) * crush
        x = x * (1 - mix) + k * mix
    if drive > 1:
        x = sat(x, drive)
    if hard_clip:
        x = np.clip(x * hard_clip, -1, 1)
    if lp:
        x = lowpass(x, lp)
    return finish(x)


KICKS = [
    ("Punchy_Tight", "F1", dict(dur=0.32, f_start=420, tau1=0.018, amp_tau=0.09, hold=0.03, click=0.25)),
    ("Classic_909", "G1", dict(dur=0.5, f_start=600, tau1=0.006, f_mid=160, tau2=0.035, amp_tau=0.14, hold=0.02, noise=0.08, drive=1.6)),
    ("Long_Boom", "F1", dict(dur=0.95, f_start=300, tau1=0.03, amp_tau=0.35, hold=0.06, drive=1.3)),
    ("Rumble_Base", "E1", dict(dur=1.1, f_start=260, tau1=0.04, amp_tau=0.45, hold=0.08, drive=2.2, lp=900)),
    ("Clicky_Top", "A1", dict(dur=0.4, f_start=500, tau1=0.012, amp_tau=0.11, hold=0.025, click=0.9, click_tone=4500)),
    ("Driven_Saturated", "G1", dict(dur=0.55, f_start=450, tau1=0.02, amp_tau=0.16, hold=0.03, drive=4.0)),
    ("Soft_Round", "F1", dict(dur=0.5, f_start=170, tau1=0.03, amp_tau=0.15, hold=0.02, lp=2500)),
    ("Knock_Short", "A#1", dict(dur=0.22, f_start=380, tau1=0.012, amp_tau=0.05, hold=0.015, drive=1.8, partial2=0.25)),
    ("Deep_Sub", "D1", dict(dur=1.0, f_start=220, tau1=0.035, amp_tau=0.4, hold=0.05, drive=1.2)),
    ("Thumpy_808ish", "F1", dict(dur=1.2, f_start=170, tau1=0.03, amp_tau=0.6, hold=0.02, drive=1.4)),
    ("Distorted_Hard", "G1", dict(dur=0.5, f_start=700, tau1=0.015, amp_tau=0.14, hold=0.04, drive=3.0, hard_clip=2.2, lp=7000)),
    ("Minimal_Tick", "A1", dict(dur=0.28, f_start=350, tau1=0.01, amp_tau=0.07, hold=0.015, click=0.6, click_tone=7000)),
    ("Tape_Warm", "F#1", dict(dur=0.55, f_start=320, tau1=0.025, amp_tau=0.17, hold=0.03, drive=2.0, lp=3000)),
    ("Snappy_Sweep", "G1", dict(dur=0.42, f_start=1200, tau1=0.007, amp_tau=0.12, hold=0.025, drive=1.5)),
    ("Noise_Layered", "F1", dict(dur=0.5, f_start=400, tau1=0.02, amp_tau=0.14, hold=0.03, noise=0.35, noise_tau=0.035)),
    ("Triangle_Body", "A1", dict(dur=0.45, f_start=400, tau1=0.02, amp_tau=0.12, hold=0.03, shape="tri", lp=4000)),
    ("Boxy_Mid", "G#1", dict(dur=0.4, f_start=480, tau1=0.018, amp_tau=0.1, hold=0.025, partial2=0.6, drive=1.6)),
    ("Hollow_Long", "E1", dict(dur=0.85, f_start=280, tau1=0.028, amp_tau=0.3, hold=0.05, drive=1.2, start_phase=0.25)),
    ("Crunchy_Crush", "G1", dict(dur=0.45, f_start=520, tau1=0.016, amp_tau=0.13, hold=0.03, crush=0.8, drive=1.6)),
    ("Big_Tech", "F1", dict(dur=0.75, f_start=550, tau1=0.008, f_mid=180, tau2=0.04, amp_tau=0.24, hold=0.05, click=0.35, drive=2.4)),
]

# Second batch (21-30). Rendered after the first batch with its own random stream,
# so kicks/basses 01-20 stay bit-identical to the first release.
KICKS_2 = [
    ("Sub_Thud", "D1", dict(dur=0.9, f_start=150, tau1=0.03, amp_tau=0.32, hold=0.04, drive=1.3, lp=1800)),
    ("Punch_Drive", "A1", dict(dur=0.36, f_start=600, tau1=0.012, amp_tau=0.09, hold=0.035, drive=3.2, click=0.2)),
    ("Pillow_Soft", "G1", dict(dur=0.45, f_start=140, tau1=0.025, amp_tau=0.13, hold=0.02, lp=1400)),
    ("Lofi_Dusty", "F1", dict(dur=0.5, f_start=380, tau1=0.02, amp_tau=0.14, hold=0.03, crush=1.0, noise=0.12, noise_tau=0.06, lp=5000, drive=1.8)),
    ("Chest_Punch", "G#1", dict(dur=0.5, f_start=900, tau1=0.005, f_mid=240, tau2=0.03, amp_tau=0.14, hold=0.04, drive=2.0)),
    ("Hard_Tech", "E1", dict(dur=0.7, f_start=650, tau1=0.012, amp_tau=0.22, hold=0.06, drive=3.5, hard_clip=2.8, lp=6000)),
    ("Woody_Knock", "B1", dict(dur=0.26, f_start=420, tau1=0.01, amp_tau=0.055, hold=0.012, shape="tri", partial2=0.4, lp=3500)),
    ("Deep_House", "F1", dict(dur=0.6, f_start=260, tau1=0.022, amp_tau=0.18, hold=0.035, click=0.15, click_tone=2500, drive=1.4)),
    ("Stomp_Long", "D#1", dict(dur=1.05, f_start=480, tau1=0.016, amp_tau=0.4, hold=0.07, drive=2.6, lp=4000)),
    ("Zap_Sweep", "A1", dict(dur=0.4, f_start=2400, tau1=0.004, amp_tau=0.11, hold=0.025, drive=1.4)),
]


# ---------- bass engine ----------
ROOT = "C2"


def bass(name):
    f0 = hz(ROOT)
    if name == "Sub_Pluck":
        t = tvec(0.6); f = f0 * (1 + 0.6 * np.exp(-t / 0.008))
        x = sat(osc(f) * decay(t, 0.16, 0.05), 1.5)
    elif name == "Rolling_Saw_Pluck":
        t = tvec(0.45); f = np.full(len(t), f0)
        x = svf(osc(f, "saw"), 180 + 2200 * np.exp(-t / 0.04), 1.4) * decay(t, 0.12, 0.04)
        x += 0.5 * osc(f) * decay(t, 0.14, 0.04)
    elif name == "Rubber_Bend":
        t = tvec(0.7); f = f0 * 2 ** (7 / 12 * np.exp(-t / 0.035))
        x = svf(osc(f, "tri") + 0.6 * osc(f), 900, 1.0) * decay(t, 0.22, 0.06)
        x = sat(x, 2.0)
    elif name == "Acid_303":
        t = tvec(0.55); f = np.full(len(t), f0)
        x = svf(osc(f, "saw"), 250 + 3200 * np.exp(-t / 0.09), 7.0, drive=1.5) * decay(t, 0.18, 0.06)
        x = sat(x, 2.5)
    elif name == "Acid_Square":
        t = tvec(0.55); f = np.full(len(t), f0)
        x = svf(osc(f, "square"), 300 + 2500 * np.exp(-t / 0.07), 6.0, drive=1.3) * decay(t, 0.16, 0.05)
        x = sat(x, 2.0)
    elif name == "Organ_M1":
        t = tvec(0.6); ph = 2 * np.pi * f0 * t
        x = np.sin(ph) + 0.8 * np.sin(2 * ph) + 0.5 * np.sin(3 * ph) + 0.35 * np.sin(4 * ph) + 0.2 * np.sin(6 * ph)
        x = x * adsr(t, 0.002, 0.12, 0.55, 0.32, 0.25)
        x += 0.4 * svf(rng.standard_normal(len(t)), 2500, 2, "bp") * decay(t, 0.004)  # key click
    elif name == "FM_Growl":
        t = tvec(0.9); idx = 0.8 + 4.5 * np.exp(-t / 0.18)
        mod = np.sin(2 * np.pi * f0 * 1.0 * t) * idx
        x = np.sin(2 * np.pi * f0 * t + mod) * adsr(t, 0.004, 0.2, 0.6, 0.6, 0.25)
        x = svf(sat(x, 2.0), 2200, 0.9)
    elif name == "FM_Pluck":
        t = tvec(0.5); idx = 3.5 * np.exp(-t / 0.05)
        x = np.sin(2 * np.pi * f0 * t + idx * np.sin(2 * np.pi * f0 * 2 * t)) * decay(t, 0.14, 0.03)
    elif name == "Reese_Detuned":
        t = tvec(2.0); x = 0
        for c in (-14, -5, 6, 15):
            x = x + osc(np.full(len(t), f0 * 2 ** (c / 1200)), "saw", phase0=rng.random())
        x = svf(x / 4, 650, 1.1) * adsr(t, 0.01, 0.3, 0.85, 1.6, 0.4)
        x = sat(x * 1.5, 1.8) + 0.6 * osc(np.full(len(t), f0)) * adsr(t, 0.01, 0.3, 0.85, 1.6, 0.4)
    elif name == "Sub_Sustain":
        t = tvec(1.6); x = sat(osc(np.full(len(t), f0)), 1.3) * adsr(t, 0.004, 0.2, 0.9, 1.3, 0.3)
    elif name == "Donk":
        t = tvec(0.4); f = f0 * 2 * 2 ** (12 / 12 * np.exp(-t / 0.012))
        x = osc(f) * decay(t, 0.07, 0.01) + 0.7 * osc(np.full(len(t), f0)) * decay(t, 0.12, 0.02)
        x = sat(x, 2.0)
    elif name == "Square_Stab":
        t = tvec(0.35); f = np.full(len(t), f0)
        x = svf(osc(f, "square"), 200 + 1400 * np.exp(-t / 0.03), 1.0) * decay(t, 0.09, 0.03)
    elif name == "Wobble_Filter":
        t = tvec(2.0); lfo = 0.5 - 0.5 * np.cos(2 * np.pi * (125 / 60 * 2) * t)  # 1/8 notes @125
        f = np.full(len(t), f0)
        x = svf(osc(f, "saw") + 0.5 * osc(f, "square"), 150 + 1600 * lfo, 3.0, drive=1.2)
        x = sat(x * adsr(t, 0.01, 0.2, 0.9, 1.7, 0.3), 1.8)
    elif name == "Fold_Grit":
        t = tvec(0.7); amt = 1 + 4 * np.exp(-t / 0.12)
        x = np.sin(np.sin(2 * np.pi * f0 * t) * amt * np.pi / 2)  # wavefolder
        x = lowpass(x * decay(t, 0.22, 0.05), 4000)
    elif name == "Hollow_Pulse":
        t = tvec(0.8); pw = 0.25 + 0.15 * np.sin(2 * np.pi * 1.5 * t)
        x = svf(osc(np.full(len(t), f0), "pulse", pw=pw), 300 + 900 * np.exp(-t / 0.12), 1.5)
        x = x * adsr(t, 0.003, 0.25, 0.5, 0.55, 0.25)
    elif name == "Plucky_Chicago":
        t = tvec(0.3); f = np.full(len(t), f0)
        x = svf(osc(f, "saw"), 150 + 4000 * np.exp(-t / 0.015), 1.8) * decay(t, 0.07, 0.015)
        x += 0.15 * highpass(rng.standard_normal(len(t)), 1500) * decay(t, 0.004)
        x += 0.6 * osc(f) * decay(t, 0.08, 0.02)
    elif name == "Talky_Formant":
        t = tvec(0.9); src = osc(np.full(len(t), f0), "saw")
        m = np.clip(t / 0.5, 0, 1)  # "oh" -> "ah"
        x = svf(src, 400 + 400 * m, 6, "bp") + 0.7 * svf(src, 800 + 400 * m, 7, "bp")
        x = sat(x * 3, 1.5) * adsr(t, 0.005, 0.3, 0.7, 0.65, 0.25) + 0.5 * osc(np.full(len(t), f0)) * adsr(t, 0.005, 0.3, 0.7, 0.65, 0.25)
    elif name == "Gritty_Driven":
        t = tvec(0.6); f = np.full(len(t), f0)
        x = osc(f, "saw") + osc(f * 1.003, "square")
        x = svf(sat(x * 3, 4.0), 400 + 2000 * np.exp(-t / 0.1), 1.6) * decay(t, 0.2, 0.06)
    elif name == "Sub_Octave_Layer":
        t = tvec(0.8); f = np.full(len(t), f0)
        x = osc(f) * adsr(t, 0.003, 0.2, 0.8, 0.5, 0.25)
        x += 0.45 * svf(osc(f * 2, "saw"), 1200 * np.exp(-t / 0.15) + 300, 1.2) * decay(t, 0.15, 0.03)
    elif name == "Filter_Swell":
        t = tvec(1.8); f = np.full(len(t), f0)
        env = adsr(t, 0.02, 0.1, 1.0, 1.5, 0.3)
        x = svf(osc(f, "saw") + 0.5 * osc(f * 0.998, "saw"), 120 + 2600 * (t / 1.8) ** 2, 4.0) * env
        x = sat(x, 1.6) + 0.5 * osc(f) * env
    # ----- batch 2 -----
    elif name == "Sub_Glide_Up":
        t = tvec(0.8); f = f0 * 2 ** (-12 / 12 * np.exp(-t / 0.05))
        x = sat(osc(f), 1.4) * adsr(t, 0.004, 0.2, 0.8, 0.55, 0.25)
    elif name == "Detroit_Pulse_Pluck":
        t = tvec(0.5); f = np.full(len(t), f0); pw = 0.5 - 0.35 * np.exp(-t / 0.08)
        x = svf(osc(f, "pulse", pw=pw), 220 + 2600 * np.exp(-t / 0.05), 3.5, drive=1.2) * decay(t, 0.13, 0.04)
        x += 0.5 * osc(f) * decay(t, 0.15, 0.04)
    elif name == "FM_Tick":
        t = tvec(0.35); idx = 6.0 * np.exp(-t / 0.012)
        x = np.sin(2 * np.pi * f0 * t + idx * np.sin(2 * np.pi * f0 * 3 * t)) * decay(t, 0.08, 0.015)
    elif name == "Tok":
        t = tvec(0.22); f = np.full(len(t), f0)
        x = svf(osc(f, "tri") + 0.4 * osc(f, "square"), 150 + 1800 * np.exp(-t / 0.01), 2.0) * decay(t, 0.045, 0.008)
        x += 0.7 * osc(f) * decay(t, 0.05, 0.01)
    elif name == "Fat_Ladder":
        t = tvec(0.7); x = 0
        for c in (-7, 0, 7):
            x = x + osc(np.full(len(t), f0 * 2 ** (c / 1200)), "saw", phase0=rng.random())
        x = svf(sat(x / 2, 2.0), 200 + 1600 * np.exp(-t / 0.12), 2.2) * decay(t, 0.22, 0.06)
        x = sat(x * 1.5, 1.8) + 0.5 * osc(np.full(len(t), f0)) * decay(t, 0.22, 0.06)
    elif name == "Octave_Drop_Zap":
        t = tvec(0.6); f = f0 * 2 ** (12 / 12 * np.exp(-t / 0.02))
        x = svf(osc(f, "saw"), 1400 * np.exp(-t / 0.1) + 250, 1.5) + 0.7 * osc(f)
        x = sat(x * decay(t, 0.17, 0.04), 2.0)
    elif name == "Flanged_Saw":
        t = tvec(1.3); f = np.full(len(t), f0); s = svf(osc(f, "saw"), 1100, 1.0)
        d = (0.0015 + 0.0012 * np.sin(2 * np.pi * 0.7 * t)) * SR  # moving delay = flanger
        idx = np.arange(len(t)) - d
        x = s + 0.8 * np.interp(idx, np.arange(len(t)), s, left=0)
        x = x * adsr(t, 0.005, 0.25, 0.75, 1.0, 0.3) + 0.6 * osc(f) * adsr(t, 0.005, 0.25, 0.75, 1.0, 0.3)
    elif name == "Ring_Mod_Bell":
        t = tvec(0.6); ph = 2 * np.pi * f0 * t
        x = np.sin(ph) * np.sin(2 * ph) * decay(t, 0.09, 0.01) * 1.5 + np.sin(ph) * decay(t, 0.18, 0.03)
    elif name == "Distorted_808":
        t = tvec(1.4); f = f0 * (1 + 0.35 * np.exp(-t / 0.02))
        x = sat(osc(f) * decay(t, 0.5, 0.08) * 1.0, 5.0)
        x = lowpass(x, 3000)
    elif name == "Fifth_Stab":
        t = tvec(0.45); x = 0
        for ratio in (1, 1.4983, 2):  # root, fifth, octave
            x = x + osc(np.full(len(t), f0 * ratio), "saw", phase0=rng.random())
        x = svf(x / 2, 300 + 3000 * np.exp(-t / 0.06), 2.0) * decay(t, 0.11, 0.04)
        x += 0.6 * osc(np.full(len(t), f0)) * decay(t, 0.12, 0.04)
    return finish(x, hp=20, fin=0.002)


# ---------- percussion (for the drum rack) ----------
def perc(name):
    if name.startswith("Clap"):
        tail, bp, spread = {"Clap_Classic": (0.11, 1200, 0.011), "Clap_Tight": (0.06, 1500, 0.007), "Clap_Wide": (0.22, 1000, 0.014)}[name]
        t = tvec(tail * 4 + 0.05); n = rng.standard_normal(len(t))
        env = np.zeros(len(t))
        for k in range(3):
            env = np.maximum(env, np.where(t >= k * spread, np.exp(-(t - k * spread) / 0.006), 0))
        env = np.maximum(env, np.where(t >= 3 * spread, np.exp(-(t - 3 * spread) / tail) * 0.8, 0))
        x = svf(n, bp, 1.4, "bp") * env
        x = highpass(x, 400)
    elif name.startswith("Hat"):
        dur, tau, hp = {"Hat_Closed_Tight": (0.12, 0.018, 8000), "Hat_Closed_Crisp": (0.16, 0.03, 6500),
                        "Hat_Open": (0.6, 0.16, 6500), "Hat_Open_Long": (1.0, 0.32, 6000)}[name]
        t = tvec(dur); x = 0
        for fq in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0):  # TR-808 cymbal oscillator set
            x = x + osc(np.full(len(t), fq * 1.6), "square", phase0=rng.random())
        x = svf(x / 6, 10000, 1.2, "bp") + 0.4 * rng.standard_normal(len(t))
        x = highpass(highpass(x, hp), hp) * decay(t, tau, 0.002)
    elif name == "Shaker":
        t = tvec(0.18); env = np.interp(t, [0, 0.025, 0.18], [0, 1, 0]) ** 2
        x = highpass(highpass(rng.standard_normal(len(t)), 5000), 5000) * env
    elif name == "Rim_Shot":
        t = tvec(0.12)
        x = (np.sin(2 * np.pi * 1700 * t) + 0.6 * np.sin(2 * np.pi * 520 * t)) * decay(t, 0.012)
        x += 0.6 * svf(rng.standard_normal(len(t)), 3000, 2.0, "bp") * decay(t, 0.006)
    elif name == "Snare_Tech":
        t = tvec(0.35); f = 185 * (1 + 0.3 * np.exp(-t / 0.01))
        x = (osc(f) + 0.5 * osc(f * 1.78)) * decay(t, 0.06) * 0.8
        x += highpass(rng.standard_normal(len(t)), 1800) * decay(t, 0.11) * 0.7
        x = sat(x, 1.5)
    elif name == "Conga_Hi":
        t = tvec(0.35); f = 330 * (1 + 0.2 * np.exp(-t / 0.008))
        x = osc(f) * decay(t, 0.09) + 0.2 * svf(rng.standard_normal(len(t)), 2000, 2, "bp") * decay(t, 0.004)
    elif name == "Tom_Low":
        t = tvec(0.6); f = 120 * (1 + 0.6 * np.exp(-t / 0.03))
        x = sat(osc(f) * decay(t, 0.18, 0.01), 1.6)
    return finish(x, hp=40)


PERC = ["Clap_Classic", "Clap_Tight", "Clap_Wide", "Hat_Closed_Tight", "Hat_Closed_Crisp", "Hat_Open",
        "Hat_Open_Long", "Shaker", "Rim_Shot", "Snare_Tech", "Conga_Hi", "Tom_Low"]


BASSES = ["Sub_Pluck", "Rolling_Saw_Pluck", "Rubber_Bend", "Acid_303", "Acid_Square", "Organ_M1",
          "FM_Growl", "FM_Pluck", "Reese_Detuned", "Sub_Sustain", "Donk", "Square_Stab", "Wobble_Filter",
          "Fold_Grit", "Hollow_Pulse", "Plucky_Chicago", "Talky_Formant", "Gritty_Driven",
          "Sub_Octave_Layer", "Filter_Swell"]
BASSES_2 = ["Sub_Glide_Up", "Detroit_Pulse_Pluck", "FM_Tick", "Tok", "Fat_Ladder", "Octave_Drop_Zap",
            "Flanged_Saw", "Ring_Mod_Bell", "Distorted_808", "Fifth_Stab"]


def write_kicks(items, start, meta):
    for i, (name, note, p) in enumerate(items, start):
        fn = f"Kicks/THK_Kick_{i:02d}_{name}_{note[:-1].replace('#', 's')}.wav"
        x = kick(note, **p)
        sf.write(f"{OUT}/{fn}", x, SR, subtype="PCM_24")
        meta.append(dict(file=fn, kind="kick", name=name.replace("_", " "), note=note[:-1], hz=round(hz(note), 2), dur=round(len(x) / SR, 2)))


def write_basses(items, start, meta):
    for i, name in enumerate(items, start):
        fn = f"Bass/THK_Bass_{i:02d}_{name}_C.wav"
        x = bass(name)
        sf.write(f"{OUT}/{fn}", x, SR, subtype="PCM_24")
        meta.append(dict(file=fn, kind="bass", name=name.replace("_", " "), note="C", hz=round(hz(ROOT), 2), dur=round(len(x) / SR, 2)))
