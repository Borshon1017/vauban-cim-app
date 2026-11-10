"""Looping MP4 for slide 10: the static architecture diagram + a few slow 'data' dots travelling along the arrows.
(Canva would not accept a transparent GIF overlay, so the diagram itself is inside the video.)

Frame 0 and the last frame contain NO dots, so a paused/exported slide looks exactly like the still diagram.
Background is flat #c9c9c9 (the slide colour) so the video blends in with the slide.

    python3 -I make_dots_video.py     -> slide-architecture.mp4   (needs ffmpeg + slide-architecture.png)
"""
import math, os, subprocess, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_canva_diagrams as m
import make_dots_gif as g          # reuse the event timeline + dot path helper

SCALE = 1.0                        # video px per slide px (diagram is 1848 x 690 slide px)
VW, VH = 1848, 690                # even dimensions (1.5 x 1848 = 2772; 1.5 x 690 = 1035 -> 1036)
FPS = 25
LOOPS = 2
LEAD = 0.4                         # still, dot-free lead-in
BG = (201, 201, 201)               # #c9c9c9
COL = {g.BLUE: (94, 118, 146), g.SAGE: (95, 127, 87), g.DARK: (32, 33, 36)}


def dot_patch(r, color):
    ss = 4
    size = int((r + 6) * 2 * ss)
    p = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(p)
    c = size / 2
    d.ellipse((c - (r + 3.5) * ss, c - (r + 3.5) * ss, c + (r + 3.5) * ss, c + (r + 3.5) * ss), fill=(255, 255, 255, 255))
    d.ellipse((c - r * ss, c - r * ss, c + r * ss, c + r * ss), fill=color + (255,))
    return p.resize((size // ss, size // ss), Image.LANCZOS)


def main():
    base = Image.open(os.path.join(HERE, 'slide-architecture.png')).convert('RGBA').resize((VW, VH), Image.LANCZOS)
    flat = Image.new('RGBA', (VW, VH), BG + (255,))
    flat.alpha_composite(base)
    flat = flat.convert('RGB')
    T = g.T + LEAD
    n_loop = int(round(T * FPS))
    out_dir = os.path.join(HERE, '_frames')
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        os.remove(os.path.join(out_dir, f))
    total = n_loop * LOOPS + FPS // 2          # half a second of rest at the very end
    for i in range(total):
        t = ((i % n_loop) / FPS) - LEAD if i < n_loop * LOOPS else -1
        im = flat.copy()
        for start, dur, pts, col in g.EVENTS:
            if not (start <= t <= start + dur):
                continue
            u = (t - start) / dur
            x, y = g.along(pts, g.ease(u))
            k = min(1, u / 0.12, (1 - u) / 0.12)
            r = max(2.0, 7.0 * SCALE * (0.35 + 0.65 * k))
            p = dot_patch(r, COL[col])
            im.paste(p, (int(x * SCALE - p.width / 2), int(y * SCALE - p.height / 2)), p)
        im.save(os.path.join(out_dir, f'f{i:04d}.png'))
    out = os.path.join(HERE, 'slide-architecture.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(out_dir, 'f%04d.png'),
                    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
                    '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.0', '-preset', 'slow', '-crf', '14', '-colorspace', 'bt709', '-color_primaries', 'bt709',
                    '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', '-an', out], check=True)
    for f in os.listdir(out_dir):
        os.remove(os.path.join(out_dir, f))
    os.rmdir(out_dir)
    print(out, total, 'frames', os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    main()
