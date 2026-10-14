"""Categorized drum library (v3). Uses synth_kit's DSP helpers and random stream."""
import numpy as np
import synth_kit as K
from synth_kit import tvec, osc, svf, sat, decay, highpass, lowpass, finish, SR

# category -> (folder, file prefix)
CATS = {
    "clap": ("Claps", "Clap"), "snare": ("Snares", "Snare"), "hat_closed": ("Hats_Closed", "HatC"),
    "hat_open": ("Hats_Open", "HatO"), "ride": ("Rides", "Ride"), "shaker": ("Shakers", "Shaker"),
    "rim": ("Rims", "Rim"), "perc": ("Perc", "Perc"), "tom": ("Toms", "Tom"),
}
# the 12 v2 perc sounds, in their original render order -> new category + name
OLD_PERC = [("Clap_Classic", "clap", "Classic"), ("Clap_Tight", "clap", "Tight"), ("Clap_Wide", "clap", "Wide"),
            ("Hat_Closed_Tight", "hat_closed", "Tight"), ("Hat_Closed_Crisp", "hat_closed", "Crisp"),
            ("Hat_Open", "hat_open", "Medium"), ("Hat_Open_Long", "hat_open", "Long"), ("Shaker", "shaker", "Classic"),
            ("Rim_Shot", "rim", "Shot"), ("Snare_Tech", "snare", "Tech"), ("Conga_Hi", "perc", "Conga_Hi"), ("Tom_Low", "tom", "Low")]


def rnd():
    return K.rng


def crush(x, bits=6, hold=4):
    q = 2 ** (bits - 1)
    y = np.round(x * q) / q
    return np.repeat(y[::hold], hold)[: len(x)]


def clap_gen(tail, bp, spread, bursts=3, q=1.4, drive=0.0, bits=0, body=0.0, hp=400):
    t = tvec(tail * 4 + 0.05); n = rnd().standard_normal(len(t)); env = np.zeros(len(t))
    for k in range(bursts):
        env = np.maximum(env, np.where(t >= k * spread, np.exp(-(t - k * spread) / 0.006), 0))
    env = np.maximum(env, np.where(t >= bursts * spread, np.exp(-(t - bursts * spread) / tail) * 0.8, 0))
    x = svf(n, bp, q, "bp") * env
    if body:
        x += body * np.sin(2 * np.pi * 210 * t) * decay(t, 0.03)
    x = highpass(x, hp)
    if drive:
        x = sat(x * 2, drive)
    if bits:
        x = crush(x / np.max(np.abs(x)), bits, 3)
    return x


def snare_gen(f=185, tone_tau=0.06, noise_tau=0.11, noise_hp=1800, tone=0.8, noise=0.7, drive=1.5, dur=0.35, bp=None, bits=0, ratio=1.78):
    t = tvec(dur); ff = f * (1 + 0.3 * np.exp(-t / 0.01))
    x = (osc(ff) + 0.5 * osc(ff * ratio)) * decay(t, tone_tau) * tone
    nz = highpass(rnd().standard_normal(len(t)), noise_hp)
    if bp:
        nz = svf(nz, bp, 1.0, "bp") * 2
    x += nz * decay(t, noise_tau) * noise
    x = sat(x, drive)
    if bits:
        x = crush(x / np.max(np.abs(x)), bits, 3)
    return x


def hat_gen(dur, tau, hp, metal=1.0, noise=0.4, bp=10000, q=1.2, mult=1.6, lp=None):
    t = tvec(dur); x = 0
    for fq in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0):
        x = x + osc(np.full(len(t), fq * mult), "square", phase0=rnd().random())
    x = metal * svf(x / 6, bp, q, "bp") + noise * rnd().standard_normal(len(t))
    x = highpass(highpass(x, hp), hp) * decay(t, tau, 0.002)
    if lp:
        x = lowpass(x, lp)
    return x


