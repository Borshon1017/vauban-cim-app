"""Generates the two Canva slide diagrams (architecture + data flow) as transparent SVGs
that sit under the native header of slides 10/11 in the project deck.

Style = deck theme: grey #c9c9c9 slide background (transparent here), Bebas Neue headings,
Poppins body, blue-grey #5e7692 / sage #8ca984 / near-black #202124 accents, pale cards.
Same colour = same subsystem on both slides:
  blue = map data + Netlify, sage = pedestrian feedback + Supabase, dark = AI agent (Cloud Run + Mistral).

Render:  node render/r.mjs <in.svg> <out.png> 2     (resvg-js with the font files; see README.md)
"""
import html, sys, os

OUT = os.path.dirname(os.path.abspath(__file__))
PALE, STROKE, INK = '#eef0ee', '#b3b7b3', '#202124'
BLUE, SAGE, SAGE_D, DARK = '#5e7692', '#8ca984', '#5f7f57', '#202124'
MUTED = '#4b4f54'


def esc(s):
    return html.escape(s, quote=False)


def t(x, y, s, size=22, weight=400, fill=INK, fam='Poppins', anchor='start', ls=0):
    extra = f' letter-spacing="{ls}"' if ls else ''
    return (f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}"{extra}>{esc(s)}</text>')


def lines(x, y, ls_, size=22, weight=400, fill=INK, lh=1.38, anchor='start'):
    return ''.join(t(x, y + i * size * lh, l, size, weight, fill, anchor=anchor) for i, l in enumerate(ls_))



# ---- minimal line icons, drawn in a 48x48 box, white strokes (placed inside a coloured circle)
ICONS = {
    'phone': '<rect x="15" y="6" width="18" height="36" rx="4.5"/><circle cx="24" cy="35.5" r="1.8" fill="#fff" stroke="none"/><path d="M21 10.5 H27"/>',
    'cloud': '<path d="M14.5 35 C8 35 6 27.5 11.5 24.5 C11 17 20 13.5 24.5 19 C29 12 39.5 16.5 37 25 C43.5 25.5 43.5 35 36 35 Z"/>',
    'database': '<ellipse cx="24" cy="12" rx="13" ry="5"/><path d="M11 12 V35 A13 5 0 0 0 37 35 V12"/><path d="M11 23.5 A13 5 0 0 0 37 23.5"/>',
    'chat': '<path d="M8 11 H40 V33 H27 L19 41 V33 H8 Z"/><circle cx="17" cy="22" r="1.9" fill="#fff" stroke="none"/><circle cx="24" cy="22" r="1.9" fill="#fff" stroke="none"/><circle cx="31" cy="22" r="1.9" fill="#fff" stroke="none"/>',
    'spark': '<path d="M22 6 L26.5 19.5 L40 24 L26.5 28.5 L22 42 L17.5 28.5 L4 24 L17.5 19.5 Z"/><path d="M38 6 V14 M34 10 H42"/>',
    'layers': '<path d="M24 7 L42 17 L24 27 L6 17 Z"/><path d="M6 24 L24 34 L42 24"/><path d="M6 31 L24 41 L42 31"/>',
    'lock': '<rect x="11" y="21" width="26" height="19" rx="4.5"/><path d="M16.5 21 V15.5 A7.5 7.5 0 0 1 31.5 15.5 V21"/><circle cx="24" cy="30.5" r="2.4" fill="#fff" stroke="none"/>',
}


def icon_circle(cx, cy, name, col, r=38):
    k = (r * 1.15) / 48
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{col}"/>'
            f'<g transform="translate({cx - 24 * k:.1f},{cy - 24 * k:.1f}) scale({k:.3f})" fill="none" stroke="#fff" '
            f'stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</g>')


_cid = [0]


