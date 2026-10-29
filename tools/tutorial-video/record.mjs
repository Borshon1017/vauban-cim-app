// Records a ~45 s tutorial video of the real app: fake mouse cursor, big captions, camera zooms, call-outs on the map.
//   npm run video            (needs: Google Chrome, ffmpeg, and an internet connection for the background map)
// What happens: it starts a FAKE backend (no real reports are created, the chat answers are scripted), starts the app,
// opens it inside a "stage" page (phone + captions), plays a script of clicks, records the screen and
// builds tools/tutorial-video/out/vauban-tutorial.mp4.
import puppeteer from 'puppeteer-core';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inVauban } from '../../src/vauban.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'tutorial-video', 'out');
const FRAMES = path.join(OUT, 'frames');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PORT = 5440, API_PORT = 5441, APP = `http://127.0.0.1:${APP_PORT}/`;
const W = 1280, H = 720, SCALE = 1.5;
const PH_W = 372, PH_H = 680;                                                    // size of the phone screen inside the stage
const VIEW_W = 520, VIEW_L = (W - VIEW_W) / 2;                                   // the camera window around the phone
const PHONE_L = (VIEW_W - PH_W - 20) / 2, PHONE_T = (H - PH_H - 20) / 2, BEZEL = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPEED = Number(process.env.VIDEO_SPEED || 1.3);                            // 1 = relaxed; higher = faster video
const wait = (ms) => sleep(ms / SPEED);

const CAP = JSON.parse(fs.readFileSync(process.env.VIDEO_CAPTIONS || path.join(ROOT, 'tools', 'tutorial-video', 'captions.json'), 'utf8'));   // <- the texts live in captions.json
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(FRAMES, { recursive: true });

/* ------------------------------------------------------------------ real objects near the street spot */
const rd = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', n + '.geojson'), 'utf8')).features;
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 71000, (a[1] - b[1]) * 111000);
const anyPt = (f) => { const g = f.geometry; if (g.type === 'Point') return g.coordinates; if (g.type === 'LineString') return [(g.coordinates[0][0] + g.coordinates[1][0]) / 2, (g.coordinates[0][1] + g.coordinates[1][1]) / 2]; return [f.properties.cx, f.properties.cy]; };
const D = Object.fromEntries(['signals', 'lamps', 'benches', 'crossings', 'trees'].map((n) => [n, rd(n)]));
const SPOT = D.signals.map((s) => { const p = s.geometry.coordinates; const n = (arr) => arr.filter((f) => dist(p, anyPt(f)) < 45).length;
  return { p, score: Math.min(n(D.lamps), 3) + Math.min(n(D.benches), 2) + Math.min(n(D.crossings), 3) + Math.min(n(D.trees), 3) / 2 }; }).sort((a, b) => b.score - a.score)[0].p;
console.log('street spot:', SPOT);

/* ------------------------------------------------------------------ fake backend (what the app talks to) */
const CATS = [['crossing', 'Crossing', 'Traversée', 'safety'], ['traffic', 'Traffic', 'Circulation', 'safety'], ['sidewalk', 'Sidewalk', 'Trottoir', 'safety'], ['bike_lane', 'Bike lane', 'Piste cyclable', 'safety'],
  ['lighting', 'Lighting / too dark', 'Éclairage', 'safety'], ['surface', 'Road or path surface', 'Revêtement', 'safety'], ['enclosed', 'Narrow or enclosed street', 'Rue étroite', 'safety'], ['other', 'Other', 'Autre', 'safety'],
  ['good_place', 'Nothing to report', 'Rien à signaler', 'safety'], ['crowd_general', 'Crowd level', 'Affluence', 'crowd']].map(([code, label, label_fr, topic], i) => ({ code, label, label_fr, topic, sort_order: i }));
