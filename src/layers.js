// Vauban digital-twin layers: the QGIS data (public/data/*.geojson, built by `npm run data`).
// Flat 2D by default. The 3D view (Settings) uses the team's design rules:
//   buildings extruded by `hauteur`, trees by maximum canopy height, slender "lollipop" street lamps from `Hauteurs`,
//   and clean single-line pedestrian crossings that only appear when zoomed in to street level.
const ATTRIBUTION = 'Vauban dataset: IGN BD TOPO · OpenStreetMap contributors · MEL';
const BEFORE = 'outside-mask';                       // our layers sit under the mask, the report circles sit above it

export const LAYER_KEYS = ['buildings', 'trees', 'lamps', 'signals', 'benches', 'crossings', 'parking', 'bus', 'basepoi'];
export const LAYER_DEFAULTS = { buildings: true, trees: true, lamps: true, signals: true, benches: true, crossings: true, parking: true, bus: true, basepoi: true };

// ---- small shapes made in the browser (a pole is a thin circle, a lamp head is a wider one on top)
function disc(lng, lat, r, n = 10) {
  const dLat = r / 111320, dLng = r / (111320 * Math.cos((lat * Math.PI) / 180)), ring = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; ring.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]); }
  ring.push(ring[0]); return [ring];
}
function box(lng, lat, w, d) {
  const dLat = d / 2 / 111320, dLng = w / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return [[[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]]];
}
const shape = (coords, base, top, extra) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: coords }, properties: { b: base, t: top, ...extra } });
const FC = (features) => ({ type: 'FeatureCollection', features });

export const TUNING = {                              // sizes in metres: change here to restyle the 3D view
  lampPole: 0.12, lampHead: 0.38, lampHeadHeight: 0.45,
  signalPole: 0.1, signalHead: 0.3, signalHeadHeight: 0.9,
  trunk: 0.3, crownBase: 0.4,                        // the crown starts at 40 % of the tree height
  bench: 0.8
};

function lamps3d(fc) {
  const out = [];
  for (const f of fc.features) {
    const [x, y] = f.geometry.coordinates, h = f.properties.h || 3;
    out.push(shape(disc(x, y, TUNING.lampPole, 8), 0, h, { c: 'pole' }));                                        // slender pole
    out.push(shape(disc(x, y, TUNING.lampHead, 10), h, h + TUNING.lampHeadHeight, { c: 'lamp' }));              // round head: the lollipop
  }
  return FC(out);
}
function signals3d(fc) {
  const out = [];
  for (const f of fc.features) {
    const [x, y] = f.geometry.coordinates, h = f.properties.h || 3.5;
    out.push(shape(disc(x, y, TUNING.signalPole, 8), 0, h, { c: 'pole' }));
    out.push(shape(box(x, y, TUNING.signalHead * 2, TUNING.signalHead * 1.4), h - TUNING.signalHeadHeight, h, { c: 'signal' }));
  }
  return FC(out);
}
function benches3d(fc) {
  return FC(fc.features.map((f) => { const [x, y] = f.geometry.coordinates; return shape(box(x, y, TUNING.bench, TUNING.bench * 0.6), 0, f.properties.h || 0.9, { c: 'bench' }); }));
}
function trunks3d(fc) {
  const out = [];
  for (const f of fc.features) { const { z, cx, cy } = f.properties; if (z > 3) out.push(shape(disc(cx, cy, TUNING.trunk, 6), 0, z * TUNING.crownBase, {})); }
  return FC(out);
}

