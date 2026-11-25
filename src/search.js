// Place / address search with the free Photon geocoder (OpenStreetMap data, no key).
// A debounced query, a short result list, a tap flies the map there and drops a temporary pin.
import maplibregl from 'maplibre-gl';

const API = 'https://photon.komoot.io/api/';
const MIN_CHARS = 3, DEBOUNCE_MS = 350, FLY_ZOOM = 17.5;

export function initSearch({ map, t, getLang, bounds, maxZoom }) {
  const $ = (id) => document.getElementById(id);
  const box = $('search'), input = $('search-input'), list = $('search-list'), clear = $('search-clear'), note = $('search-note');
  const inside = ([x, y]) => x >= bounds[0][0] && x <= bounds[1][0] && y >= bounds[0][1] && y <= bounds[1][1];
  let timer = 0, ctl = null, items = [], active = -1, marker = null;

  const line = (p) => {                                    // second line: street + number, then the city
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    return [p.name && street, p.district, [p.postcode, p.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  };
  const title = (p) => p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || '';

  function setNote(key) { note.textContent = key ? t(key) : ''; note.hidden = !key; }
  function close() { list.hidden = true; list.innerHTML = ''; items = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function reset() {
    clearTimeout(timer); if (ctl) ctl.abort();
    input.value = ''; clear.hidden = true; setNote(null); close();
    if (marker) { marker.remove(); marker = null; }
  }
  function setActive(i) {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) { input.setAttribute('aria-activedescendant', 'search-opt-' + i); list.children[i].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
  function render() {
    list.innerHTML = '';
    items.forEach((f, i) => {
      const li = document.createElement('li');
      li.id = 'search-opt-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
      const b = document.createElement('b'); b.textContent = title(f.properties);
      const s = document.createElement('span'); s.textContent = line(f.properties);
      li.append(b, s);
      li.addEventListener('mousedown', (e) => e.preventDefault());   // keep the focus in the field
      li.addEventListener('click', () => pick(i));
      list.appendChild(li);
    });
    list.hidden = !items.length; input.setAttribute('aria-expanded', String(Boolean(items.length)));
  }
  function pick(i) {
    const f = items[i]; if (!f) return;
    const [lng, lat] = f.geometry.coordinates;
    input.value = title(f.properties); close(); input.blur();
    if (marker) marker.remove();
    const el = document.createElement('div'); el.className = 'search-pin'; el.setAttribute('aria-hidden', 'true');
    marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map);
    map.flyTo({ center: [lng, lat], zoom: Math.min(FLY_ZOOM, maxZoom), duration: 700 });
  }

  async function run(q) {
    if (ctl) ctl.abort();
    ctl = new AbortController();
    const url = `${API}?q=${encodeURIComponent(q)}&limit=6&lang=${getLang() === 'en' ? 'en' : 'fr'}&lat=50.637&lon=3.045&bbox=${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`;
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      items = (data.features || []).filter((f) => f.geometry && f.geometry.type === 'Point' && inside(f.geometry.coordinates)).slice(0, 5);
      setNote(items.length ? null : 'search.none'); render(); setActive(-1);
    } catch (e) {
      if (e.name === 'AbortError') return;                  // a newer query replaced this one
      items = []; render(); setNote('search.err');
    }
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clear.hidden = !input.value; clearTimeout(timer);
    if (q.length < MIN_CHARS) { if (ctl) ctl.abort(); close(); setNote(null); return; }
    timer = setTimeout(() => run(q), DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); reset(); }
    else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setActive((active + 1) % items.length); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items.length) pick(active >= 0 ? active : 0); }
  });
  clear.addEventListener('click', () => { reset(); input.focus(); });
  document.addEventListener('pointerdown', (e) => { if (!box.contains(e.target)) { close(); setNote(null); } });
  return { reset };
}