def card(x, y, w, h, accent, title, sub, body, subcolor=None, dashed=False, band_text=None,
         tsize=46, bsize=22, fill=PALE, pad=34, subsize=18, icon=None, icon_col=None):
    _cid[0] += 1
    cid = f'c{_cid[0]}'
    subcolor = subcolor or accent
    s = f'<clipPath id="{cid}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="20"/></clipPath>'
    if dashed:
        s += (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="20" fill="none" stroke="{MUTED}" '
              f'stroke-width="3.5" stroke-dasharray="12 9"/>')
    else:
        s += f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="20" fill="{fill}" stroke="{STROKE}" stroke-width="2"/>'
        s += f'<rect x="{x}" y="{y}" width="{w}" height="14" fill="{accent}" clip-path="url(#{cid})"/>'
    ty = y + 14 + tsize * 0.95 + 6
    s += t(x + pad, ty, title, tsize, 400, INK, fam='Bebas Neue', ls=0.6)
    yy = ty
    if sub:
        yy = ty + 10 + subsize * 1.1
        s += t(x + pad, yy, sub, subsize, 600, subcolor, ls=1.2)
    s += lines(x + pad, yy + 14 + bsize * 1.1, body, bsize, 400, INK)
    if icon:
        s += icon_circle(x + w - 62, y + h / 2 + 7, icon, icon_col or accent, 40)
    return s


def defs():
    return ''


def head(x, y, d, col, s=17):
    """Arrowhead with its tip at (x, y) pointing in direction d (l, r, u, dn)."""
    a, b = s * 1.15, s * 0.72
    pts = {'r': [(x, y), (x - a, y - b), (x - a, y + b)], 'l': [(x, y), (x + a, y - b), (x + a, y + b)],
           'u': [(x, y), (x - b, y + a), (x + b, y + a)], 'dn': [(x, y), (x - b, y - a), (x + b, y - a)]}[d]
    return f'<polygon points="{" ".join(f"{px:.1f},{py:.1f}" for px, py in pts)}" fill="{col}" stroke="{col}" stroke-width="2" stroke-linejoin="round"/>'


def conn(d, col, heads, w=5, dash=False):
    dd = ' stroke-dasharray="11 8"' if dash else ''
    return (f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="butt"{dd}/>'
            + ''.join(head(x, y, dr, col) for x, y, dr in heads))


def badge(cx, cy, n, col, txtcol='#ffffff', r=17):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{col}"/>'
            + t(cx, cy + 8, str(n), 22, 700, txtcol, anchor='middle'))


def pill(x, y, w, h, n, col, txtcol, ls_):
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#f6f6f4" stroke="{STROKE}" stroke-width="2"/>'
    s += badge(x + 28, y + h / 2, n, col, txtcol)
    s += lines(x + 56, y + h / 2 - 4 if len(ls_) > 1 else y + h / 2 + 7, ls_, 21, 600, INK, lh=1.25)
    return s


def wrap(body, w, h):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'{defs()}{body}</svg>')


# ----------------------------------------------------------------------------- 1) ARCHITECTURE
# Link geometry (slide-local px). Shared with the animation script so the moving dots follow the exact lines.
# Each list runs hub -> service (or source -> target for one-way links); the points are the arrow tips.
LINK_NETLIFY = [(698, 105), (322, 105), (322, 196), (281, 196)]    # Netlify -> app   (one way, toward the app)
LINK_SUPABASE = [(281, 300), (322, 300), (322, 345), (699, 345)]   # app <-> Supabase
LINK_AGENT = [(281, 404), (322, 404), (322, 585), (699, 585)]      # app <-> AI assistant
LINK_SCRIPT = [(1320, 105), (1261, 105)]                           # QGIS/GeoJSON -> Netlify (one way)
LINK_MISTRAL = [(1261, 585), (1319, 585)]                          # assistant <-> AI brain


def _dir(p, q):
    dx, dy = q[0] - p[0], q[1] - p[1]
    return ('r' if dx > 0 else 'l') if abs(dx) >= abs(dy) else ('dn' if dy > 0 else 'u')