const pt = (lng, lat, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props });
const SAFETY = [
  [3.0452, 50.6335, { reports: 24, avg_score: 1.3, top_category: 'bike_lane', comments: ['The bike lane just stops with no warning', 'I have to merge with the cars at the junction', 'Really scary on my bike in the morning'] }],
  [3.0431, 50.6368, { reports: 18, avg_score: 1.6, top_category: 'lighting', comments: ['Very dark in the evening near the park', 'One more streetlight would make a big difference'] }],
  [3.0489, 50.6322, { reports: 15, avg_score: 2.1, top_category: 'crossing', comments: ['No crossing in front of the campus entrance'] }],
  [3.0475, 50.6372, { reports: 9, avg_score: 2.8, top_category: 'good_place', comments: ['Nice and open, feels safe'] }],
  [SPOT[0] + 0.0006, SPOT[1] - 0.0004, { reports: 7, avg_score: 2.2, top_category: 'crossing', comments: [] }]
].filter(([x, y]) => inVauban(x, y)).map(([x, y, p]) => pt(x, y, p));
const CROWD = [
  [3.0440, 50.6342, { reports: 30, avg_score: 1.2, top_category: 'crowd_general', avg_count: 100, avg_difficulty: 4.3, comments: ['The bus is packed at 8:15'] }],
  [3.0489, 50.6322, { reports: 14, avg_score: 2.0, top_category: 'crowd_general', avg_count: 50, avg_difficulty: 3, comments: [] }],
  [3.0431, 50.6368, { reports: 8, avg_score: 2.9, top_category: 'crowd_general', avg_count: 20, avg_difficulty: 1.6, comments: ['Always quiet here'] }]
].filter(([x, y]) => inVauban(x, y)).map(([x, y, p]) => pt(x, y, p));
const when = (d) => new Date(Date.now() - d * 864e5).toISOString();
const OBSTACLES = [['🚧', 4, -0.00012, 0.00004, 5], ['🕳️', 2, 0.0001, 0.00012, 2], ['🚲', 3, -0.0001, -0.0001, 1], ['🗑️', 1, 0.00022, -0.00005, 9], ['🌳', 1, 0.0002, -0.00018, 3]]
  .map(([emoji, reports, dx, dy, d]) => [SPOT[0] + dx, SPOT[1] + dy, { emoji, reports, last_at: when(d) }]).filter(([x, y]) => inVauban(x, y)).map(([x, y, p]) => pt(x, y, p));
const CHAT = {
  answer: CAP.demoChatAnswer,
  highlights: { type: 'FeatureCollection', features: [pt(3.0452, 50.6335, {}), pt(3.0431, 50.6368, {})].filter((f) => inVauban(...f.geometry.coordinates)) }
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = () => ({ access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '11111111-2222-3333-4444-555555555555', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`,
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rt',
  user: { id: '11111111-2222-3333-4444-555555555555', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {} } });
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
const api = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  let body = ''; req.on('data', (c) => (body += c));
  req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/auth/v1/signup' || p === '/auth/v1/token') return send(res, 200, session());
    if (p === '/auth/v1/user') return send(res, 200, session().user);
    if (p === '/rest/v1/categories') return send(res, 200, CATS);
    if (p === '/rest/v1/rpc/get_hotspots') return send(res, 200, { type: 'FeatureCollection', features: body.includes('"crowd"') ? CROWD : SAFETY });
    if (p === '/rest/v1/rpc/get_obstacles') return send(res, 200, { type: 'FeatureCollection', features: OBSTACLES });
    if (p === '/rest/v1/rpc/submit_feedback') return send(res, 200, '00000000-0000-0000-0000-000000000001');
    if (p === '/api/chat') return setTimeout(() => send(res, 200, CHAT), 900);                // the scripted "Ask the map" answer
    send(res, 404, { message: 'not in the demo backend: ' + p });
  });
}).listen(API_PORT, '127.0.0.1');

/* ------------------------------------------------------------------ start the app */
const vite = spawn('npx', ['vite', '--port', String(APP_PORT), '--host', '127.0.0.1', '--strictPort'], { cwd: ROOT, stdio: 'ignore',
  env: { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`, VITE_SUPABASE_ANON_KEY: 'demo', VITE_AGENT_URL: `http://127.0.0.1:${API_PORT}` } });
