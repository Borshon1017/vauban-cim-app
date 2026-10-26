import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { createClient } from '@supabase/supabase-js';
import './style.css';
import { T, DEFAULT_LANG, CATEGORY_FALLBACK } from './i18n.js';
import { VAUBAN_RING, BBOX, inVauban, snapInside } from './vauban.js';
import { addVaubanLayers, LAYER_KEYS, LAYER_DEFAULTS } from './layers.js';
import { initChat } from './chat.js';

/* ---------- config ---------- */
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CONSENT_VERSION = 'v3';                     // bump when the consent / privacy text changes
const PAD = 0.003;                                // the map can be moved a little beyond the district (about 300 m)
const FAR_FROM_FIX_M = 100;                       // pin further than this from the GPS fix = "remembered" report
const LOW_ACC_M = 100;                            // GPS fix less precise than this: ask the user to place the pin themselves
const TOD_START = { morning: 5, afternoon: 12, evening: 18, night: 22 };   // must match supabase/01_schema.sql
const MAX_PAST_DAYS = 365;                        // must match private.settings max_past_days
const OBS_ZOOM = 16;                              // obstacles appear on the map from this zoom level
const TAP_GUARD_MS = 350;                         // ignore the 2nd tap of a double-tap after a screen change

const $ = (id) => document.getElementById(id);
const configured = Boolean(URL && KEY);
const supabase = configured ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};
let consentOk = store.get('consent') === CONSENT_VERSION;   // kept in memory too, in case storage is blocked

/* ---------- language (French by default) ---------- */
let lang = store.get('lang');
if (!T[lang]) lang = DEFAULT_LANG;

function t(key, vars) {
  let s = T[lang][key] ?? T.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  if (lang === 'fr') {                              // French typography: non-breaking spaces
    s = s.replace(/ ([?!;])/g, ' $1').replace(/ ([:»])/g, ' $1').replace(/« /g, '« ').replace(/(\d) (m|h)\b/g, '$1 $2');
  }
  return s;
}

function applyStatic() {
  document.documentElement.lang = lang;
  document.documentElement.classList.remove('i18n-pending');
  document.title = t('title');
  document.querySelector('meta[name="description"]').setAttribute('content', t('meta.desc'));
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}

function setLang(next) {
  if (!T[next] || next === lang) return;
  lang = next; store.set('lang', lang);
  applyStatic(); renderFormTopic(false); renderLegend(); renderPickHelp(); renderPosNote(); renderDetail(); renderInfoVersion(); setCtrlLabels(); setMsg(msgKey); syncDateField(); buildTimeSelects();
  chat.render();
}
document.querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => setLang(b.dataset.lang); });

/* ---------- dialogs: move focus in, give it back on close ---------- */
let lastFocus = null;
function openDialog(el) {
  lastFocus = document.activeElement; el.hidden = false;
  const h = el.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}
function closeDialog(el, fallback) {
  el.hidden = true;
  const back = lastFocus && document.contains(lastFocus) && lastFocus.offsetParent !== null ? lastFocus : fallback;
  if (back) back.focus({ preventScroll: true });
}

/* ---------- topics: Safety and Crowd ---------- */
let topic = 'safety';                              // topic shown on the map
const FEEL = {                                     // word used for the average colour of a circle: 1 = red, 2 = yellow, 3 = green
  safety: ['unsafe', 'hard', 'good'],
  crowd:  ['crowded', 'busy', 'calm']
};
const OBSTACLES = [                                // preset emoji obstacles: [id (text key obs.<id>), emoji]
  ['construction', '🚧'], ['pothole', '🕳️'], ['car', '🚗'], ['scooter', '🛴'], ['bike', '🚲'], ['bins', '🗑️'], ['tree', '🌳'], ['water', '💧'],
  ['ice', '🧊'], ['debris', '🪨'], ['works', '🏗️'], ['boxes', '📦'], ['sign', '🪧'], ['blocked', '⛔'], ['warning', '⚠️'], ['wall', '🧱']
];
const obstacleLabel = (emoji) => { const o = OBSTACLES.find((x) => x[1] === emoji); return o ? t('obs.' + o[0]) : t('obs.custom.label'); };
const RATE_FACES = ['f-unsafe', 'f-sad', 'f-hard', 'f-good', 'f-vgood'];   // very unsafe .. very safe
const formTopic = () => (document.querySelector('input[name="topic"]:checked') || {}).value || topic;