// ---- map symbols: a rounded square (never a circle: circles are the report areas) with a pictogram inside
const ICONS = { lamps: ['💡', '#f2a900'], signals: ['🚦', '#d6382e'], benches: ['🪑', '#8a6f4d'], parking: ['♿', '#2d5bff'], bus: ['🚌', '#0d8585'] };
function badge(emoji, color, dark) {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const r = 15, x = 4, y = 4, w = S - 8, h = S - 8;
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 4; g.shadowOffsetY = 1; g.fillStyle = dark ? '#1b2430' : '#ffffff'; g.fill();
  g.shadowColor = 'transparent'; g.lineWidth = 5; g.strokeStyle = color; g.stroke();
  g.font = '32px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
  g.fillText(emoji, S / 2, S / 2 + 3);
  return g.getImageData(0, 0, S, S);
}

async function load(name) {
  try { const r = await fetch(`/data/${name}.geojson`); if (!r.ok) throw new Error(r.status); return await r.json(); }
  catch (e) { console.warn('layer not loaded:', name, e.message); return null; }
}

// ---- add everything to the map. Returns controls for the Settings screen.
export async function addVaubanLayers(map, dark = false) {
  const C = dark
    ? { bldg: '#3a4452', bldgLine: '#566274', bldg3d: '#4d586a', tree: '#3f8a5a', tree3d: '#3f8a5a', casing: '#10161d', cross: '#f1f5f9', crossSig: '#6fb4ff', crossUnc: '#9aa7b4', pole: '#8b96a3' }
    : { bldg: '#d3dae2', bldgLine: '#aab5c2', bldg3d: '#dfe4ea', tree: '#6fb37a', tree3d: '#5aa46b', casing: '#ffffff', cross: '#0e1b2a', crossSig: '#0b6bcb', crossUnc: '#5b6773', pole: '#4b5560' };
  const data = Object.fromEntries(await Promise.all(['buildings', 'trees', 'lamps', 'signals', 'benches', 'crossings', 'parking', 'bus'].map(async (n) => [n, await load(n)])));
  const src = (id, d) => { if (d) map.addSource(id, { type: 'geojson', data: d, attribution: ATTRIBUTION }); return Boolean(d); };
  const add = (layer) => map.addLayer(layer, BEFORE);

  // the base style draws its own (relief) buildings: hide them, ours come from the BD TOPO data
  if (src('buildings', data.buildings)) {
    ['building', 'building-3d'].forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });   // only hidden once ours are there
    add({ id: 'bldg-flat', type: 'fill', source: 'buildings', paint: { 'fill-color': C.bldg, 'fill-outline-color': C.bldgLine } });
    add({ id: 'bldg-3d', type: 'fill-extrusion', source: 'buildings', layout: { visibility: 'none' },
      paint: { 'fill-extrusion-color': C.bldg3d, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.94, 'fill-extrusion-vertical-gradient': true } });
  }
  if (src('trees', data.trees)) {
    src('trunks', trunks3d(data.trees));
    add({ id: 'trees-flat', type: 'fill', source: 'trees', minzoom: 15, paint: { 'fill-color': C.tree, 'fill-opacity': dark ? 0.6 : 0.5 } });
    add({ id: 'trees-3d', type: 'fill-extrusion', source: 'trees', minzoom: 15, layout: { visibility: 'none' },
      paint: { 'fill-extrusion-color': C.tree3d, 'fill-extrusion-height': ['get', 'z'], 'fill-extrusion-base': ['*', ['get', 'z'], TUNING.crownBase], 'fill-extrusion-opacity': 0.92 } });
    add({ id: 'trunks-3d', type: 'fill-extrusion', source: 'trunks', minzoom: 16, layout: { visibility: 'none' },
      paint: { 'fill-extrusion-color': '#7a5a3c', 'fill-extrusion-height': ['get', 't'], 'fill-extrusion-base': 0 } });
  }
  if (src('crossings', data.crossings)) {                                   // one clean line per crossing, street level only
    add({ id: 'cross-casing', type: 'line', source: 'crossings', minzoom: 17, layout: { 'line-cap': 'butt' }, paint: { 'line-color': C.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 17, 4, 20, 9], 'line-opacity': 0.9 } });
    add({ id: 'cross-line', type: 'line', source: 'crossings', minzoom: 17, layout: { 'line-cap': 'butt' },
      paint: { 'line-color': ['match', ['get', 'k'], 's', C.crossSig, 'u', C.crossUnc, C.cross], 'line-width': ['interpolate', ['linear'], ['zoom'], 17, 2, 20, 5], 'line-opacity': 1 } });
  }
  Object.entries(ICONS).forEach(([k, [emoji, color]]) => { if (!map.hasImage('ic-' + k)) map.addImage('ic-' + k, badge(emoji, color, dark), { pixelRatio: 2 }); });
  const icons = (id, d, minzoom) => { if (src(id, d)) add({ id: id + '-dot', type: 'symbol', source: id, minzoom,
    layout: { 'icon-image': 'ic-' + id, 'icon-size': ['interpolate', ['linear'], ['zoom'], minzoom, 0.62, 19, 0.9, 21, 1.1], 'icon-allow-overlap': true, 'icon-ignore-placement': true } }); };
  icons('lamps', data.lamps, 17);
  icons('signals', data.signals, 17);
  icons('benches', data.benches, 17.5);
  icons('parking', data.parking, 16.5);
  icons('bus', data.bus, 16);
  if (src('lamps3d', data.lamps && lamps3d(data.lamps))) add({ id: 'lamps-3d', type: 'fill-extrusion', source: 'lamps3d', minzoom: 16.5, layout: { visibility: 'none' },
    paint: { 'fill-extrusion-color': ['match', ['get', 'c'], 'lamp', '#f2b01e', C.pole], 'fill-extrusion-height': ['get', 't'], 'fill-extrusion-base': ['get', 'b'] } });
  if (src('signals3d', data.signals && signals3d(data.signals))) add({ id: 'signals-3d', type: 'fill-extrusion', source: 'signals3d', minzoom: 16.5, layout: { visibility: 'none' },
    paint: { 'fill-extrusion-color': ['match', ['get', 'c'], 'signal', '#2b2f36', C.pole], 'fill-extrusion-height': ['get', 't'], 'fill-extrusion-base': ['get', 'b'] } });
  if (src('benches3d', data.benches && benches3d(data.benches))) add({ id: 'benches-3d', type: 'fill-extrusion', source: 'benches3d', minzoom: 17, layout: { visibility: 'none' },
    paint: { 'fill-extrusion-color': '#9b7b52', 'fill-extrusion-height': ['get', 't'], 'fill-extrusion-base': 0 } });

  // which map layers belong to which switch, in flat 2D and in 3D
  const MAP = {
    buildings: { flat: ['bldg-flat'], d3: ['bldg-3d'] },
    trees:     { flat: ['trees-flat'], d3: ['trees-3d', 'trunks-3d'] },
    lamps:     { flat: ['lamps-dot'], d3: ['lamps-3d'] },
    signals:   { flat: ['signals-dot'], d3: ['signals-3d'] },
    benches:   { flat: ['benches-dot'], d3: ['benches-3d'] },
    crossings: { flat: ['cross-casing', 'cross-line'], d3: ['cross-casing', 'cross-line'] },
    parking:   { flat: ['parking-dot'], d3: ['parking-dot'] },
    bus:       { flat: ['bus-dot'], d3: ['bus-dot'] },
    // the base map's own icons (shops, schools, playgrounds, transit); not our data
    basepoi:   { flat: ['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit'], d3: ['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit'] }
  };
  const all = new Set(Object.values(MAP).flatMap((m) => [...m.flat, ...m.d3]));
  return {
    // call whenever the 3D switch or a layer switch changes
    apply(on, view3d) {
      const show = new Set();
      for (const k of LAYER_KEYS) if (on[k]) (view3d ? MAP[k].d3 : MAP[k].flat).forEach((id) => show.add(id));
      all.forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show.has(id) ? 'visible' : 'none'); });
    }
  };
}