for (let i = 0; i < 60; i++) { try { if ((await fetch(APP)).ok) break; } catch { /* not up yet */ } await sleep(500); }
const consentV = (fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8').match(/CONSENT_VERSION = '([^']+)'/) || [])[1] || 'v3';

/* ------------------------------------------------------------------ the stage page: phone + captions + cursor */
// [big title, big sentence, small line 1, small line 2] (edit them in captions.json)
const STEPS = CAP.steps.map((x) => [x.title, x.sentence, x.line1, x.line2]);
const STAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#070f19;font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,sans-serif;color:#fff}
body{background:radial-gradient(1000px 720px at 50% 45%,#17365a 0%,#08121e 72%)}
#left,#right{position:absolute;top:0;bottom:0;width:${VIEW_L}px;display:flex;flex-direction:column;justify-content:center}
#left{left:0;padding:0 24px 0 44px}#right{right:0;padding:0 44px 0 24px}
#num{font-size:17px;letter-spacing:.16em;text-transform:uppercase;color:#7fb0ff;font-weight:800;margin-bottom:16px}
#title{font-size:62px;line-height:.98;font-weight:900;letter-spacing:-.03em;text-wrap:balance}
#bar1{width:74px;height:8px;border-radius:4px;background:#6ea2ff;margin-top:24px}
#big{font-size:35px;line-height:1.13;font-weight:800;letter-spacing:-.015em;color:#fff}
#small{margin-top:26px;display:grid;gap:10px}
#small div{font-size:22px;line-height:1.25;color:#b8cdf0;font-weight:600;opacity:0;transform:translateY(8px);transition:opacity .45s,transform .45s}
#small div.on{opacity:1;transform:none}
#brand{position:absolute;left:44px;top:30px;font-size:18px;font-weight:800;color:#cfe0ff;letter-spacing:.02em}
.fade{transition:opacity .3s,transform .3s}.fade.off{opacity:0;transform:translateY(10px)}
#view{position:absolute;left:${VIEW_L}px;top:0;width:${VIEW_W}px;height:${H}px;overflow:hidden}
#stage{position:absolute;left:0;top:0;width:${VIEW_W}px;height:${H}px;transform-origin:0 0;transition:transform .9s cubic-bezier(.45,0,.2,1)}
#phone{position:absolute;left:${PHONE_L}px;top:${PHONE_T}px;width:${PH_W + 20}px;height:${PH_H + 20}px;border-radius:44px;background:#05090d;padding:10px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 2px #22364c inset}
#app{width:${PH_W}px;height:${PH_H}px;border:0;border-radius:34px;background:#fff;display:block}
#bar{position:absolute;left:0;bottom:0;height:7px;width:0;background:#6ea2ff;z-index:70}
#cursor{position:absolute;left:0;top:0;width:36px;height:36px;pointer-events:none;z-index:50;transition:transform .55s cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 3px 5px rgba(0,0,0,.6))}
#ripple{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:4px solid #6ea2ff;pointer-events:none;z-index:49;opacity:0}
#ripple.go{animation:rp .55s ease-out}
@keyframes rp{0%{opacity:.95;transform:scale(.3)}100%{opacity:0;transform:scale(3.4)}}
.co{position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:45;pointer-events:none;opacity:0;transform:scale(.96);transition:opacity .3s,transform .3s}
.co.on{opacity:1;transform:none}
.co .pill{position:absolute;white-space:nowrap;font-size:23px;font-weight:900;letter-spacing:.01em;padding:7px 14px;border-radius:12px;background:#fff;color:#0b1622;border:4px solid var(--c);box-shadow:0 8px 24px rgba(0,0,0,.45)}
.co .dot{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:var(--c);border:3px solid #fff;box-shadow:0 0 0 6px rgba(255,255,255,.28)}
.co svg{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:visible}
#end{position:absolute;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(6,14,24,.94);opacity:0;pointer-events:none;transition:opacity .6s}
#end.on{opacity:1}#end b{font-size:96px;line-height:1;letter-spacing:-.04em;font-weight:900}#end span{font-size:30px;color:#b9cdee;font-weight:600}
</style></head><body>
<div id="brand">${CAP.brand}</div>
<div id="left"><div class="fade" id="lt"><div id="num"></div><div id="title"></div><div id="bar1"></div></div></div>
<div id="view"><div id="stage"><div id="phone"><iframe id="app" allow="geolocation" src="${APP}"></iframe></div></div></div>
<div id="right"><div class="fade" id="rt"><div id="big"></div><div id="small"></div></div></div>
<div id="bar"></div>
<div id="ripple"></div>
<svg id="cursor" viewBox="0 0 34 34"><path d="M6 3 L6 26 L12 21 L16 30 L20 28 L16 19 L24 19 Z" fill="#fff" stroke="#0b1622" stroke-width="2" stroke-linejoin="round"/></svg>
<div id="end"><b>${CAP.endCard.title}</b><span>${CAP.endCard.line1}</span><span>${CAP.endCard.line2}</span></div>
</body></html>`;

/* ------------------------------------------------------------------ browser */
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: W, height: H, deviceScaleFactor: SCALE },
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${path.join(OUT, 'profile')}`] });
const page = await browser.newPage();
const STAGE_URL = APP + '__stage';                      // same address as the app, so the phone page can use its storage normally
await page.setRequestInterception(true);
page.on('request', (r) => (r.url() === STAGE_URL ? r.respond({ status: 200, contentType: 'text/html', body: STAGE }) : r.continue()));
await page.evaluateOnNewDocument((v) => { try { if (location.port === '5440') { localStorage.setItem('consent', v); localStorage.setItem('lang', 'en'); localStorage.removeItem('layers'); localStorage.removeItem('chat'); } } catch { /* ignore */ } }, consentV);
const ctx = browser.defaultBrowserContext(); await ctx.overridePermissions(APP, ['geolocation']);
await page.setGeolocation({ longitude: SPOT[0], latitude: SPOT[1], accuracy: 12 });
await page.goto(STAGE_URL, { waitUntil: 'domcontentloaded' });
const frame = await (async () => { for (let i = 0; i < 40; i++) { const f = page.frames().find((x) => x.url() === APP); if (f) return f; await sleep(250); } throw new Error('app frame not found'); })();
await frame.waitForSelector('#count', { timeout: 60000 });
await frame.waitForFunction(() => window.__map && window.__map.loaded() && document.getElementById('count').textContent.length > 0, { timeout: 60000 });
await frame.evaluate(() => { const a = document.querySelector('.maplibregl-ctrl-attrib'); if (a) { a.classList.remove('maplibregl-compact-show'); a.removeAttribute('open'); } });
await sleep(2500);
console.log('app ready; start recording');

/* ------------------------------------------------------------------ recording (Chrome screencast) */
const client = await page.createCDPSession();
const frames = [];
client.on('Page.screencastFrame', async (e) => { frames.push({ t: e.metadata.timestamp, data: e.data }); try { await client.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch { /* closing */ } });
const T0 = Date.now();
await client.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });

/* ------------------------------------------------------------------ helpers for the script */
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const frameRect = (sel) => frame.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
async function pagePoint(local) {                                            // a point inside the app -> a point on the stage page
  const b = await ev(() => { const r = document.getElementById('app').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const s = b.w / PH_W; return { x: b.x + local.x * s, y: b.y + local.y * s };
}
const centerOf = async (sel) => { const r = await frameRect(sel); return pagePoint({ x: r.x + r.w / 2, y: r.y + r.h / 2 }); };
const mapPoint = async (lng, lat) => pagePoint(await frame.evaluate((a, b) => { const p = window.__map.project([a, b]); return { x: p.x, y: p.y }; }, lng, lat));

async function cursorTo(p, ms = 550) {
  await ev((x, y, ms) => { const c = document.getElementById('cursor'); c.style.transitionDuration = ms + 'ms'; c.style.transform = `translate(${x - 6}px,${y - 3}px)`; }, p.x, p.y, ms / SPEED);
  await wait(ms + 40);
}
async function press(p) {
  await ev((x, y) => { const r = document.getElementById('ripple'); r.style.left = x + 'px'; r.style.top = y + 'px'; r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }, p.x, p.y);
  await page.mouse.click(p.x, p.y); await wait(120);
}
async function click(sel, { move = 550, after = 250 } = {}) {
  await frame.$eval(sel, (e) => e.scrollIntoView({ block: 'nearest' })).catch(() => {});   // inside the scrolling form: bring it into view first
  const p = await centerOf(sel); await cursorTo(p, move); await press(p); await wait(after);
}
async function zoomStage(sel, s, ms = 800) {                                  // camera zoom on the phone (sel = element inside the app); s = 1 resets
  let tx = 0, ty = 0;
  if (s > 1 && sel) { const r = await frameRect(sel); const P = { x: PHONE_L + BEZEL + r.x + r.w / 2, y: PHONE_T + BEZEL + r.y + r.h / 2 };
    tx = Math.min(0, Math.max(VIEW_W - VIEW_W * s, VIEW_W / 2 - s * P.x)); ty = Math.min(0, Math.max(H - H * s, H / 2 - s * P.y)); }
  await ev((tx, ty, s, ms) => { const st = document.getElementById('stage'); st.style.transitionDuration = ms + 'ms'; st.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; }, tx, ty, s, ms / SPEED);
  await wait(ms + 60);                                                        // let the camera finish before the next click is aimed
}
const MARKS = [];
const mark = (n) => { MARKS.push([n, ((Date.now() - T0) / 1000).toFixed(1)]); };
async function step(i) {
  mark('step ' + (i + 1)); const [title, big, s1, s2] = STEPS[i];
  await ev((i, n, title, big, s1, s2) => {
    const lt = document.getElementById('lt'), rt = document.getElementById('rt'); lt.classList.add('off'); rt.classList.add('off');
    setTimeout(() => { document.getElementById('num').textContent = (i + 1) + ' / ' + n; const tt = document.getElementById('title'); tt.textContent = title; let fs = 62; tt.style.fontSize = fs + 'px'; while (tt.scrollWidth > tt.clientWidth && fs > 40) { fs -= 2; tt.style.fontSize = fs + 'px'; }
      document.getElementById('big').textContent = big;
      const sm = document.getElementById('small'); sm.innerHTML = '<div>' + s1 + '</div><div>' + s2 + '</div>'; lt.classList.remove('off'); rt.classList.remove('off');
      [...sm.children].forEach((d, k) => setTimeout(() => d.classList.add('on'), 500 + k * 450)); }, 280);
  }, i, STEPS.length, title, big, s1, s2);
}
const snap = async (n) => { if (process.env.VIDEO_DEBUG) await page.screenshot({ path: path.join(OUT, n + '.png') }); };
const progress = (frac) => ev((f) => { document.getElementById('bar').style.width = (f * 100) + '%'; }, frac);
const camera = (opts) => frame.evaluate((o) => window.__map.flyTo({ essential: true, ...o }), { ...opts, duration: (opts.duration || 1500) / SPEED });

// a big label with a line pointing at a real object on the map
async function callout(text, lng, lat, color, side) {
  const p = await mapPoint(lng, lat), pr = await ev(() => { const r = document.getElementById('app').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const dx = side === 'left' ? -70 : 70, dy = -58;
  const L = { x: Math.min(pr.x + pr.w - 20, Math.max(pr.x + 20, p.x + dx)), y: Math.min(pr.y + pr.h - 60, Math.max(pr.y + 70, p.y + dy)) };
  await ev((text, p, L, color, side, pr) => {
    const d = document.createElement('div'); d.className = 'co'; d.style.setProperty('--c', color);
    d.innerHTML = '<svg><line stroke="' + color + '" stroke-width="4" stroke-linecap="round"/></svg><div class="dot"></div><div class="pill"></div>';
    d.querySelector('.dot').style.cssText = `left:${p.x}px;top:${p.y}px`;
    const pill = d.querySelector('.pill'); pill.textContent = text; pill.style.top = (L.y - 22) + 'px'; pill.style.left = '0px';
    document.body.appendChild(d);
    const w = pill.offsetWidth, h = pill.offsetHeight;                                  // keep the label inside the phone, then aim the line at it
    const left = Math.min(pr.x + pr.w - 10 - w, Math.max(pr.x + 10, side === 'left' ? L.x - w + 10 : L.x - 10));
    const placed = (window.__placed = window.__placed || []);
    let top = L.y - 22;
    for (const dy of [0, 66, -66, 132, -132, 198, -198]) {                                // move the label up or down until it touches no other label
      const t2 = L.y - 22 + dy; if (t2 < pr.y + 60 || t2 + h > pr.y + pr.h - 80) continue;
      const coversDot = p.x > left - 16 && p.x < left + w + 16 && p.y > t2 - 16 && p.y < t2 + h + 16;           // never hide the object it points at
      if (!coversDot && !placed.some((r) => left < r.x + r.w + 8 && left + w + 8 > r.x && t2 < r.y + r.h + 8 && t2 + h + 8 > r.y)) { top = t2; break; }
    }
    placed.push({ x: left, y: top, w, h });
    pill.style.left = left + 'px'; pill.style.top = top + 'px';
    const ln = d.querySelector('line'), cxp = left + w / 2, cyp = top + h / 2;
    const ex = Math.abs(p.x - cxp) > w / 2 ? (p.x < cxp ? left : left + w) : p.x;       // end of the line on the label edge nearest the dot
    ln.setAttribute('x1', p.x); ln.setAttribute('y1', p.y); ln.setAttribute('x2', ex); ln.setAttribute('y2', cyp);
    requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('on')));
  }, text, p, L, color, side, pr);
  await wait(650);
}
const clearCallouts = () => ev(() => { window.__placed = []; document.querySelectorAll('.co').forEach((d) => d.classList.remove('on')); setTimeout(() => document.querySelectorAll('.co').forEach((d) => d.remove()), 400); });
const nearest = (arr, lng, lat, ok = () => true) => arr.map((f) => ({ f, p: anyPt(f) })).filter((x) => ok(x.p)).sort((a, b) => dist(a.p, [lng, lat]) - dist(b.p, [lng, lat]))[0];

/* ------------------------------------------------------------------ THE SCRIPT (about 45 seconds) */
const total = Number(process.env.VIDEO_TOTAL || 45000); const tick = setInterval(() => progress(Math.min(1, (Date.now() - T0) / total)).catch(() => {}), 250);
await cursorTo({ x: 640, y: 430 }, 10);

// 1  the live map
await step(0); await wait(700);
const circle = await mapPoint(SAFETY[0].geometry.coordinates[0], SAFETY[0].geometry.coordinates[1]);
await cursorTo(circle, 700); await wait(2300);

// 2  tap a circle -> popup with comments
await step(1);
await press(circle); await wait(500);
await zoomStage('#detail', 1.5, 800); await wait(2000);
await zoomStage(null, 1, 600);
await click('#detail #det-close', { move: 400, after: 100 });

// 3  three lenses: Crowd, then Obstacles
await step(2);
await click('#topic [data-topic="crowd"]', { move: 500, after: 1000 });
await click('#topic [data-topic="obstacle"]', { move: 450, after: 1200 });

// 4  obstacles at street level
await step(3);
await camera({ center: [SPOT[0], SPOT[1]], zoom: 18.1, duration: 2200 });
await wait(2600); await snap('dbg-obstacles');
await click('.obs-marker', { move: 600, after: 500 });
await zoomStage('#detail', 1.45, 700); await wait(1500);
await zoomStage(null, 1, 500); await click('#detail #det-close', { move: 400, after: 100 });

// 5  now you can see everything: call-outs on real objects
await step(4);
await click('#topic [data-topic="safety"]', { move: 500, after: 700 });
await frame.evaluate(() => { document.getElementById('legend').style.opacity = '0'; });
const cx = SPOT[0], cy = SPOT[1];
const picks = [
  [CAP.callouts.trafficLight, nearest(D.signals, cx, cy), '#d6382e', 'right'],
  [CAP.callouts.crossing, nearest(D.crossings, cx, cy, (p) => dist(p, [cx, cy]) > 8), '#0b6bcb', 'left'],
  [CAP.callouts.lamp, nearest(D.lamps, cx, cy), '#f2a900', 'right'],
  [CAP.callouts.bench, nearest(D.benches, cx, cy), '#8a6f4d', 'left'],
  [CAP.callouts.tree, nearest(D.trees, cx, cy, (p) => dist(p, [cx, cy]) > 6), '#25a56a', 'right']
];
for (const [text, hit, color, side] of picks) if (hit) await callout(text, hit.p[0], hit.p[1], color, side);
await wait(1200); await snap('dbg-callouts'); await clearCallouts(); await wait(350);
await frame.evaluate(() => { document.getElementById('legend').style.opacity = ''; });

// 6  3D
await step(5);
await click('#btn-3d', { move: 550, after: 300 });
await camera({ center: [SPOT[0], SPOT[1] - 0.00015], zoom: 19.1, pitch: 60, bearing: 28, duration: 2400 });
await wait(3500);

// 7  ask the map (the assistant is switched on in Settings)
await step(6);
await click('#btn-settings', { move: 550, after: 450 });
await click('#set-chat', { move: 450, after: 300 });
await click('#s-close', { move: 450, after: 300 });
await click('#btn-chat', { move: 500, after: 600 });
await zoomStage('#chat-sugg', 1.25, 600);
await click('#chat-sugg .chip', { move: 500, after: 1900 });
await zoomStage('#chat-log', 1.25, 500); await wait(1000);
await zoomStage(null, 1, 500);
await click('#chat-close', { move: 450, after: 300 });

// 8  report a place
await step(7);
await click('#btn-report', { move: 600, after: 500 });
await click('#mode-now', { move: 500, after: 1000 });
await zoomStage(null, 1, 400);
await click('#btn-pick-ok', { move: 500, after: 700 });
await zoomStage('#sheet', 1.25, 500);
await click('input[name="problem"][value="lighting"] + span', { move: 450, after: 200 });
await click('input[name="rate-lighting"][value="2"] + span', { move: 400, after: 200 });
await click('input[name="age"][value="18_25"] + span', { move: 400, after: 200 });
await click('#btn-send', { move: 400, after: 600 });
await zoomStage(null, 1, 450); await wait(700);

// 9  legend, then the end card
await step(8);
await click('#btn-info', { move: 550, after: 500 });
await zoomStage('.lgx', 1.2, 600); await wait(2700);
mark('end card'); await ev(() => document.getElementById('end').classList.add('on')); await wait(2000);

clearInterval(tick); await progress(1);
const elapsed = ((Date.now() - T0) / 1000).toFixed(1);
await client.send('Page.stopScreencast');
await browser.close(); vite.kill(); api.close();
console.log('timeline:', MARKS.map(([n, t]) => `${n}@${t}s`).join('  '));
console.log(`recorded ${frames.length} frames in ${elapsed}s`);

/* ------------------------------------------------------------------ build the video */
frames.sort((a, b) => a.t - b.t);
const list = [];
frames.forEach((f, i) => { const file = path.join(FRAMES, `f${String(i).padStart(5, '0')}.jpg`); fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  const dur = i < frames.length - 1 ? Math.max(0.001, frames[i + 1].t - f.t) : 1 / 30; list.push(`file '${file}'`, `duration ${dur.toFixed(4)}`); });
list.push(`file '${path.join(FRAMES, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
fs.writeFileSync(path.join(OUT, 'frames.txt'), list.join('\n'));
const mp4 = path.join(OUT, 'vauban-tutorial.mp4');
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('ffmpeg failed');
fs.rmSync(FRAMES, { recursive: true, force: true }); fs.rmSync(path.join(OUT, 'profile'), { recursive: true, force: true });
console.log('video:', mp4);
