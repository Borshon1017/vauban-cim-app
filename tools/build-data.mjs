// Vauban data pipeline: QGIS shapefiles (../Vauban_Webdata/, outside the repo) -> small web files (public/data/*.geojson).
// Run it again whenever the shapefiles change:   npm run data
// What it does: reproject to WGS84, keep only what lies inside the Vauban-Esquermes boundary, keep the few
// attributes the map needs, simplify the tree crowns, and draw each pedestrian crossing as ONE clean line across the road.
import * as shapefile from 'shapefile';
import proj4 from 'proj4';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inVauban } from '../src/vauban.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The shapefiles (283 MB) live next to the repo, not in it; override with VAUBAN_DATA=/path/to/Vauban_Webdata
const SRC = path.resolve(process.env.VAUBAN_DATA || path.join(ROOT, '..', 'Vauban_Webdata')) + path.sep;
const OUT = path.join(ROOT, 'public', 'data') + path.sep;
fs.mkdirSync(OUT, { recursive: true });

proj4.defs('L93', '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs');
proj4.defs('UTM31', '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs');

/* ---------------- helpers ---------------- */
async function read(name) {
  const s = await shapefile.open(SRC + name + '.shp', SRC + name + '.dbf', { encoding: 'utf-8' });
  const out = [];
  for (;;) { const r = await s.read(); if (r.done) break; out.push(r.value); }
  return out;
}
const R6 = (v) => Math.round(v * 1e6) / 1e6;
const R1 = (v) => Math.round(v * 10) / 10;
const mapCoords = (c, fn) => (typeof c[0] === 'number' ? fn(c) : c.map((x) => mapCoords(x, fn)));
const toWgs = (crs) => (c) => { const [x, y] = proj4(crs, 'WGS84', [c[0], c[1]]); return [R6(x), R6(y)]; };
const firstRing = (g) => (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]);
const centroid = (g) => { const r = firstRing(g); let x = 0, y = 0; r.forEach((p) => { x += p[0]; y += p[1]; }); return [x / r.length, y / r.length]; };
const feature = (geometry, properties) => ({ type: 'Feature', geometry, properties });
const fc = (features) => ({ type: 'FeatureCollection', features });

// Douglas-Peucker in metres (longitudes are scaled by cos(latitude))
const KX = Math.cos((50.635 * Math.PI) / 180);
function simplifyRing(ring, tolM) {
  const tol = tolM / 111320;
  const P = ring.map((p) => [p[0] * KX, p[1]]);
  const keep = new Array(P.length).fill(false);
  // a ring starts and ends on the same point, so split it at the point farthest from the start first
  let far = 0, fd = -1;
  for (let i = 1; i < P.length - 1; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > fd) { fd = d; far = i; } }
  if (far === 0) return null;
  keep[0] = keep[far] = keep[P.length - 1] = true;
  const stack = [[0, far], [far, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = -1, mi = -1;
    const [x1, y1] = P[a], [x2, y2] = P[b], dx = x2 - x1, dy = y2 - y1, n = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (P[i][0] - x1) - dx * (P[i][1] - y1)) / n; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = true; stack.push([a, mi], [mi, b]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : null;
}
function simplifyPolygonGeom(g, tolM) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const res = polys.map((rings) => rings.map((r) => simplifyRing(r, tolM)).filter(Boolean)).filter((rings) => rings.length && rings[0]);
  if (!res.length) return null;
  return res.length === 1 ? { type: 'Polygon', coordinates: res[0] } : { type: 'MultiPolygon', coordinates: res };
}
const write = (name, data) => {
  const file = OUT + name + '.geojson'; fs.writeFileSync(file, JSON.stringify(data));
  const kb = fs.statSync(file).size / 1024;
  console.log(`  ${name.padEnd(14)} ${String(data.features.length).padStart(5)} features  ${kb.toFixed(0).padStart(5)} KB`);
};

console.log('Reading shapefiles from', SRC);
const stats = {};

/* ---------------- buildings (BD TOPO, with heights) ---------------- */
{
  const src = await read('Building vauban with heights'); const out = []; let fromFloors = 0, dflt = 0;
  for (const f of src) {
    const g = mapCoords(f.geometry.coordinates, toWgs('L93')); const geom = { type: f.geometry.type, coordinates: g };
    const [cx, cy] = centroid(geom); if (!inVauban(cx, cy)) continue;
    const p = f.properties; let h = p.hauteur, hs = 'bd';
    if (h == null || !(h > 0)) { if (p.nombre_d_e > 0) { h = p.nombre_d_e * 3; hs = 'floors'; fromFloors++; } else { h = 6; hs = 'default'; dflt++; } }
    h = Math.max(2.5, R1(h));                                         // sheds and walls of 0.3 m look wrong as buildings
    out.push(feature(simplifyPolygonGeom(geom, 0.15) || geom, { h, hs, u: p.usage_1 || null }));
  }
  stats.buildings = { fromFloors, default: dflt }; write('buildings', fc(out));
}