/* ---------- categories (texts come from the database when available) ---------- */
let cats = CATEGORY_FALLBACK.map(([code, en, fr, tp]) => ({ code, en, fr, topic: tp }));
const catName = (code) => { const c = cats.find((x) => x.code === code); return c ? (lang === 'fr' ? (c.fr || c.en) : c.en) : code; };
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Safety: the problems people can pick (several allowed)
const checkedVals = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((e) => e.value);
function renderCats() {
  const prev = new Set(checkedVals('problem'));
  $('cats').innerHTML = cats.filter((c) => c.topic === 'safety' && c.code !== 'good_place').map((c) =>
    `<label><input type="checkbox" name="problem" value="${esc(c.code)}"><span>${esc(catName(c.code))}</span></label>`).join('');
  document.querySelectorAll('input[name="problem"]').forEach((el) => { el.checked = prev.has(el.value); el.addEventListener('change', renderRatings); });
  renderRatings();
}
// ...and one rating row (very unsafe .. very safe) for each problem picked
function renderRatings() {
  const picked = checkedVals('problem');
  const old = {}; picked.forEach((c) => { old[c] = val('rate-' + c); });
  $('ratings-field').hidden = picked.length === 0;
  $('ratings').innerHTML = picked.map((c) =>
    `<div class="rate-row"><p class="rate-q">${t('rate.q', { p: '<b>' + esc(catName(c)) + '</b>' })}</p><div class="rates">` +
    [1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rate-${esc(c)}" value="${n}"${old[c] === String(n) ? ' checked' : ''}>` +
      `<span class="rf r${n}"><svg class="face" aria-hidden="true"><use href="#${RATE_FACES[n - 1]}"/></svg><span class="vh">${t('rate.' + n)}</span></span></label>`).join('') +
    `</div><div class="scale"><span>${t('rate.1')}</span><span>${t('rate.5')}</span></div></div>`).join('');
}
async function loadCategories() {
  if (!supabase) return;
  let { data, error } = await supabase.from('categories').select('code,label,label_fr,topic').order('sort_order');
  if (error) ({ data, error } = await supabase.from('categories').select('code,label,label_fr').order('sort_order'));   // database without topics yet
  if (error || !data || !data.length) return;
  const byCode = new Map(cats.map((c) => [c.code, c]));                      // database texts win, built-in ones fill the gaps
  data.forEach((c) => { const old = byCode.get(c.code) || {}; byCode.set(c.code, { code: c.code, en: c.label, fr: c.label_fr || old.fr, topic: c.topic || old.topic || 'safety' }); });
  cats = [...byCode.values()];
  renderCats();
}

