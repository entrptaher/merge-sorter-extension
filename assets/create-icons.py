"""Render the original Tab tidy tab motif with only the Python standard library."""

import json
import math
from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[1]
SIZES = (16, 32, 48, 128)
GREEN = (33, 83, 62)
WHITE = (245, 252, 247)
SUPERSAMPLE = 4
STROKE = 1.75
PROVENANCE = {
    "origin": "Original artwork authored for Tab tidy, not copied from the supplied extensions.",
    "description": "Two outlined browser tabs with a check, on a forest-green rounded square.",
    "source": "assets/create-icons.py",
    "method": "Analytic stroke rasterization with 4x supersampling; PNG encoded with Python stdlib struct and zlib.",
    "palette": {"background": "#21533e", "foreground": "#f5fcf7"},
    "viewBox": [0, 0, 24, 24],
    "strokeWidth": STROKE,
    "externalAssets": [],
}


def arc(cx, cy, radius, start, end):
    return [
        (cx + radius * math.cos(math.radians(start + (end - start) * i / 16)),
         cy + radius * math.sin(math.radians(start + (end - start) * i / 16)))
        for i in range(17)
    ]


BACK = [(6, 5), (6, 4)] + arc(7, 4, 1, 180, 270)[1:]
BACK += [(12, 3), (14, 6), (18, 6)] + arc(18, 8, 2, 270, 360)[1:] + [(20, 17)]
FRONT = [(3, 8)] + arc(5, 8, 2, 180, 270)[1:] + [(9, 6), (11, 9), (16, 9)]
FRONT += arc(16, 11, 2, 270, 360)[1:] + [(18, 19)]
FRONT += arc(16, 19, 2, 0, 90)[1:] + [(5, 21)]
FRONT += arc(5, 19, 2, 90, 180)[1:] + [(3, 8)]
CHECK = [(7, 14), (9, 16), (13, 12)]
SEGMENTS = [
    (a, b, min(a[0], b[0]) - STROKE / 2, max(a[0], b[0]) + STROKE / 2,
     min(a[1], b[1]) - STROKE / 2, max(a[1], b[1]) + STROKE / 2)
    for path in (BACK, FRONT, CHECK)
    for a, b in zip(path, path[1:])
]


def on_stroke(x, y):
    for a, b, xmin, xmax, ymin, ymax in SEGMENTS:
        if not (xmin <= x <= xmax and ymin <= y <= ymax):
            continue
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
        if (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2 <= (STROKE / 2) ** 2:
            return True
    return False


def on_background(x, y):
    if not (1 <= x <= 23 and 1 <= y <= 23):
        return False
    cx, cy = max(6, min(18, x)), max(6, min(18, y))
    return (x - cx) ** 2 + (y - cy) ** 2 <= 25


def chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)


def render(size):
    raw = bytearray()
    for py in range(size):
        raw.append(0)
        for px in range(size):
            colors = []
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = (px + (sx + .5) / SUPERSAMPLE) * 24 / size
                    y = (py + (sy + .5) / SUPERSAMPLE) * 24 / size
                    if on_background(x, y):
                        colors.append(WHITE if on_stroke(x, y) else GREEN)
            if not colors:
                raw.extend((0, 0, 0, 0))
            else:
                raw.extend(round(sum(color[channel] for color in colors) / len(colors)) for channel in range(3))
                raw.append(round(255 * len(colors) / SUPERSAMPLE ** 2))
    metadata = {**PROVENANCE, "size": size}
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 6, 0, 0, 0))
            + chunk(b'tEXt', b'Provenance\x00' + json.dumps(metadata, separators=(',', ':')).encode('ascii'))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


if __name__ == '__main__':
    public = ROOT / 'public'
    public.mkdir(exist_ok=True)
    for size in SIZES:
        (public / f'icon-{size}.png').write_bytes(render(size))
    (public / 'icon-provenance.json').write_text(
        json.dumps({**PROVENANCE, "files": [f'icon-{size}.png' for size in SIZES]}, indent=2) + '\n'
    )