def link(points, col, head_end=True, head_start=False, w=5, dash=False, trim=15):
    pts = [list(p) for p in points]
    heads = []
    if head_end:
        heads.append((*points[-1], _dir(points[-2], points[-1])))
        a, b = pts[-2], pts[-1]
        d = _dir(a, b)
        b[0] -= {'r': trim, 'l': -trim}.get(d, 0); b[1] -= {'dn': trim, 'u': -trim}.get(d, 0)
    if head_start:
        heads.append((*points[0], _dir(points[1], points[0])))
        a, b = pts[1], pts[0]
        d = _dir(a, b)
        b[0] -= {'r': trim, 'l': -trim}.get(d, 0); b[1] -= {'dn': trim, 'u': -trim}.get(d, 0)
    d = 'M' + ' L'.join(f'{x:.0f} {y:.0f}' for x, y in pts)
    return conn(d, col, heads, w=w, dash=dash)


def architecture():
    W, H = 1848, 690
    b = []
    # hub: the app on the user's phone / computer
    b.append(f'<rect x="2" y="150" width="278" height="300" rx="22" fill="#fafaf8" stroke="{INK}" stroke-width="5"/>')
    b.append(t(30, 222, 'VAUBAN GO', 56, 400, INK, fam='Bebas Neue', ls=0.8))
    b.append(t(30, 256, 'THE APP YOU USE', 19, 600, BLUE, ls=1.2))
    b.append(lines(30, 304, ['Phone or computer', 'Map · Reports · Chat'], 22, 400, INK, lh=1.5))
    b.append(icon_circle(141, 388, 'phone', INK, 40))
    b.append(lines(141, 500, ['Background map:', 'OpenFreeMap'], 20, 600, MUTED, lh=1.3, anchor='middle'))

    X2, W2 = 700, 560
    kw = dict(tsize=52, bsize=25, subsize=20)
    b.append(card(X2, 10, W2, 190, BLUE, 'WHERE THE APP LIVES', 'NETLIFY', ['Delivers the app and maps'], BLUE, icon='cloud', **kw))
    b.append(card(X2, 250, W2, 190, SAGE, 'THE DATABASE', 'SUPABASE', ['Stores reports privately'], SAGE_D, icon='database', **kw))
    b.append(card(X2, 490, W2, 190, DARK, 'THE AI ASSISTANT', 'GOOGLE CLOUD', ['Sends questions to the AI'], MUTED, icon='chat', icon_col=DARK, **kw))
    X3, W3 = 1320, 528
    b.append(card(X3, 10, W3, 190, BLUE, 'OUR MAP DATA', 'QGIS  >  GEOJSON', ['Map files, made offline'], BLUE, icon='layers', **kw))
    b.append(card(X3, 490, W3, 190, DARK, 'THE AI BRAIN', 'MISTRAL', ['Understands, then answers'], MUTED, icon='spark', icon_col=DARK, **kw))
    b.append(card(X3, 250, W3, 190, SAGE_D, 'PRIVACY BY DESIGN', None,
                  ['Exact points stay private.', 'Safety & crowd show as areas', 'once 3+ people report.'],
                  dashed=True, tsize=44, bsize=22, pad=30, icon='lock', icon_col=SAGE_D))
    # links
    b.append(link(LINK_NETLIFY, BLUE))
    b.append(link(LINK_SUPABASE, SAGE_D, head_end=True, head_start=True))
    b.append(link(LINK_AGENT, DARK, head_end=True, head_start=True))
    b.append(link(LINK_SCRIPT, BLUE))
    b.append(link(LINK_MISTRAL, DARK, head_end=True, head_start=True))
    # numbered labels sit ABOVE each link
    b.append(pill(344, 25, 336, 66, 1, BLUE, '#fff', ['Opens the app', 'and the map']))
    b.append(pill(344, 265, 336, 66, 2, SAGE_D, '#fff', ['Sends reports,', 'gets results']))
    b.append(pill(344, 505, 336, 66, 3, DARK, '#fff', ['Asks a question,', 'gets an answer']))
    return wrap(''.join(b), W, H)