/* the form shows the questions of the chosen topic */
function renderEmojis() {
  const prev = val('emoji');
  $('emojis').innerHTML = OBSTACLES.map(([id, e]) =>
    `<label><input type="radio" name="emoji" value="${e}"><span class="emo" role="img" aria-label="${esc(t('obs.' + id))}" title="${esc(t('obs.' + id))}">${e}</span></label>`).join('') +
    `<label><input type="radio" name="emoji" value="custom"><span class="emo plus" aria-label="${esc(t('obs.custom.label'))}" title="${esc(t('obs.custom.label'))}">＋</span></label>`;
  if (prev) { const el = [...document.querySelectorAll('input[name="emoji"]')].find((x) => x.value === prev); if (el) el.checked = true; }
  document.querySelectorAll('input[name="emoji"]').forEach((r) => r.addEventListener('change', syncEmojiField));
}
function syncEmojiField() {
  const custom = val('emoji') === 'custom';
  $('emoji-custom-wrap').hidden = !custom;
  if (custom) $('emoji-custom').focus({ preventScroll: true });
}
// exactly one emoji: a single visible symbol, no letters or digits
function cleanEmoji(raw) {
  const v = (raw || '').trim();
  if (!v || v.length > 16 || /[\p{L}\p{N}\s<>&"']/u.test(v) || !/\p{Extended_Pictographic}/u.test(v)) return null;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) { if ([...new Intl.Segmenter().segment(v)].length !== 1) return null; }
  return v;
}
function renderFormTopic(reset) {
  const tp = formTopic();
  $('sheet').dataset.topic = tp;
  $('safety-fields').hidden = tp !== 'safety'; $('crowd-fields').hidden = tp !== 'crowd'; $('obstacle-fields').hidden = tp !== 'obstacle';
  $('more').hidden = tp === 'obstacle';
  $('q-count').textContent = t(reportMode === 'later' ? 'crowd.count.q.later' : 'crowd.count.q.now');
  if (reset) {
    ['problem', 'modes', 'count', 'peak', 'emoji'].forEach((n) => document.querySelectorAll(`input[name="${n}"]`).forEach((e) => { e.checked = false; }));
    $('emoji-custom').value = '';
  }
  renderEmojis(); syncEmojiField();
  renderCats();
}
document.querySelectorAll('input[name="topic"]').forEach((r) => { r.addEventListener('change', () => renderFormTopic(true)); });

/* ---------- map ---------- */
const DARK = window.matchMedia('(prefers-color-scheme: dark)').matches;   // colourful map in light mode, dark map in dark mode
const map = new maplibregl.Map({
  container: 'map',
  style: `https://tiles.openfreemap.org/styles/${DARK ? 'dark' : 'liberty'}`,
  bounds: [[BBOX.w, BBOX.s], [BBOX.e, BBOX.n]],              // opens on the whole district
  fitBoundsOptions: { padding: { top: 130, bottom: 110, left: 14, right: 14 } },
  maxBounds: [[BBOX.w - PAD, BBOX.s - PAD], [BBOX.e + PAD, BBOX.n + PAD]],
  minZoom: 12,
  maxPitch: 0, pitchWithRotate: false, dragRotate: false, touchPitch: false,   // flat 2D: no tilting, no rotating
  attributionControl: { compact: true }
});
map.touchZoomRotate.disableRotation();
if (import.meta.env.DEV) window.__map = map;                  // handy in the browser console while developing (not in the live site)
map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'bottom-right');
function setCtrlLabels() {
  const set = (sel, key) => { const el = document.querySelector(sel); if (el) { el.setAttribute('aria-label', t(key)); el.title = t(key); } };
  set('.maplibregl-ctrl-zoom-in', 'zoom.in'); set('.maplibregl-ctrl-zoom-out', 'zoom.out');
  set('.maplibregl-ctrl-compass', 'compass'); set('.maplibregl-ctrl-attrib-button', 'attrib.toggle');
  map.getCanvas().setAttribute('aria-label', t('map.label'));
}

const emptyFC = { type: 'FeatureCollection', features: [] };
const maskColor = () => getComputedStyle(document.documentElement).getPropertyValue('--mask').trim() || '#dfe5ea';
function refreshMask() { if (map.getLayer('outside-mask')) map.setPaintProperty('outside-mask', 'fill-color', maskColor()); }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshMask);
map.on('load', () => {
  if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', 'none');   // the base style draws buildings in relief: keep it flat unless the experimental view is on
  setCtrlLabels();
  // everything outside the district is covered, so only Vauban is visible
  map.addSource('area', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [VAUBAN_RING] } } });
  map.addSource('outside', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon',
    coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], VAUBAN_RING] } } });
  map.addLayer({ id: 'outside-mask', type: 'fill', source: 'outside', paint: { 'fill-color': maskColor(), 'fill-opacity': 1 } });
  map.addLayer({ id: 'area-line', type: 'line', source: 'area',
    paint: { 'line-color': DARK ? '#ffffff' : '#3d4a8a', 'line-width': 2, 'line-opacity': 0.55 } });

  map.addSource('hot', { type: 'geojson', data: emptyFC });
  const scoreColor = ['interpolate', ['linear'], ['get', 'avg_score'], 1, '#ff453a', 2, '#ffd60a', 3, '#30d158'];
  map.addLayer({ id: 'hot-halo', type: 'circle', source: 'hot',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'reports'], 3, 24, 15, 38, 60, 60], 'circle-color': scoreColor, 'circle-opacity': 0.22, 'circle-blur': 0.7 } });
  map.addLayer({ id: 'hot-circles', type: 'circle', source: 'hot',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'reports'], 3, 12, 15, 20, 60, 34],
      'circle-color': scoreColor,
      'circle-opacity': 0.95, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3
    } });
  map.addLayer({ id: 'hot-count', type: 'symbol', source: 'hot',
    layout: { 'text-field': ['to-string', ['get', 'reports']], 'text-size': 13, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.45)', 'text-halo-width': 1 } });

  // forgiving tap target around each circle
  map.on('click', (e) => {
    if (phase !== 'idle') return;
    const r = 14, box = [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]];
    const hit = map.queryRenderedFeatures(box, { layers: ['hot-circles'] });
    if (hit.length) showDetail(hit[0].properties); else hideDetail();
  });
  map.on('mouseenter', 'hot-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'hot-circles', () => { map.getCanvas().style.cursor = ''; });
  loadHotspots();
  // the team's QGIS data: flat in 2D, 3D with the design rules when the experimental view is on
  addVaubanLayers(map, DARK).then((ctl) => { layerCtl = ctl; applyLayers(); }).catch((e) => console.warn('Vauban layers', e));
});