/* ---------------- trees (crown polygons, z_max = highest point of the canopy) ---------------- */
{
  const src = await read('Tress in Vauban'); const out = [];
  for (const f of src) {
    const g = mapCoords(f.geometry.coordinates, toWgs('L93')); const geom = { type: f.geometry.type, coordinates: g };
    const [cx, cy] = centroid(geom); if (!inVauban(cx, cy)) continue;
    const simple = simplifyPolygonGeom(geom, 0.35); if (!simple) continue;
    out.push(feature(simple, { z: R1(f.properties.z_max), cx: R6(cx), cy: R6(cy) }));
  }
  write('trees', fc(out));
}

/* ---------------- point layers ---------------- */
const points = async (name, outName, crs, propsFn) => {
  const src = await read(name); const out = [];
  for (const f of src) {
    const c = crs === 'WGS84' ? f.geometry.coordinates : proj4(crs, 'WGS84', f.geometry.coordinates);
    if (!inVauban(c[0], c[1])) continue;
    out.push(feature({ type: 'Point', coordinates: [R6(c[0]), R6(c[1])] }, propsFn(f.properties)));
  }
  write(outName, fc(out)); return out;
};
await points('Streetlamps_Vauban', 'lamps', 'WGS84', (p) => ({ h: p.Hauteurs || 3 }));
await points('Traffic signals_Vauban', 'signals', 'WGS84', (p) => ({ h: p.Hauteurs_m || 3.5 }));
await points('Vauban_Benches', 'benches', 'WGS84', (p) => ({ h: p.Hauteur_m || 0.9 }));
await points('Disabled Parking_Vauban', 'parking', 'L93', (p) => ({ n: p.nbr_place || 1, a: p.ban_adress || null }));
{
  const src = await read('crossroad_bus'); const out = [];                       // all of the metropole: keep only Vauban
  for (const f of src) { const { longitude: x, latitude: y, nom } = f.properties; if (inVauban(x, y)) out.push(feature({ type: 'Point', coordinates: [R6(x), R6(y)] }, { n: nom || null })); }
  write('bus', fc(out));
}

/* ---------------- crossings: ONE line per crossing, perpendicular to the road ---------------- */
{
  const lat0 = 50.635, lon0 = 3.04, mx = 111320 * KX, my = 110574;
  const toM = (c) => [(c[0] - lon0) * mx, (c[1] - lat0) * my];
  const toLL = (m) => [R6(m[0] / mx + lon0), R6(m[1] / my + lat0)];
  const roads = await read('Roads Vauban___'); const segs = [];
  const WIDTH = { primary: 11, secondary: 9, tertiary: 8, residential: 6.5, living_street: 5, unclassified: 6.5, service: 4.5, pedestrian: 4, footway: 3, cycleway: 3, path: 3, steps: 3 };
  for (const f of roads) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const w = WIDTH[f.properties.fclass] ?? 5;
    for (const l of lines) { const pts = l.map((c) => toM(proj4('UTM31', 'WGS84', c))); for (let i = 0; i < pts.length - 1; i++) segs.push({ a: pts[i], b: pts[i + 1], w, car: ['primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'service'].includes(f.properties.fclass) }); }
  }
  const nearest = (p, wantCar) => {
    let best = null, bd = 1e9;
    for (const s of segs) {
      if (wantCar && !s.car) continue;
      const vx = s.b[0] - s.a[0], vy = s.b[1] - s.a[1], L2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * vx + (p[1] - s.a[1]) * vy) / L2));
      const d = Math.hypot(p[0] - (s.a[0] + t * vx), p[1] - (s.a[1] + t * vy));
      if (d < bd) { bd = d; best = { s, vx, vy }; }
    }
    return best ? { ...best, d: bd } : null;
  };
  const src = await read('crossings in vauban'); const out = []; let skipped = 0, unmarked = 0;
  for (const f of src) {
    const c = f.geometry.coordinates; if (!inVauban(c[0], c[1])) continue;
    const kind = f.properties.crossing || 'marked'; if (kind === 'unmarked') { unmarked++; continue; }
    const p = toM(c), n = nearest(p, true);
    if (!n || n.d > 12) { skipped++; continue; }                                  // no street close enough to know which way it runs
    const L = Math.hypot(n.vx, n.vy) || 1, ux = -n.vy / L, uy = n.vx / L;         // unit vector perpendicular to the road
    const half = Math.min(8, Math.max(2, n.s.w / 2));
    out.push(feature({ type: 'LineString', coordinates: [toLL([p[0] - ux * half, p[1] - uy * half]), toLL([p[0] + ux * half, p[1] + uy * half])] }, { k: kind === 'traffic_signals' ? 's' : kind === 'uncontrolled' ? 'u' : 'm' }));
  }
  stats.crossings = { skippedNoRoad: skipped, unmarked }; write('crossings', fc(out));
}

console.log('Notes:', JSON.stringify(stats));