def ride_gen(dur, tau, base=520, bell=0.5, wash=0.6, hp=2500):
    t = tvec(dur); x = 0
    for i, r in enumerate((1, 1.49, 2.13, 2.71, 3.33, 4.02, 5.17)):
        x = x + np.sin(2 * np.pi * base * r * t + rnd().random() * 6.28) * decay(t, tau * (0.5 if i < 3 else 1.0)) / (1 + 0.3 * i)
    x = bell * x
    m = 0
    for fq in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0):
        m = m + osc(np.full(len(t), fq * 2.4), "square", phase0=rnd().random())
    x += wash * svf(m / 6, 7500, 1.0, "bp") * decay(t, tau)
    x += 0.15 * highpass(rnd().standard_normal(len(t)), 6000) * decay(t, tau * 0.6)
    return highpass(x, hp) * np.interp(t, [0, 0.001, dur], [0, 1, 1])


def shaker_gen(dur, attack, hp, shape=2.0, jingle=0.0):
    t = tvec(dur); env = np.interp(t, [0, attack, dur], [0, 1, 0]) ** shape
    x = highpass(highpass(rnd().standard_normal(len(t)), hp), hp) * env
    if jingle:
        m = 0
        for fq in (2400, 3150, 4020, 5310):
            m = m + osc(np.full(len(t), fq), "square", phase0=rnd().random())
        x += jingle * svf(m / 4, 8000, 2.0, "bp") * env * (1 + 0.5 * np.sin(2 * np.pi * 38 * t))
    return x


def rim_gen(f1, f2, tau, noise=0.6, bp=3000, dur=0.12):
    t = tvec(dur)
    x = (np.sin(2 * np.pi * f1 * t) + 0.6 * np.sin(2 * np.pi * f2 * t)) * decay(t, tau)
    x += noise * svf(rnd().standard_normal(len(t)), bp, 2.0, "bp") * decay(t, 0.006)
    return x


def drum_gen(f, tau, sweep, dur, click=0.2, drive=1.0):
    t = tvec(dur); ff = f * (1 + sweep * np.exp(-t / 0.01))
    x = osc(ff) * decay(t, tau) + click * svf(rnd().standard_normal(len(t)), 2000, 2, "bp") * decay(t, 0.004)
    return sat(x, drive) if drive > 1 else x


def cowbell(dur=0.35):
    t = tvec(dur)
    x = osc(np.full(len(t), 540.0), "square") + osc(np.full(len(t), 800.0), "square")
    x = svf(x, 1100, 1.6, "bp") * (0.7 * decay(t, 0.012) + 0.3 * decay(t, 0.11))
    return x


def woodblock(dur=0.15):
    t = tvec(dur)
    return (np.sin(2 * np.pi * 980 * t) + 0.5 * np.sin(2 * np.pi * 1630 * t)) * decay(t, 0.022)


def blip(dur=0.2):
    t = tvec(dur); idx = 4 * np.exp(-t / 0.02)
    return np.sin(2 * np.pi * 1200 * t + idx * np.sin(2 * np.pi * 1200 * 1.41 * t)) * decay(t, 0.045)


def metal(dur=0.4):
    t = tvec(dur)
    return np.sin(2 * np.pi * 900 * t) * np.sin(2 * np.pi * 1310 * t) * decay(t, 0.09)