let areaCount = null;
function renderCount() {
  const obs = topic === 'obstacle';
  $('count').textContent = areaCount === null ? '' : areaCount === 0 ? t('count.none')
    : t(areaCount === 1 ? (obs ? 'count.obs.one' : 'count.areas.one') : (obs ? 'count.obs.many' : 'count.areas.many'), { n: areaCount });
}
function renderLegend() {
  const obs = topic === 'obstacle';
  document.querySelector('.lg-dots').hidden = obs; $('lg-hint').hidden = !obs;
  if (obs) { $('lg-hint').textContent = map.getZoom() >= OBS_ZOOM ? '' : t('legend.zoom'); $('lg-hint').hidden = map.getZoom() >= OBS_ZOOM; }
  else {
    const keys = topic === 'crowd' ? ['legend.crowded', 'legend.busy', 'legend.calm'] : ['legend.unsafe', 'legend.hard', 'legend.good'];
    $('lg-bad').textContent = t(keys[0]); $('lg-warn').textContent = t(keys[1]); $('lg-good').textContent = t(keys[2]);
  }
  renderCount();
}
/* ---- obstacles: emoji markers, shown from zoom 16 ---- */
let obsMarkers = [];
function clearObstacles() { obsMarkers.forEach((m) => m.remove()); obsMarkers = []; }
function updateObsZoom() {
  document.body.classList.toggle('obs-zoom', topic === 'obstacle' && map.getZoom() >= OBS_ZOOM);
  if (topic === 'obstacle') renderLegend();
}
map.on('zoom', updateObsZoom);
function drawObstacles(fc) {
  clearObstacles();
  const slot = new Map();                                                  // several emoji on the same spot sit side by side
  fc.features.forEach((f) => {
    const [lng, lat] = f.geometry.coordinates, key = lng.toFixed(5) + ',' + lat.toFixed(5), k = slot.get(key) || 0; slot.set(key, k + 1);
    const el = document.createElement('button'); el.type = 'button'; el.className = 'obs-marker';
    const label = obstacleLabel(f.properties.emoji); el.setAttribute('aria-label', label); el.title = label;
    el.textContent = f.properties.emoji;
    if (f.properties.reports > 1) { const n = document.createElement('span'); n.className = 'n'; n.textContent = f.properties.reports; el.appendChild(n); }
    el.onclick = (e) => { e.stopPropagation(); showDetail(f.properties); };
    obsMarkers.push(new maplibregl.Marker({ element: el, offset: [k * 40, 0] }).setLngLat([lng, lat]).addTo(map));
  });
  updateObsZoom();
}
async function loadObstacles() {
  const { data, error } = await supabase.rpc('get_obstacles');
  if (topic !== 'obstacle') return;
  if (error) { console.warn('obstacles', error.message); areaCount = null; renderCount(); return; }
  drawObstacles(data); areaCount = data.features.length; renderCount();
}
async function loadHotspots() {
  if (!supabase || !map.getSource('hot')) return;
  if (topic === 'obstacle') return loadObstacles();
  const asked = topic;
  let { data, error } = await supabase.rpc('get_hotspots', { p_topic: asked });
  if (error && asked === 'safety') ({ data, error } = await supabase.rpc('get_hotspots'));   // database without topics yet
  if (asked !== topic) return;                                                               // the person switched topic meanwhile
  if (error) { console.warn('hotspots', error.message); areaCount = null; renderCount(); return; }
  map.getSource('hot').setData(data);
  areaCount = data.features.length; renderCount();
}
function setTopic(next) {
  if (next === topic) return;
  topic = next; hideDetail(); document.body.dataset.topic = topic;
  document.querySelectorAll('[data-topic]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.topic === topic)));
  if (map.getSource('hot')) map.getSource('hot').setData(emptyFC);
  clearObstacles(); updateObsZoom();
  areaCount = null; renderLegend(); loadHotspots();
}
document.querySelectorAll('[data-topic]').forEach((b) => { b.onclick = () => setTopic(b.dataset.topic); });
setInterval(() => { if (!document.hidden) loadHotspots(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadHotspots(); });

let detailProps = null;
function renderDetail() {
  const d = $('detail');
  if (!detailProps) { d.hidden = true; return; }
  const p = detailProps, avg = Number(p.avg_score), n = Number(p.reports);
  if (p.emoji) {                                                            // an obstacle
    const when = p.last_at ? new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' }).format(new Date(p.last_at)) : '';
    d.setAttribute('aria-label', t('detail.label'));
    d.innerHTML = `<div><b><span class="big" aria-hidden="true">${esc(p.emoji)}</span>${esc(obstacleLabel(p.emoji))}</b>` +
      `<span>${t(n === 1 ? 'detail.reports.one' : 'detail.reports.many', { n })}</span>${when ? `<span>${t('detail.obs.last', { d: esc(when) })}</span>` : ''}` +
      `<button class="link" type="button" id="det-close">${t('detail.close')}</button></div>`;
    d.hidden = false; $('det-close').onclick = hideDetail; return;
  }
  const f = (avg < 1.67 ? 0 : avg < 2.34 ? 1 : 2), word = FEEL[topic][f];
  let lines;
  if (topic === 'crowd') {
    const cnt = Number(p.avg_count);
    lines = (cnt > 0 ? `<span>${t('detail.crowd.count', { n: cnt })}</span>` : '') +
            `<span>${t('detail.crowd', { f: t('detail.feel.' + word) })}</span>`;
  } else {
    const topicLine = ['good_place', 'crowd_calm'].includes(p.top_category) ? t('detail.topic.none') : t('detail.topic', { c: esc(catName(p.top_category)) });
    lines = `<span>${topicLine}</span><span>${t('detail.feel', { f: t('detail.feel.' + word) })}</span>`;
  }
  d.setAttribute('aria-label', t('detail.label'));
  d.innerHTML = `<div><b>${t(n === 1 ? 'detail.reports.one' : 'detail.reports.many', { n })}</b>${lines}` +
    `${commentsHtml(p)}<button class="link" type="button" id="det-close">${t('detail.close')}</button></div>`;
  d.hidden = false;
  $('det-close').onclick = hideDetail;
}
// comments the team approved; the database only sends them for areas that pass the privacy rule
function commentsHtml(p) {
  let list = p.comments;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }   // map features carry nested values as text
  list = [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x.trim()))].slice(0, 3);
  if (!list.length) return '';
  return `<div class="cms"><span class="cms-h">${t('detail.comments')}</span>${list.map((c) => `<q>${esc(c)}</q>`).join('')}</div>`;
}
function showDetail(p) { detailProps = p; renderDetail(); }
function hideDetail() { detailProps = null; $('detail').hidden = true; }

