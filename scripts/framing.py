#!/usr/bin/env python3
"""Findet für jeden Moment eines Clips den Bildausschnitt, in dem die Personen zu sehen sind.

Aufruf:  python framing.py video.mp4 start ende
Ausgabe: JSON {"found": true, "crop": 0.316, "points": [[t, mitte_x, schnitt], ...]}
  t        Sekunden ab Clip-Start
  mitte_x  horizontale Bildmitte des Ausschnitts (0..1 der Originalbreite)
  schnitt  1 = Kameraschnitt an dieser Stelle (Ausschnitt springt statt zu schwenken)

Erkennung: Gesichter mit YuNet (Modell in WHISPER_MODELS_DIR/face_detection_yunet.onnx),
sonst Haar-Kaskade, sonst Personen-Erkennung (HOG). Ohne Treffer bleibt der Ausschnitt in der Mitte.
"""
import json
import os
import sys

import cv2
import numpy as np

STEP = 0.4          # Sekunden zwischen zwei Messungen
WORK_W = 640        # Analysebreite in Pixeln
CUT_CORR = 0.55     # Histogramm-Ähnlichkeit, unter der ein Kameraschnitt angenommen wird


class Detector:
    def __init__(self):
        self.yunet = None
        self.haar = None
        self.hog = None
        model = os.path.join(os.environ.get("WHISPER_MODELS_DIR", ""), "face_detection_yunet.onnx")
        if os.path.exists(model) and hasattr(cv2, "FaceDetectorYN"):
            try:
                self.yunet = cv2.FaceDetectorYN.create(model, "", (320, 320), 0.6, 0.3, 50)
            except cv2.error:
                self.yunet = None
        if not self.yunet:
            data = getattr(getattr(cv2, "data", None), "haarcascades", "")
            for name in ("haarcascade_frontalface_default.xml",):
                f = os.path.join(data, name)
                if data and os.path.exists(f):
                    self.haar = cv2.CascadeClassifier(f)
        # Personen-Erkennung (HOG) fehlt in manchen OpenCV-Builds – dann nur Gesichter nutzen
        self.hog = None
        try:
            self.hog = cv2.HOGDescriptor()
            self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        except Exception:
            self.hog = None

    def faces(self, img):
        h, w = img.shape[:2]
        if self.yunet:
            self.yunet.setInputSize((w, h))
            _, res = self.yunet.detect(img)
            if res is None:
                return []
            return [(float(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[14])) for r in res]
        if self.haar is not None:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            res = self.haar.detectMultiScale(gray, 1.1, 5, minSize=(24, 24))
            return [(float(x), float(y), float(bw), float(bh), 0.8) for (x, y, bw, bh) in res]
        return []

    def people(self, img):
        if self.hog is None:
            return []
        try:
            res, weights = self.hog.detectMultiScale(img, winStride=(8, 8), padding=(8, 8), scale=1.05)
        except Exception:
            return []
        out = []
        for (x, y, bw, bh), wt in zip(res, np.ravel(weights) if len(res) else []):
            if float(wt) > 0.5:
                # Oberkörper/Kopf zählt: oberes Drittel der Person
                out.append((float(x), float(y), float(bw), float(bh) / 3, float(wt)))
        return out


def target(boxes, w, crop):
    """Mitte des Ausschnitts für eine Messung (0..1) oder None, wenn niemand zu sehen ist."""
    if not boxes:
        return None
    boxes = sorted(boxes, key=lambda b: b[2] * b[3], reverse=True)
    big = boxes[0][2] * boxes[0][3]
    boxes = [b for b in boxes if b[2] * b[3] >= big * 0.25]   # kleine Gesichter im Hintergrund ignorieren
    left = min(b[0] for b in boxes) / w
    right = max(b[0] + b[2] for b in boxes) / w
    if right - left <= crop * 0.9:                              # alle passen in den Ausschnitt
        return (left + right) / 2
    b = boxes[0]                                                # sonst: die größte (nächste) Person
    return (b[0] + b[2] / 2) / w


def smooth(samples, crop):
    """samples: [(t, ziel oder None, schnitt)] → ruhige Kamerafahrt, Sprünge nur bei Schnitten."""
    half = crop / 2
    clamp = lambda x: min(1 - half, max(half, x))
    # in Einstellungen (zwischen Schnitten) aufteilen
    shots, cur = [], []
    for s in samples:
        if s[2] and cur:
            shots.append(cur); cur = []
        cur.append(s)
    if cur:
        shots.append(cur)
    out = []
    for shot in shots:
        vals = [v for _, v, _ in shot if v is not None]
        fallback = float(np.median(vals)) if vals else 0.5
        # Lücken füllen, dann Median über 5 Messungen gegen Ausreißer
        filled, last = [], None
        for _, v, _ in shot:
            last = v if v is not None else (last if last is not None else fallback)
            filled.append(last)
        med = [float(np.median(filled[max(0, i - 2):i + 3])) for i in range(len(filled))]
        pos = clamp(med[0])
        for i, (t, _, cut) in enumerate(shot):
            goal = clamp(med[i])
            if abs(goal - pos) > crop * 0.15:                   # Totzone: kleine Bewegungen ignorieren
                pos += (goal - pos) * 0.35                      # weich hinterherschwenken
            out.append([round(t, 2), round(clamp(pos), 4), 1 if (cut and i == 0) else 0])
    return out


def main():
    src, start, end = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise SystemExit("Video lässt sich nicht öffnen")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    W = cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920
    H = cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080
    crop = min(1.0, (H * 9 / 16) / W)
    det = Detector()
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    skip = max(1, int(round(fps * STEP)))
    samples, prev_hist, t, found = [], None, 0.0, False
    while t <= end - start:
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]
        small = cv2.resize(frame, (WORK_W, max(1, int(h * WORK_W / w))))
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist)
        cut = prev_hist is not None and cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL) < CUT_CORR
        prev_hist = hist
        boxes = det.faces(small) or det.people(small)
        v = target(boxes, small.shape[1], crop)
        found = found or v is not None
        samples.append((t, v, cut))
        for _ in range(skip - 1):
            if not cap.grab():
                break
        t += skip / fps
    json.dump({"found": found, "crop": round(crop, 4), "points": smooth(samples, crop) if samples else []}, sys.stdout)


if __name__ == "__main__":
    main()
