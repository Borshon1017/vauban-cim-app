// "Ask the map": a chat panel that talks to the agent (agent/ folder) and highlights the places it mentions.
// The agent only reads public data (the same squares and approved comments as the map), so it can sit in the menu.
// The conversation stays in memory: nothing is stored in the browser or sent anywhere else.

const AGENT_URL = (import.meta.env.VITE_AGENT_URL || '').replace(/\/$/, '');
const MAX_LEN = 500;
const SUGGESTIONS = ['chat.s1', 'chat.s2', 'chat.s3'];

const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The model answers in short plain text with "- " bullets and the odd **bold**: turn that into safe HTML.
function format(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const item = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)/);
    if (item) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${item[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (line) html += `<p>${line}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

export function initChat({ map, t, getLang, $, dark }) {
  const btn = $('btn-chat'), panel = $('chat'), log = $('chat-log'), form = $('chat-form'), input = $('chat-in'), sugg = $('chat-sugg');
  btn.hidden = true;                                         // shown by setEnabled() once switched on in Settings

  const history = [];            // {role: 'user' | 'assistant', content}
  let busy = false;

  /* ---------- map highlights ---------- */
  const empty = { type: 'FeatureCollection', features: [] };
  function ensureLayer() {
    if (map.getSource('agent-hl')) return;
    map.addSource('agent-hl', { type: 'geojson', data: empty });
    map.addLayer({ id: 'agent-hl-ring', type: 'circle', source: 'agent-hl',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 9, 17, 22], 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 3, 'circle-stroke-color': dark ? '#ffffff' : '#111214' } });
    map.addLayer({ id: 'agent-hl-dot', type: 'circle', source: 'agent-hl',
      paint: { 'circle-radius': 3.5, 'circle-color': dark ? '#ffffff' : '#111214' } });
  }
  function highlight(fc) {
    // right after a 3D switch or a fly-to the map is still loading: wait for it to settle, then draw
    if (!map.isStyleLoaded()) { map.once('idle', () => highlight(fc)); return; }
    ensureLayer();
    map.getSource('agent-hl').setData(fc && fc.features ? fc : empty);
    const pts = (fc && fc.features || []).map((f) => f.geometry.coordinates);
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const wide = window.matchMedia('(min-width:800px)').matches;
    const pad = wide ? { top: 120, bottom: 80, left: 60, right: panel.offsetWidth + 60 }
                     : { top: 110, bottom: panel.offsetHeight + 40, left: 40, right: 40 };
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: pad, maxZoom: 17, duration: 600 });
  }

  /* ---------- rendering ---------- */
  function bubble(role, html, extra = '') {
    const div = document.createElement('div');
    div.className = `msg ${role} ${extra}`.trim();
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
  function renderSuggestions() {
    sugg.hidden = history.length > 0;
    sugg.innerHTML = SUGGESTIONS.map((k) => `<button type="button" class="chip" data-q="${esc(t(k))}">${esc(t(k))}</button>`).join('');
  }
  function render() {                              // after a language change
    renderSuggestions();
    if (!history.length) { log.innerHTML = ''; bubble('assistant', `<p>${esc(t('chat.hello'))}</p>`, 'intro'); }
  }

  /* ---------- talking to the agent ---------- */
  async function send(text) {
    text = text.trim().slice(0, MAX_LEN);
    if (!text || busy) return;
    busy = true; form.querySelector('button').disabled = true;
    log.querySelector('.intro')?.remove();
    bubble('user', `<p>${esc(text)}</p>`);
    const past = history.slice(-6);
    history.push({ role: 'user', content: text });
    renderSuggestions();
    if (!AGENT_URL) {                              // switched on in Settings, but this build has no agent address
      bubble('assistant', `<p>${esc(t('chat.offline'))}</p>`, 'error');
      history.pop(); busy = false; form.querySelector('button').disabled = false;
      return;
    }
    const wait = bubble('assistant', `<p>${esc(t('chat.thinking'))}</p>`, 'thinking');
    try {
      const r = await fetch(`${AGENT_URL}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: past, lang: getLang() })
      });
      const body = await r.json().catch(() => ({}));
      wait.remove();
      if (!r.ok) {
        bubble('assistant', `<p>${esc(typeof body.detail === 'string' ? body.detail : t('chat.error'))}</p>`, 'error');
        history.pop();
        return;
      }
      history.push({ role: 'assistant', content: body.answer });
      bubble('assistant', format(body.answer));
      highlight(body.highlights);
    } catch {
      wait.remove();
      bubble('assistant', `<p>${esc(t('chat.error'))}</p>`, 'error');
      history.pop();
    } finally {
      busy = false; form.querySelector('button').disabled = false;
      input.focus({ preventScroll: true });
    }
  }

  /* ---------- open / close ---------- */
  function open() {
    panel.hidden = false; btn.setAttribute('aria-pressed', 'true');
    document.body.classList.add('chat-open');
    if (!log.children.length) render();
    input.focus({ preventScroll: true });
  }
  function close() {
    if (panel.hidden) return;
    panel.hidden = true; btn.setAttribute('aria-pressed', 'false');
    document.body.classList.remove('chat-open');
    if (map.getSource('agent-hl')) map.getSource('agent-hl').setData(empty);
    btn.focus({ preventScroll: true });
  }

  btn.onclick = () => (panel.hidden ? open() : close());
  $('chat-close').onclick = close;
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(v); });
  sugg.addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) send(b.dataset.q); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  function setEnabled(on) { btn.hidden = !on; if (!on) close(); }

  return { render, close, setEnabled };
}