/* 3D view: the cube button next to the topics. Off on every visit; the map opens flat. */
let view3d = false;
function set3d(on) {
  view3d = on; $('btn-3d').setAttribute('aria-pressed', String(on));
  applyLayers();
  map.setMaxPitch(on ? 70 : 0);
  const act = on ? 'enable' : 'disable';
  map.dragRotate[act](); map.touchPitch[act]();
  if (on) map.touchZoomRotate.enableRotation(); else map.touchZoomRotate.disableRotation();
  map.easeTo({ pitch: on ? 60 : 0, bearing: on ? -20 : 0, zoom: on ? Math.max(map.getZoom(), 17) : map.getZoom(), duration: 700 });
}

/* which data layers are shown (Settings), remembered on this phone */
let layerCtl = null;
let layerOn = { ...LAYER_DEFAULTS };
try { Object.assign(layerOn, JSON.parse(store.get('layers') || '{}')); } catch { /* keep defaults */ }
function applyLayers() { if (layerCtl) layerCtl.apply(layerOn, view3d); }
document.querySelectorAll('input[data-layer]').forEach((el) => {
  el.checked = layerOn[el.dataset.layer] !== false;
  el.addEventListener('change', () => { layerOn[el.dataset.layer] = el.checked; store.set('layers', JSON.stringify(layerOn)); applyLayers(); });
});
$('btn-settings').onclick = () => openDialog($('settings'));
$('s-close').onclick = () => closeDialog($('settings'), $('btn-settings'));
$('btn-3d').onclick = () => set3d(!view3d);

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

/* ---------- consent + info ---------- */
function renderInfoVersion() { $('info-version').textContent = t('info.version', { v: CONSENT_VERSION }); }
function syncConsent() { $('c-go').disabled = !($('c-age').checked && $('c-ok').checked); }
$('c-age').onchange = syncConsent; $('c-ok').onchange = syncConsent;
$('c-go').onclick = () => { consentOk = true; store.set('consent', CONSENT_VERSION); closeDialog($('consent'), $('btn-report')); };
$('c-more').onclick = () => openDialog($('info'));
$('btn-info').onclick = () => openDialog($('info'));
$('i-close').onclick = () => closeDialog($('info'), $('btn-info'));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('info').hidden) closeDialog($('info'), $('btn-info'));
  else if (!$('settings').hidden) closeDialog($('settings'), $('btn-settings'));
  else if (phase === 'form') { if (!sending) closeForm(true); }
  else if (phase !== 'idle') setPhase('idle');
});

/* ---------- anonymous sign-in (only when a report is sent, never just for opening the app) ---------- */
let authReady = null;
function ensureSession() {
  if (!supabase) return Promise.reject(new Error('NOBACKEND'));
  if (!authReady) {
    authReady = (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return session;
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw new Error('AUTH');
      return data.session;
    })().catch((e) => { authReady = null; throw e; });
  }
  return authReady;
}

/* ---------- report flow:  idle → mode → pick → form → idle ---------- */
let phase = 'idle';          // 'idle' | 'mode' | 'pick' | 'form'
let phaseAt = 0;
let reportMode = null;       // 'now' (here, GPS, time automatic) | 'later' (remembered place, ask when)
let fix = null;              // last GPS fix {lng, lat, acc}
let fixState = null;         // null | 'ok' | 'outside' | 'fail'
let locating = false;
let locateSeq = 0;
let chosen = null;           // {lat, lng}
let sending = false;
let pickHelp = { key: 'pick.later', vars: null };

