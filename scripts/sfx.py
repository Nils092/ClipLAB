# Erzeugt die Übergangs-Sounds für ClipLab synthetisch (kein fremdes Material):
#   whoosh.wav – kurzer, weicher Luftzug für Schnitte
# Aufruf: python3 scripts/sfx.py assets/sfx
import sys, os, wave, struct, math, random

def write(path, samples, sr=44100):
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))

def whoosh(sr=44100, dur=0.42, seed=7):
    random.seed(seed)
    n = int(sr * dur); out = []
    # Rauschen durch einen wandernden Bandpass (Resonanz) – klingt wie ein weicher Luftzug
    lp = 0.0; bp = 0.0
    for i in range(n):
        t = i / n
        f = 300 + 2600 * (math.sin(math.pi * t) ** 1.3)     # Frequenz steigt und fällt
        q = 0.35
        x = random.uniform(-1, 1)
        fcoef = 2 * math.sin(math.pi * f / sr)
        lp += fcoef * bp
        hp = x - lp - q * bp
        bp += fcoef * hp
        env = (math.sin(math.pi * t) ** 2.2)                 # weiches Ein- und Ausblenden
        out.append(bp * env * 0.9)
    peak = max(abs(s) for s in out) or 1
    return [s / peak * 0.8 for s in out]

if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else "assets/sfx"
    os.makedirs(d, exist_ok=True)
    write(os.path.join(d, "whoosh.wav"), whoosh())
    print("ok", d)