NEW = [
    # claps
    ("clap", "Snappy", lambda: clap_gen(0.05, 1800, 0.006, q=1.6)),
    ("clap", "Room", lambda: clap_gen(0.3, 1100, 0.012, q=1.2)),
    ("clap", "Layered", lambda: clap_gen(0.12, 1300, 0.01, body=0.6, drive=1.6)),
    ("clap", "Lofi", lambda: clap_gen(0.1, 1200, 0.011, bits=5)),
    ("clap", "Big_909", lambda: clap_gen(0.18, 1000, 0.013, bursts=4, q=1.2, drive=1.8)),
    # snares
    ("snare", "909", lambda: snare_gen(f=190, tone_tau=0.05, noise_tau=0.14, noise_hp=1200, tone=0.9, noise=0.8, drive=1.8)),
    ("snare", "Tight", lambda: snare_gen(f=220, tone_tau=0.035, noise_tau=0.06, noise_hp=2500, dur=0.22)),
    ("snare", "Rimmy", lambda: snare_gen(f=330, tone_tau=0.03, noise_tau=0.08, noise_hp=2000, tone=1.0, noise=0.5, dur=0.25)),
    ("snare", "Noise_Burst", lambda: snare_gen(f=200, tone_tau=0.02, noise_tau=0.18, noise_hp=900, tone=0.3, noise=1.0, dur=0.5, bp=3500)),
    ("snare", "Lofi", lambda: snare_gen(f=180, tone_tau=0.06, noise_tau=0.12, noise_hp=1500, bits=5)),
    # closed hats
    ("hat_closed", "Dark", lambda: hat_gen(0.14, 0.025, 5000, bp=7000, lp=11000)),
    ("hat_closed", "Noise", lambda: hat_gen(0.12, 0.02, 7000, metal=0.0, noise=1.0)),
    ("hat_closed", "Tick", lambda: hat_gen(0.06, 0.008, 9000)),
    ("hat_closed", "Metal", lambda: hat_gen(0.12, 0.022, 6000, metal=1.4, noise=0.05)),
    ("hat_closed", "Soft", lambda: hat_gen(0.15, 0.03, 6000, noise=0.25, lp=9000)),
    ("hat_closed", "Shuffle", lambda: hat_gen(0.2, 0.05, 6500)),
    # open hats
    ("hat_open", "Short", lambda: hat_gen(0.35, 0.09, 6500)),
    ("hat_open", "Dark", lambda: hat_gen(0.6, 0.16, 5000, bp=7000, lp=10000)),
    ("hat_open", "Noise", lambda: hat_gen(0.55, 0.15, 6500, metal=0.0, noise=1.0)),
    ("hat_open", "Sizzle", lambda: hat_gen(0.8, 0.22, 8000, metal=1.2, noise=0.6, bp=12000)),
    # rides
    ("ride", "Ping", lambda: ride_gen(1.6, 0.45, base=560, bell=0.8, wash=0.4)),
    ("ride", "Wash", lambda: ride_gen(2.2, 0.8, base=480, bell=0.3, wash=1.0)),
    ("ride", "Bell", lambda: ride_gen(1.4, 0.35, base=760, bell=1.2, wash=0.3, hp=1500)),
    ("ride", "Dark", lambda: lowpass(ride_gen(1.8, 0.6, base=430, bell=0.6, wash=0.7, hp=1800), 8000)),
    # shakers
    ("shaker", "Tight", lambda: shaker_gen(0.1, 0.012, 6000)),
    ("shaker", "Long", lambda: shaker_gen(0.3, 0.06, 5000, shape=1.5)),
    ("shaker", "Bright", lambda: shaker_gen(0.16, 0.02, 8000)),
    ("shaker", "Soft", lambda: lowpass(shaker_gen(0.2, 0.04, 4000), 9000)),
    ("shaker", "Tambourine", lambda: shaker_gen(0.25, 0.008, 5000, shape=1.2, jingle=0.9)),
    # rims
    ("rim", "Click", lambda: rim_gen(2200, 900, 0.006, noise=0.4, bp=4000, dur=0.08)),
    ("rim", "Woody", lambda: rim_gen(1200, 450, 0.018, noise=0.3, bp=2000)),
    ("rim", "High", lambda: rim_gen(2600, 1700, 0.01, noise=0.5, bp=5000)),
    ("rim", "Clave", lambda: rim_gen(2500, 0, 0.03, noise=0.0, dur=0.2)),
    # perc
    ("perc", "Conga_Low", lambda: drum_gen(220, 0.12, 0.2, 0.4)),
    ("perc", "Bongo_Hi", lambda: drum_gen(420, 0.06, 0.25, 0.25, click=0.3)),
    ("perc", "Bongo_Low", lambda: drum_gen(300, 0.08, 0.25, 0.3, click=0.3)),
    ("perc", "Cowbell", cowbell),
    ("perc", "Woodblock", woodblock),
    ("perc", "Blip", blip),
    ("perc", "Metal", metal),
    # toms
    ("tom", "Mid", lambda: drum_gen(160, 0.16, 0.5, 0.5, click=0.15, drive=1.5)),
    ("tom", "High", lambda: drum_gen(220, 0.13, 0.5, 0.45, click=0.15, drive=1.5)),
    ("tom", "Floor", lambda: drum_gen(90, 0.25, 0.6, 0.8, click=0.1, drive=1.6)),
]
