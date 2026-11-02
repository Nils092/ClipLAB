#!/usr/bin/env python3
"""Schreibt mit, was in einer Audiodatei gesagt wird – mit Zeitstempel für jedes Wort.

Aufruf:  python transcribe.py audio.wav
Ausgabe: JSON auf stdout  {"language": "de", "duration": 123.4, "segments": [{"s","e","text","words":[{"w","s","e"}]}]}
Fortschritt: Zeilen {"progress": 0.42} auf stderr.

Einstellungen über Umgebungsvariablen:
  WHISPER_MODEL      tiny | base | small | medium | large-v3   (Standard: small)
  WHISPER_LANGUAGE   z. B. de, en; leer oder "auto" = automatisch erkennen
  WHISPER_THREADS    Anzahl CPU-Kerne (Standard: alle)
  WHISPER_MODELS_DIR Ordner für heruntergeladene Modelle
"""
import json
import os
import sys
import wave

import numpy as np
from faster_whisper import WhisperModel


def load_wav(path):
    """Liest die 16-kHz-Mono-WAV von ClipLab direkt ein (ohne PyAV – vermeidet Versionskonflikte)."""
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            raise SystemExit("WAV muss 16 Bit haben")
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        if w.getnchannels() > 1:
            data = data.reshape(-1, w.getnchannels()).mean(axis=1)
    return data.astype(np.float32) / 32768.0


def main():
    src = sys.argv[1]
    model_name = os.environ.get("WHISPER_MODEL") or "small"
    lang = (os.environ.get("WHISPER_LANGUAGE") or "").strip().lower() or None
    if lang == "auto":
        lang = None
    threads = int(os.environ.get("WHISPER_THREADS") or 0) or (os.cpu_count() or 2)

    model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=threads,
                         download_root=os.environ.get("WHISPER_MODELS_DIR") or None)
    audio = load_wav(src) if src.lower().endswith(".wav") else src
    segments, info = model.transcribe(
        audio, language=lang, word_timestamps=True, vad_filter=True,
        beam_size=1, condition_on_previous_text=False,
    )
    duration = float(info.duration or 0) or 1.0
    out = {"language": info.language, "duration": round(duration, 2), "segments": []}
    last = -1.0
    for s in segments:
        words = []
        for w in (s.words or []):
            t = (w.word or "").strip()
            if t:
                words.append({"w": t, "s": round(float(w.start), 2), "e": round(float(w.end), 2)})
        out["segments"].append({"s": round(float(s.start), 2), "e": round(float(s.end), 2),
                                "text": (s.text or "").strip(), "words": words})
        p = min(1.0, float(s.end) / duration)
        if p - last >= 0.01:
            last = p
            print(json.dumps({"progress": round(p, 3)}), file=sys.stderr, flush=True)
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