const locked = () => performance.now() - phaseAt < TAP_GUARD_MS;
const inBox = inVauban;                           // is the point inside the district?
function metres(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function setPhase(p) {
  phase = p; phaseAt = performance.now();
  document.body.dataset.phase = p;
  $('btn-report').hidden = p !== 'idle';
  $('modebar').hidden = p !== 'mode';
  $('pickbar').hidden = p !== 'pick';
  $('crosshair').hidden = p !== 'pick';
  $('sheet').hidden = p !== 'form';
  $('btn-settings').disabled = p !== 'idle';
  $('btn-chat').disabled = p !== 'idle';
  if (p !== 'idle') { hideDetail(); $('toast').hidden = true; chat.close(); }
  if (p === 'idle') {
    reportMode = null; fix = null; fixState = null; locating = false; locateSeq++; chosen = null;
    $('form').reset(); $('more').open = false; setMsg(null); renderRatings();
  }
  const focusEl = { idle: $('btn-report'), mode: $('mode-title'), pick: $('pick-help') }[p];
  if (focusEl && p !== 'idle') { focusEl.tabIndex = -1; focusEl.focus({ preventScroll: true }); }
}
function setPickHelp(key, vars = null) { pickHelp = { key, vars }; renderPickHelp(); }
function renderPickHelp() { $('pick-help').textContent = t(pickHelp.key, pickHelp.vars); }
function syncNext() { $('btn-pick-ok').disabled = locating; }

$('btn-report').onclick = () => {
  if (!configured) return;
  if (!consentOk) { openDialog($('consent')); return; }
  setPhase('mode');
};
$('mode-cancel').onclick = () => setPhase('idle');
$('mode-now').onclick = () => { if (!locked()) startPick('now'); };
$('mode-later').onclick = () => { if (!locked()) startPick('later'); };
$('btn-pick-cancel').onclick = () => setPhase('idle');
$('btn-pick-switch').onclick = () => startPick(reportMode === 'now' ? 'later' : 'now');
$('btn-gps').onclick = () => locate();

function startPick(mode) {
  reportMode = mode; setPhase('pick');
  if (view3d) set3d(false);
  $('btn-gps').hidden = mode !== 'now';
  if (mode === 'now') locate(); else { locateSeq++; locating = false; syncNext(); setPickHelp('pick.later'); }
}

function locate() {
  const my = ++locateSeq;
  if (!navigator.geolocation) { fixState = 'fail'; setPickHelp('pick.now.unsupported'); return; }
  locating = true; fix = null; fixState = null; setPickHelp('pick.now.finding'); syncNext();
  const stale = () => my !== locateSeq || phase !== 'pick' || reportMode !== 'now';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (stale()) return;
      locating = false; syncNext();
      const { longitude: gLng, latitude: gLat, accuracy: acc } = pos.coords;
      // allow for GPS error near the boundary: a fix just outside the line is put on the closest point inside
      const p = snapInside(gLng, gLat, acc);
      if (!p) { fixState = 'outside'; setPickHelp('pick.now.outside'); return; }
      const { lng, lat } = p;
      fix = { lng, lat, acc: p.snapped ? Math.max(acc, 30) : acc }; fixState = 'ok';
      map.flyTo({ center: [lng, lat], zoom: 17.5, duration: 600 });
      if (p.snapped) setPickHelp('pick.now.edge');
      else setPickHelp(acc > LOW_ACC_M ? 'pick.now.lowacc' : 'pick.now.found', { m: Math.round(acc) });
    },
    () => { if (stale()) return; locating = false; syncNext(); fixState = 'fail'; setPickHelp('pick.now.fail'); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
  );
}
const settled = () => (map.isMoving() ? new Promise((res) => map.once('moveend', res)) : Promise.resolve());

$('btn-pick-ok').onclick = async () => {
  if (locked() || (reportMode === 'now' && locating)) return;
  await settled();
  if (phase !== 'pick') return;
  const c = map.getCenter();
  if (!inBox(c.lng, c.lat)) { setPickHelp('pick.outside'); return; }
  if (reportMode === 'now') {
    if (!fix) { setPickHelp(fixState === 'outside' ? 'pick.now.outside' : 'pick.now.fail'); return; }
    const d = metres(fix, { lat: c.lat, lng: c.lng });
    if (d > Math.max(FAR_FROM_FIX_M, fix.acc)) {             // not really "here": ask when it happened instead
      reportMode = 'later'; $('btn-gps').hidden = true; setPickHelp('pick.now.far'); return;
    }
    if (fix.acc > LOW_ACC_M && d < 15) { setPickHelp('pick.now.lowacc', { m: Math.round(fix.acc) }); return; }
  }
  chosen = { lat: c.lat, lng: c.lng };
  openForm();
};

/* ---------- form ---------- */
const parisParts = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
};
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const val = (name) => (document.querySelector(`input[name="${name}"]:checked`) || {}).value || null;
const fieldsetOf = (name) => document.querySelector(`input[name="${name}"]`).closest('fieldset');

let msgKey = null;
function setMsg(key) { msgKey = key; $('form-msg').textContent = key ? t(key) : ''; }
function renderPosNote() {
  $('pos-note').textContent = chosen ? t('form.pos', { lat: chosen.lat.toFixed(5), lng: chosen.lng.toFixed(5) }) : '';
}
function prettyDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(lang, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}
function syncDateField() {
  $('date-wrap').hidden = val('day') !== 'other';
  const v = $('when-date').value;
  $('date-pretty').textContent = /^\d{4}-\d{2}-\d{2}$/.test(v) ? '✓ ' + prettyDate(v) : '';
}
document.querySelectorAll('input[name="day"]').forEach((r) => { r.onchange = syncDateField; });
// the time field only exists when "Exact time" is the chosen answer
function syncTimeField() {
  const exact = val('tod') === 'exact';
  $('time-wrap').hidden = !exact; $('tod-hint').hidden = exact;
}
document.querySelectorAll('input[name="tod"]').forEach((r) => { r.addEventListener('change', syncTimeField); });