# ----------------------------------------------------------------------------- 2) DATA FLOW
def dataflow():
    W, H = 1848, 700
    b = []
    X0, LW = 0, 250                    # lane label column
    CX, CW, GAP = 270, 346, 64.7       # stage cards
    heads = ['COLLECT', 'PROCESS', 'STORE & USE', 'DISPLAY']
    for i, hname in enumerate(heads):
        x = CX + i * (CW + GAP)
        b.append(t(x + CW / 2, 38, f'{i + 1}  {hname}', 30, 400, MUTED, fam='Bebas Neue', anchor='middle', ls=2))
    lanes = [
        (52, BLUE, 'b', '#ffffff', 'URBAN GIS DATA', 'prepared offline', BLUE, [
            ('QGIS SHAPEFILES', ['Buildings · trees ·', 'lamps · crossings']),
            ('CONVERSION SCRIPT', ['Reprojects, clips to', 'Vauban, simplifies']),
            ('8 GEOJSON FILES', ['Light map layers', 'served by Netlify']),
            ('THE MAP', ['Layers drawn in the', 'app (2D, 3D option)'])]),
        (248, SAGE, 's', '#202124', 'PEDESTRIAN FEEDBACK', 'anonymous reports', SAGE_D, [
            ('ANONYMOUS REPORT', ['Safety, Crowd or', 'Obstacle, from a phone']),
            ('SUPABASE CHECKS', ['Inside Vauban? Consent?', 'Spam limit']),
            ('PRIVATE DATABASE', ['Exact points are', 'never made public']),
            ('THE MAP', ['Every 30 s: circles if', '3+ people; emoji for', 'obstacles'])]),
        (444, DARK, 'd', '#ffffff', 'ASK THE MAP', 'the AI chatbot', MUTED, [
            ('A QUESTION', ['Typed in the chat, e.g.', '"Where is it crowded?"']),
            ('AI AGENT', ['Runs on Google Cloud', 'Run (Paris region)']),
            ('MISTRAL LLM + TOOLS', ['Reads map layers and', 'hotspots (read-only)']),
            ('THE ANSWER', ['Reply in the chat +', 'places highlighted']),
        ]),
    ]
    LH = 180
    for y, col, key, txtcol, name, sub, subcol, steps in lanes:
        b.append(f'<rect x="{X0}" y="{y}" width="{LW}" height="{LH}" rx="20" fill="{col}"/>')
        words = {'URBAN GIS DATA': ['URBAN', 'GIS DATA'], 'PEDESTRIAN FEEDBACK': ['PEDESTRIAN', 'FEEDBACK'],
                 'ASK THE MAP': ['ASK THE', 'MAP']}[name]
        b.append(t(X0 + 26, y + 70, words[0], 50, 400, txtcol, fam='Bebas Neue', ls=0.6))
        b.append(t(X0 + 26, y + 114, words[1], 50, 400, txtcol, fam='Bebas Neue', ls=0.6))
        b.append(t(X0 + 26, y + 150, sub, 17, 600, txtcol, ls=0.2))
        for i, (title, body) in enumerate(steps):
            x = CX + i * (CW + GAP)
            last = i == 3
            fillc = '#fafaf8' if last else PALE
            _cid[0] += 1
            cid = f'c{_cid[0]}'
            stroke = INK if last else STROKE
            sw = 5 if last else 2
            b.append(f'<clipPath id="{cid}"><rect x="{x}" y="{y}" width="{CW}" height="{LH}" rx="18"/></clipPath>')
            b.append(f'<rect x="{x}" y="{y}" width="{CW}" height="{LH}" rx="18" fill="{fillc}" stroke="{stroke}" stroke-width="{sw}"/>')
            b.append(f'<rect x="{x}" y="{y}" width="{CW}" height="12" fill="{col}" clip-path="url(#{cid})"/>')
            b.append(t(x + 24, y + 62, title, 38, 400, INK, fam='Bebas Neue', ls=0.5))
            b.append(lines(x + 24, y + 98, body, 21, 400, INK, lh=1.36))
            if i < 3:
                ax = x + CW + 6
                c2 = col if key != 's' else SAGE_D
                tipx = x + CW + GAP - 3
                b.append(conn(f'M{ax:.0f} {y + LH / 2} H{tipx - 12:.0f}', c2, [(tipx, y + LH / 2, 'r')], w=6))
    return wrap(''.join(b), W, H)


if __name__ == '__main__':
    open(os.path.join(OUT, 'slide-architecture.svg'), 'w').write(architecture())
    open(os.path.join(OUT, 'slide-dataflow.svg'), 'w').write(dataflow())
    print('written')
