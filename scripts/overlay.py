#!/usr/bin/env python3
"""Zeichnet den Titel eines Clips im TikTok-Stil als transparentes PNG (1080×1920):
weiße, abgerundete Box je Zeile, schwarze Schrift, farbige Emojis.

Aufruf: python overlay.py ausgabe.png "Titel mit Emojis 😭🏠" [mitte_y_in_pixeln]
"""
import os
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "..", "assets", "fonts", "Poppins-Bold.ttf")
EMOJI_FONTS = ["/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", "/usr/share/fonts/noto/NotoColorEmoji.ttf"]
SIZE = 66            # Schriftgröße
PAD_X, PAD_Y = 26, 12
MAX_W = W - 2 * 24   # maximale Boxbreite
RADIUS = 20


def is_emoji_start(ch):
    o = ord(ch)
    return o >= 0x1F000 or 0x2600 <= o <= 0x27BF or 0x2B00 <= o <= 0x2BFF or o in (0x00A9, 0x00AE, 0x203C, 0x2049, 0x2122, 0x2139, 0x3030, 0x303D)


def tokens(text):
    """Teilt in Wörter; Emoji-Folgen (inkl. ZWJ, Hautton, Varianten) werden eigene Tokens."""
    out, i = [], 0
    for word in text.split():
        parts, buf, j = [], "", 0
        while j < len(word):
            ch = word[j]
            if is_emoji_start(ch):
                if buf:
                    parts.append(("t", buf)); buf = ""
                e = ch; j += 1
                while j < len(word) and (word[j] in "️‍" or 0x1F3FB <= ord(word[j]) <= 0x1F3FF or (word[j - 1] == "‍")):
                    e += word[j]; j += 1
                parts.append(("e", e))
            else:
                buf += ch; j += 1
        if buf:
            parts.append(("t", buf))
        # Wörter nur aus Emojis bleiben am vorherigen Wort kleben (kein Umbruch davor)
        if out and parts and all(k == "e" for k, _ in parts):
            out[-1] = out[-1] + [("s", " ")] + parts
        else:
            out.append(parts)
    return out


class Renderer:
    def __init__(self):
        self.font = ImageFont.truetype(FONT, SIZE)
        self.emoji_font = None
        for f in EMOJI_FONTS:
            if os.path.exists(f):
                try:
                    self.emoji_font = ImageFont.truetype(f, 109)  # Noto Color Emoji gibt es nur in Größe 109
                    break
                except OSError:
                    pass
        self.cache = {}

    def emoji(self, e):
        if e in self.cache:
            return self.cache[e]
        img = None
        if self.emoji_font:
            tmp = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
            ImageDraw.Draw(tmp).text((10, 10), e, font=self.emoji_font, embedded_color=True)
            box = tmp.getbbox()
            if box:
                tmp = tmp.crop(box)
                s = int(SIZE * 1.12)
                img = tmp.resize((max(1, round(tmp.width * s / tmp.height)), s), Image.LANCZOS)
        self.cache[e] = img
        return img

    def width(self, parts):
        w = 0
        for kind, val in parts:
            if kind in ("t", "s"):
                w += self.font.getlength(val)
            else:
                im = self.emoji(val)
                w += (im.width + 4) if im else 0
        return w


def layout(r, text):
    words = tokens(text)
    space = r.font.getlength(" ")
    lines, cur, cur_w = [], [], 0
    for parts in words:
        ww = r.width(parts)
        if cur and cur_w + space + ww > MAX_W - 2 * PAD_X:
            lines.append((cur, cur_w)); cur, cur_w = [], 0
        cur_w += (space if cur else 0) + ww
        cur.append(parts)
    if cur:
        lines.append((cur, cur_w))
    return lines[:3], space


def main():
    out, text = sys.argv[1], " ".join(sys.argv[2].split())
    center_y = float(sys.argv[3]) if len(sys.argv) > 3 else H * 0.22
    r = Renderer()
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lines, space = layout(r, text)
    asc, desc = r.font.getmetrics()
    line_h = asc + desc + 2 * PAD_Y - 10
    total = len(lines) * (line_h - 2) + 2
    y = int(max(40, min(H - total - 40, center_y - total / 2)))
    # erst alle Boxen, dann Text – so verschmelzen die Zeilen wie bei TikTok
    boxes = []
    for words, w in lines:
        bw = int(w + 2 * PAD_X)
        x = (W - bw) // 2
        boxes.append((x, y, words))
        d.rounded_rectangle([x, y, x + bw, y + line_h], radius=RADIUS, fill=(255, 255, 255, 255))
        y += line_h - 2
    for x, y, words in boxes:
        cx = x + PAD_X
        ty = y + PAD_Y - 4
        for k, parts in enumerate(words):
            if k:
                cx += space
            for kind, val in parts:
                if kind in ("t", "s"):
                    d.text((cx, ty), val, font=r.font, fill=(0, 0, 0, 255))
                    cx += r.font.getlength(val)
                else:
                    im = r.emoji(val)
                    if im:
                        img.alpha_composite(im, (int(cx + 2), int(y + (line_h - im.height) / 2)))
                        cx += im.width + 4
    img.save(out)


if __name__ == "__main__":
    main()