// exact time = three dropdowns: hour, minutes and (English only) AM/PM. French uses the 24-hour clock.
function timeVal() {
  const h = $('t-hour').value, m = $('t-min').value;
  if (h === '' || m === '') return '';
  let hh = Number(h);
  if (lang === 'en') { const p = $('t-ampm').value; if (!p) return ''; hh = (hh % 12) + (p === 'pm' ? 12 : 0); }
  return String(hh).padStart(2, '0') + ':' + m;
}
function buildTimeSelects() {
  const keep = timeVal(), en = lang === 'en', pad = (n) => String(n).padStart(2, '0');
  const opt = (v, l) => `<option value="${v}">${l}</option>`;
  const hours = en ? Array.from({ length: 12 }, (_, i) => opt(i + 1, i + 1)) : Array.from({ length: 24 }, (_, i) => opt(i, pad(i)));
  $('t-hour').innerHTML = opt('', '--') + hours.join('');
  $('t-min').innerHTML = opt('', '--') + Array.from({ length: 60 }, (_, i) => opt(pad(i), pad(i))).join('');
  $('t-ampm').innerHTML = opt('', 'AM/PM') + opt('am', 'AM') + opt('pm', 'PM');
  $('ampm-wrap').hidden = !en;
  if (keep) {
    const [hh, mm] = keep.split(':').map(Number);
    $('t-hour').value = String(en ? (hh % 12) || 12 : hh); $('t-min').value = pad(mm); $('t-ampm').value = hh >= 12 ? 'pm' : 'am';
  }
}
// picking or typing a date selects "another date" by itself, and shows the chosen day in words
['input', 'change'].forEach((ev) => $('when-date').addEventListener(ev, () => {
  if ($('when-date').value) { const o = document.querySelector('input[name="day"][value="other"]'); if (o) o.checked = true; }
  syncDateField();
}));

function openForm() {
  const later = reportMode === 'later';
  $('when-block').hidden = !later; $('now-badge').hidden = later;
  if (later) {
    const today = parisParts(new Date()).date;
    $('when-date').max = today; $('when-date').min = addDays(today, -(MAX_PAST_DAYS - 1));
  }
  if (!document.querySelector('input[name="topic"]:checked')) document.querySelector(`input[name="topic"][value="${topic}"]`).checked = true;
  renderFormTopic(false);
  syncDateField(); syncTimeField(); renderPosNote(); setPhase('form');
  const h = $('sheet-title'); h.tabIndex = -1; $('sheet-body').scrollTop = 0; h.focus({ preventScroll: true });
}
// Back: the same mode, the pin where it was, the answers kept, no new GPS request
function closeForm(backToPick) {
  if (!backToPick) { setPhase('idle'); return; }
  const mode = reportMode, keep = chosen;
  setPhase('pick'); reportMode = mode; chosen = keep;
  $('btn-gps').hidden = mode !== 'now';
  if (chosen) map.jumpTo({ center: [chosen.lng, chosen.lat] });
  if (mode === 'now') setPickHelp(fix ? (fix.acc > LOW_ACC_M ? 'pick.now.lowacc' : 'pick.now.found') : 'pick.now.fail', fix ? { m: Math.round(fix.acc) } : null);
  else setPickHelp('pick.later');
  syncNext();
}
$('btn-form-back').onclick = () => { if (!sending) closeForm(true); };
// an old error message goes away as soon as the person changes an answer
$('form').addEventListener('change', () => { if (msgKey) setMsg(null); document.querySelectorAll('fieldset.invalid').forEach((f) => f.classList.remove('invalid')); });
$('sheet').addEventListener('click', (e) => { if (locked()) { e.preventDefault(); e.stopPropagation(); } }, true);

function errorKey(m = '') {
  return /NOBACKEND/.test(m) ? 'err.nobackend' : /^AUTH$/.test(m) ? 'err.auth'
    : /outside the Vauban/i.test(m) ? 'err.outside'
    : /Too many/i.test(m) ? 'err.toomany'
    : /Not signed in|permission denied|JWT/i.test(m) ? 'err.session'
    : /in the future/i.test(m) ? 'err.future'
    : /too long ago/i.test(m) ? 'err.past'
    : /say when/i.test(m) ? 'err.when'
    : /Consent required/i.test(m) ? 'err.consent'
    : /Invalid emoji/i.test(m) ? 'val.emoji.bad'
    : /PGRST202|schema cache|Could not find the function/i.test(m) ? 'err.outdated'
    : 'err.generic';
}

function whenPayload() {
  // returns { date, tod } or { error: i18n key, field: input name }
  const day = val('day'), tod = val('tod'), time = timeVal(), today = parisParts(new Date());
  if (!day) return { error: 'val.when.day', field: 'day' };
  let date;
  if (day === 'today') date = today.date;
  else if (day === 'yesterday') date = addDays(today.date, -1);
  else {
    const input = $('when-date');
    date = input.value;
    if (input.validity.badInput) return { error: 'val.when.incomplete', field: 'day', focus: input };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'val.when.date', field: 'day', focus: input };
    if (date < addDays(today.date, -(MAX_PAST_DAYS - 1))) return { error: 'err.past', field: 'day' };
  }
  if (!tod) return { error: 'val.when.tod', field: 'tod' };
  if (tod === 'exact') {                                       // an exact time was chosen
    const input = $('t-hour');
    if (!time && ['t-hour', 't-min', 't-ampm'].some((id) => $(id).value)) return { error: 'val.time.incomplete', field: 'tod', focus: input };
    if (!/^\d{2}:\d{2}$/.test(time)) return { error: 'val.when.time', field: 'tod', focus: input };
    const [hh, mm] = time.split(':').map(Number);
    if (date > today.date || (date === today.date && (hh > today.hour || (hh === today.hour && mm > today.minute)))) return { error: 'err.future', field: 'tod', focus: input };
    return { date, time };
  }
  // a period that has already started is fine ("this morning at 06:30"); one that has not started is the future
  if (date > today.date || (date === today.date && TOD_START[tod] > today.hour)) return { error: 'err.future', field: 'tod' };
  return { date, tod };
}

