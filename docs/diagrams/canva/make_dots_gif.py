"""Transparent animated GIF with ONLY the moving 'data' dots for slide 10 (architecture).
Placed on top of slide-architecture.png (same position + size) in Canva.
Dot paths are taken from the same link geometry the diagram uses, so they always follow the arrows.

    python3 -I make_dots_gif.py     -> slide-architecture-dots.gif
"""
import math, os, sys
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_canva_diagrams as m

OUT = os.path.dirname(os.path.abspath(__file__))
S = 2                      # same 2x scale as slide-architecture.png
W, H = 1848 * S, 690 * S
FPS, T = 20, 7.2           # seconds per loop; the last ~0.8 s is rest (no dots)
R = 10 * S                 # dot radius

PALETTE = {0: (0, 0, 0), 1: (255, 255, 255), 2: (94, 118, 146), 3: (95, 127, 87), 4: (32, 33, 36)}  # 0 = transparent
BLUE, SAGE, DARK = 2, 3, 4


def along(points, u):
    """Point at fraction u (0..1) of the polyline length."""
    seg = [math.dist(points[i], points[i + 1]) for i in range(len(points) - 1)]
    d = u * sum(seg)
    for i, L in enumerate(seg):
        if d <= L or i == len(seg) - 1:
            f = 0 if L == 0 else min(d / L, 1)
            (x1, y1), (x2, y2) = points[i], points[i + 1]
            return x1 + (x2 - x1) * f, y1 + (y2 - y1) * f
        d -= L


def ease(u):
    return u * u * (3 - 2 * u)          # smoothstep


# (start, duration, points (tip to tip), colour index)
rev = lambda p: list(reversed(p))
EVENTS = [
    (0.0, 0.8, m.LINK_SCRIPT, BLUE),             # map files go to Netlify
    (0.6, 1.5, m.LINK_NETLIFY, BLUE),            # Netlify -> app   ("opens the app and the map")
    (2.0, 1.4, m.LINK_SUPABASE, SAGE),           # app -> Supabase  (a report)
    (3.4, 1.4, rev(m.LINK_SUPABASE), SAGE),      # Supabase -> app  (results)
    (3.2, 1.7, m.LINK_AGENT, DARK),              # app -> AI assistant (a question)
    (4.9, 1.5, rev(m.LINK_AGENT), DARK),         # assistant -> app (the answer)
]


def frame(t):
    im = Image.new('P', (W, H), 0)
    im.putpalette([c for i in range(256) for c in PALETTE.get(i, (0, 0, 0))])
    d = ImageDraw.Draw(im)
    for start, dur, pts, col in EVENTS:
        if not (start <= t <= start + dur):
            continue
        u = (t - start) / dur
        x, y = along(pts, ease(u))
        # shrink in/out at the ends so dots appear and vanish softly
        k = min(1, u / 0.12, (1 - u) / 0.12)
        r = max(2, R * (0.35 + 0.65 * k))
        x, y = x * S, y * S
        d.ellipse((x - r - 4, y - r - 4, x + r + 4, y + r + 4), fill=1)     # white ring
        d.ellipse((x - r, y - r, x + r, y + r), fill=col)
    return im


def main():
    n = int(FPS * T)
    frames = [frame(i / FPS) for i in range(n)]
    out = os.path.join(OUT, 'slide-architecture-dots.gif')
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / FPS), loop=0,
                   transparency=0, disposal=2, optimize=False)
    print(out, n, 'frames', os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    main()