function invalid(field, key, focusEl) {
  const fs = fieldsetOf(field); fs.classList.add('invalid'); setMsg(key);
  fs.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const first = focusEl || fs.querySelector('input'); if (first) first.focus({ preventScroll: true });
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sending) return;
  document.querySelectorAll('fieldset.invalid').forEach((f) => f.classList.remove('invalid'));
  setMsg(null);
  const later = reportMode === 'later';
  let w = null;
  if (later) { w = whenPayload(); if (w.error) { invalid(w.field, w.error, w.focus); return; } }
  const ft = formTopic();
  let answers, emoji = null;
  if (ft === 'crowd') {
    const count = val('count');
    if (!count) { invalid('count', 'val.count'); return; }
    answers = { count: Number(count) };
    if (val('peak')) answers.peak = val('peak');
  } else if (ft === 'obstacle') {
    const chosenEmoji = val('emoji');
    if (!chosenEmoji) { invalid('emoji', 'val.emoji'); return; }
    emoji = chosenEmoji === 'custom' ? cleanEmoji($('emoji-custom').value) : chosenEmoji;
    if (!emoji) { invalid('emoji', chosenEmoji === 'custom' && $('emoji-custom').value.trim() ? 'val.emoji.bad' : 'val.emoji', $('emoji-custom')); return; }
  } else {
    const picked = checkedVals('problem');
    if (!picked.length) { invalid('problem', 'val.problems'); return; }
    const problems = {};
    for (const c of picked) {
      const r = val('rate-' + c);
      if (!r) { invalid('rate-' + c, 'val.rate'); return; }
      problems[c] = Number(r);
    }
    answers = { problems };
    if (checkedVals('modes').length) answers.modes = checkedVals('modes');
  }
  const age = val('age');
  if (!age) { invalid('age', 'val.age'); return; }
  // GPS accuracy is only worth storing while the pin is still where the GPS put it
  const accuracy = !later && fix && metres(fix, chosen) < 15 ? Math.round(fix.acc) : null;
  const btn = $('btn-send'); sending = true; btn.disabled = true; $('btn-form-back').disabled = true; btn.textContent = t('form.sending');
  try {
    await ensureSession();
    const when = {
      p_source: later ? 'remembered' : 'here_now',
      p_occurred_date: later ? w.date : null,
      p_time_of_day: later && !w.time ? w.tod : null,
      p_accuracy_m: accuracy,
      p_consent_version: CONSENT_VERSION,
      ...(later && w.time ? { p_occurred_time: w.time } : {})   // only sent when an exact time is used
    };
    const { error } = ft === 'obstacle'
      ? await supabase.rpc('submit_obstacle', { p_lat: chosen.lat, p_lon: chosen.lng, p_age_group: age, p_emoji: emoji, ...when })
      : await supabase.rpc('submit_feedback', { p_lat: chosen.lat, p_lon: chosen.lng, p_age_group: age, p_topic: ft, p_answers: answers, p_improvement: $('improve').value || null, ...when });
    if (error) throw new Error((error.code ? error.code + ' ' : '') + error.message);
    sending = false; setPhase('idle'); toast(t('toast.thanks'));
    if (ft !== topic) setTopic(ft); else loadHotspots();      // show the map of the topic that was just reported
  } catch (err) {
    console.warn('submit_feedback failed:', err.message);
    const key = errorKey(err.message);
    if (key === 'err.session') { authReady = null; supabase && supabase.auth.signOut({ scope: 'local' }).catch(() => {}); }
    setMsg(key);
  } finally {
    sending = false; btn.disabled = false; $('btn-form-back').disabled = false; btn.textContent = t('form.send');
  }
});

/* ---------- boot ---------- */
const chat = initChat({ map, t, getLang: () => lang, $, dark: DARK });
/* the assistant is experimental: off until switched on in Settings, remembered on this phone */
$('set-chat').checked = store.get('chat') === '1';
chat.setEnabled($('set-chat').checked);
$('set-chat').onchange = () => { store.set('chat', $('set-chat').checked ? '1' : '0'); chat.setEnabled($('set-chat').checked); };
document.body.dataset.topic = topic;
applyStatic(); renderFormTopic(false); renderLegend(); renderPickHelp(); renderInfoVersion(); setCtrlLabels(); buildTimeSelects();
setPhase('idle');
loadCategories();
if (!consentOk) { $('consent').hidden = false; }
if (!configured) {
  console.warn('Supabase keys missing: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild/redeploy.');
  $('btn-report').disabled = true; $('banner').hidden = false;
}
