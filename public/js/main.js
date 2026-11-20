import { t, setLang, getLang } from './i18n.js';
import { renderField, riskColor, waveColor, RISK_STOPS, WAVE_STOPS } from './field.js';
import { WindFlow } from './wind.js';
import { esc, placeHTML, routeFormHTML, routeResultsHTML, alertsHTML, fmtT, RP_ICON } from './panels.js';
import * as hydro from './hydro.js';
import * as trails from './trails.js';
import * as reports from './reports.js';
import * as offline from './offline.js';
import * as push from './push.js';
import * as nav from './nav.js';

const L = window.L;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ------------------------------------------------------------------ state */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('tv.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tv.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const S = {
  mode: LS.get('mode', 'general'),
  lang: LS.get('lang', 'fil'),
  layers: { radar: true, sat: false, wind: false, wave: false, risk: true, zones: false, storms: true, alerts: true, hydro: true, trails: false, reports: true, floodmap: false, ...LS.get('layers', {}) },
  riskKind: LS.get('riskKind', 'overall'),
  theme: LS.get('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  base: LS.get('base', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  tab: 'place', place: null, placeLL: null,
  route: { from: null, to: null, speed: 8, pick: null, res: null, sel: 0 },
  grid: null, alerts: { alerts: [] }, storms: { storms: [] },
};
const LV_COLOR = ['#22c55e', '#facc15', '#fb923c', '#ef4444'];

const handlers = {}; // click handlers registered by the feature modules (data-act="...")
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (r.headers.get('x-terravue-stale')) offline.markStale(+r.headers.get('x-terravue-saved') || 0);
  else if (navigator.onLine) $('#netbar').hidden = true;
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
let toastTimer;
function toast(msg, ms = 3500) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function hint(msg) {
  const el = $('#maphint');
  el.hidden = !msg;
  el.textContent = msg || '';
}
function setDemo(flag) {
  const b = $('#banner');
  b.hidden = !flag;
  if (flag) b.textContent = t('demoBanner');
}

/* -------------------------------------------------------------------- map */
const BASES = {
  dark: ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap © CARTO' }],
  light: ['https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap © CARTO' }],
  sat: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Tiles © Esri' }],
};
const view = LS.get('view', { c: [12.6, 122.4], z: 6 });
const map = L.map('map', { zoomControl: false, minZoom: 5, maxZoom: 17, maxBounds: [[-2, 108], [30, 138]], maxBoundsViscosity: 0.6 }).setView(view.c, view.z);
L.control.zoom({ position: 'bottomright' }).addTo(map);
map.attributionControl.setPrefix(false);
[['field', 310, 'none'], ['radar', 320, 'none'], ['zones', 330, 'auto']].forEach(([n, z, pe]) => {
  const p = map.createPane(n);
  p.style.zIndex = z;
  p.style.pointerEvents = pe;
});
let baseLayer;
function setBase(k) {
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(...BASES[k]).addTo(map);
  document.body.dataset.base = k;
}

function setTheme(th, { keepBase = false } = {}) {
  S.theme = th === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = S.theme;
  $('#btnTheme').textContent = S.theme === 'light' ? '☾' : '☀';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', S.theme === 'light' ? '#f1f5fb' : '#060b16');
  if (!keepBase && S.base !== 'sat' && S.base !== S.theme) { S.base = S.theme; setBase(S.base); renderLayers(); }
  LS.set('theme', S.theme); LS.set('base', S.base);
}

/* ------------------------------------------------- official flood susceptibility */
// MGB / GeoRiskPH "Flood" map service (ArcGIS dynamic map): one image per tile, requested straight from the user's browser.
const FLOOD_EXPORT = 'https://ulap-hazards.georisk.gov.ph/arcgis/rest/services/MGBPublic/Flood/MapServer/export';
const FloodTiles = L.TileLayer.extend({
  getTileUrl(c) {
    const z = this._getZoomForUrl(), n = 20037508.342789244, span = (2 * n) / 2 ** z;
    const x0 = -n + c.x * span, y1 = n - c.y * span;
    return `${FLOOD_EXPORT}?bbox=${x0},${y1 - span},${x0 + span},${y1}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`;
  },
});
const floodLayer = new FloodTiles('', { pane: 'field', opacity: 0.6, maxZoom: 17, errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', attribution: 'Flood susceptibility © MGB / GeoRiskPH' });
function syncFlood() {
  S.layers.floodmap ? floodLayer.addTo(map) : map.hasLayer(floodLayer) && map.removeLayer(floodLayer);
}

/* ------------------------------------------------------------------ radar */
const radar = { frames: [], layers: [], idx: 0, host: '', sat: null, timer: null, playing: false, failed: false };

async function loadRadar() {
  try {
    const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
    const past = j.radar?.past || [];
    const nc = j.radar?.nowcast || [];
    radar.host = j.host;
    radar.frames = [...past.map((f) => ({ ...f, nc: false })), ...nc.map((f) => ({ ...f, nc: true }))];
    radar.idx = Math.max(0, past.length - 1);
    radar.layers = radar.frames.map((f) =>
      L.tileLayer(`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { pane: 'radar', opacity: 0, maxNativeZoom: 7, maxZoom: 17, attribution: 'Radar © RainViewer' }));
    const sp = j.satellite?.infrared?.slice(-1)[0]?.path;
    if (sp) radar.sat = L.tileLayer(`${radar.host}${sp}/256/{z}/{x}/{y}/0/0_0.png`, { pane: 'radar', opacity: 0.6, maxNativeZoom: 7, maxZoom: 17, attribution: 'Satellite © RainViewer' });
    const r = $('#tlRange');
    r.max = Math.max(0, radar.frames.length - 1);
    syncRadar();
  } catch {
    radar.failed = true;
    toast(t('radarFail'));
    $('#timeline').hidden = true;
  }
}
function syncRadar() {
  const on = S.layers.radar && !radar.failed && radar.frames.length;
  radar.layers.forEach((l) => (on ? l.addTo(map) : map.hasLayer(l) && map.removeLayer(l)));
  if (radar.sat) (S.layers.sat ? radar.sat.addTo(map) : map.hasLayer(radar.sat) && map.removeLayer(radar.sat));
  $('#timeline').hidden = !on;
  if (on) showFrame(radar.idx);
  else stopPlay();
}
function showFrame(i) {
  radar.idx = i;
  radar.layers.forEach((l, k) => l.setOpacity(k === i ? 0.78 : 0));
  const f = radar.frames[i];
  $('#tlRange').value = i;
  $('#tlLabel').innerHTML = `${esc(fmtT(f.time))} <em class="${f.nc ? 'nc' : 'live'}">${esc(f.nc ? t('nowcast') : t('live'))}</em>`;
}
function stopPlay() {
  clearTimeout(radar.timer);
  radar.playing = false;
  $('#tlPlay').textContent = '▶';
}
function play() {
  if (radar.playing) return stopPlay();
  radar.playing = true;
  $('#tlPlay').textContent = '❚❚';
  const tick = () => {
    if (!radar.playing) return;
    const next = (radar.idx + 1) % radar.frames.length;
    showFrame(next);
    radar.timer = setTimeout(tick, next === radar.frames.length - 1 ? 1600 : 600);
  };
  radar.timer = setTimeout(tick, 400);
}

/* ----------------------------------------------------- grid (wind/wave/risk) */
const wind = new WindFlow(map);
const fieldOv = {};
let gridCtl, gridTimer;
const wantGrid = () => S.layers.wind || S.layers.wave || S.layers.risk;
const needMarine = () => S.layers.wave || (S.layers.risk && (S.riskKind === 'sea' || (S.mode === 'fisher' && S.riskKind === 'overall')));

function scheduleGrid(d = 450) {
  clearTimeout(gridTimer);
  gridTimer = setTimeout(refreshGrid, d);
}
async function refreshGrid() {
  if (!wantGrid()) return applyGrid();
  const b = map.getBounds();
  const s = Math.max(3.01, b.getSouth()), n = Math.min(22.99, b.getNorth());
  const w = Math.max(114.01, b.getWest()), e = Math.min(131.99, b.getEast());
  if (!(n > s && e > w)) return;
  gridCtl?.abort();
  gridCtl = new AbortController();
  const qs = new URLSearchParams({ s: s.toFixed(2), n: n.toFixed(2), w: w.toFixed(2), e: e.toFixed(2), mode: S.mode, m: needMarine() ? 1 : 0 });
  try {
    S.grid = await api('/api/grid?' + qs, { signal: gridCtl.signal });
    setDemo(S.grid.demo);
    applyGrid();
  } catch (err) {
    if (err.name !== 'AbortError') toast(t('error'));
  }
}
function setField(key, on, vals, colorFn, opacity) {
  if (!on || !S.grid) {
    if (fieldOv[key]) { map.removeLayer(fieldOv[key]); delete fieldOv[key]; }
    return;
  }
  const { url, bounds } = renderField(S.grid, vals, colorFn);
  if (!fieldOv[key]) fieldOv[key] = L.imageOverlay(url, bounds, { pane: 'field', opacity, interactive: false, className: 'field-img' }).addTo(map);
  else { fieldOv[key].setUrl(url); fieldOv[key].setBounds(bounds); }
}
function applyGrid() {
  const f = S.grid?.fields;
  const kinds = f && { overall: f.risk, flood: f.flood, wind: f.windRisk, sea: f.waveRisk };
  setField('risk', S.layers.risk, kinds?.[S.riskKind], riskColor, 0.8);
  setField('wave', S.layers.wave, f?.wave, waveColor, 0.85);
  wind.enable(!!S.layers.wind && !!S.grid);
  if (S.layers.wind && S.grid) wind.setGrid(S.grid);
}

/* ------------------------------------------------------- zones/alerts/storms */
const zonesLayer = L.layerGroup();
let zonesLoaded = false;
async function syncZones() {
  if (S.layers.zones && !zonesLoaded) {
    zonesLoaded = true;
    try {
      const { zones } = await api('/api/zones');
      zones.forEach((z) => {
        const c = z.type === 'flood' ? '#38bdf8' : '#f59e0b';
        L.circle([z.lat, z.lon], { radius: z.r * 1000, pane: 'zones', color: c, weight: 1.5, dashArray: '6 6', fillColor: c, fillOpacity: 0.1 })
          .bindTooltip(`${esc(z.n)} · ${z.type === 'flood' ? '🌊' : '⛰'}`, { sticky: true }).addTo(zonesLayer);
      });
    } catch { zonesLoaded = false; }
  }
  S.layers.zones ? zonesLayer.addTo(map) : map.removeLayer(zonesLayer);
}

const alertLayer = L.layerGroup();
const stormLayer = L.layerGroup();
async function loadAlerts() {
  try {
    const [a, s] = await Promise.all([api('/api/alerts'), api('/api/storms')]);
    S.alerts = a;
    S.storms = s;
    if (a.demo) setDemo(true);
    alertLayer.clearLayers();
    a.alerts.forEach((x, i) => {
      L.marker([x.lat, x.lon], { icon: L.divIcon({ className: `amark lv${x.level}`, html: '<i></i>', iconSize: [20, 20] }), keyboard: false })
        .bindTooltip(`${esc(x.name)} · ${x.score}`).on('click', () => gotoAlert(i)).addTo(alertLayer);
    });
    stormLayer.clearLayers();
    s.storms.forEach((x) => {
      const m = L.marker([x.lat, x.lon], { icon: L.divIcon({ className: 'smark', html: '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 3c5 0 8 3 7 6-1-2-4-3-7-2M12 21c-5 0-8-3-7-6 1 2 4 3 7 2M3 12c0-5 3-8 6-7-2 1-3 4-2 7M21 12c0 5-3 8-6 7 2-1 3-4 2-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', iconSize: [30, 30] }) });
      m.bindPopup(`<b>${esc(x.name)}</b><br>${esc(x.level)} · ${esc(x.severity)}${x.url && /^https:\/\//.test(x.url) ? `<br><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">GDACS</a>` : ''}`);
      m.addTo(stormLayer);
    });
    renderAlerts();
  } catch { /* alerts are best-effort */ }
}
function syncAlertLayers() {
  S.layers.alerts ? alertLayer.addTo(map) : map.removeLayer(alertLayer);
  S.layers.storms ? stormLayer.addTo(map) : map.removeLayer(stormLayer);
}
function renderAlerts() {
  $('#tab-alerts').innerHTML = alertsHTML(S.alerts, S.storms, { top: push.html(), mid: hydro.html() });
  const n = S.alerts.alerts.filter((a) => a.level >= 2).length + hydro.urgent();
  $$('.abadge').forEach((b) => { b.textContent = n; b.hidden = !n; });
}
function gotoAlert(i) {
  const a = S.alerts.alerts[i];
  if (a) pickPlace(a.lat, a.lon, { fly: true });
}

/* ------------------------------------------------------------------- place */
let pin, placeSeq = 0;
const pinIcon = L.divIcon({ className: 'pin', html: '<i></i>', iconSize: [26, 26], iconAnchor: [13, 24] });
const loadingHTML = () => `<div class="skeleton"><i></i><i></i><i></i></div><p class="muted">${esc(t('loading'))}</p>`;

async function pickPlace(lat, lon, { fly = false, keepTab = false } = {}) {
  S.placeLL = { lat, lon };
  if (pin) pin.setLatLng([lat, lon]); else pin = L.marker([lat, lon], { icon: pinIcon, keyboard: false }).addTo(map);
  if (!keepTab) openTab('place');
  $('#tab-place').innerHTML = loadingHTML();
  if (fly) map.flyTo([lat, lon], Math.max(map.getZoom(), 9), { duration: 0.8 });
  const seq = ++placeSeq;
  try {
    const d = await api(`/api/point?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&mode=${S.mode}`);
    if (seq !== placeSeq) return;
    S.place = d;
    setDemo(d.demo);
    renderPlace();
  } catch (err) {
    if (seq === placeSeq) $('#tab-place').innerHTML = `<p class="note warn">${esc(err.message || t('error'))}</p><button class="btn" data-act="retry">${esc(t('retry'))}</button>`;
  }
}
function renderPlace() {
  $('#tab-place').innerHTML = S.place ? placeHTML(S.place, S.mode) : `<p class="hint">${esc(t('pickHint'))}</p>`;
}

/* ------------------------------------------------------------------- route */
const routeLayer = L.layerGroup().addTo(map);
const markers = {};
const R = S.route;
const abIcon = (l) => L.divIcon({ className: 'abm', html: l, iconSize: [26, 26], iconAnchor: [13, 13] });

function setRoutePoint(k, lat, lon, name) {
  R[k] = { lat, lon, name };
  if (markers[k]) markers[k].setLatLng([lat, lon]);
  else markers[k] = L.marker([lat, lon], { icon: abIcon(k === 'from' ? 'A' : 'B'), keyboard: false }).addTo(map);
  const inp = $('#rf-' + k);
  if (inp) inp.value = name;
  clearRoute();
}
function clearRoute() {
  R.res = null;
  routeLayer.clearLayers();
  $('#route-results').innerHTML = '';
}
function renderRoute() {
  $('#route-form').innerHTML = routeFormHTML(R, S.mode);
  bindSuggest($('#rf-from'), $('#sg-from'), (r) => setRoutePoint('from', r.lat, r.lon, r.name));
  bindSuggest($('#rf-to'), $('#sg-to'), (r) => setRoutePoint('to', r.lat, r.lon, r.name));
  const sp = $('#rf-speed');
  if (sp) sp.onchange = () => (R.speed = Math.min(40, Math.max(2, +sp.value || 8)));
  if (R.res) $('#route-results').innerHTML = routeResultsHTML(R.res, R.sel);
}
function startPick(k) {
  R.pick = k;
  closeSheet();
  toast(t(k === 'from' ? 'pickFromToast' : 'pickToToast'), 5000);
  document.body.classList.add('picking');
}
function useMyLocation(k) {
  locate((lat, lon) => {
    setRoutePoint(k, lat, lon, t('myLoc'));
    map.flyTo([lat, lon], Math.max(map.getZoom(), 9));
  });
}
async function findRoute() {
  if (!R.from || !R.to) return toast(t('needPoints'));
  $('#route-results').innerHTML = `<div class="skeleton"><i></i><i></i></div><p class="muted">${esc(t('finding'))}</p>`;
  try {
    const res = await api('/api/route', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: S.mode, points: [R.from, R.to].map((p) => ({ lat: p.lat, lon: p.lon })), speedKn: R.speed }),
    });
    R.res = res;
    R.sel = res.recommended;
    setDemo(res.demo);
    $('#route-results').innerHTML = routeResultsHTML(res, R.sel);
    drawRoute(true);
  } catch (err) {
    $('#route-results').innerHTML = `<p class="note warn">${esc(err.message || t('error'))}</p>`;
  }
}
function drawRoute(fit) {
  routeLayer.clearLayers();
  const res = R.res;
  if (!res) return;
  res.routes.forEach((r, i) => {
    if (i === R.sel) return;
    L.polyline(r.geometry, { color: '#94a3b8', weight: 4, opacity: 0.6, dashArray: '2 8', lineCap: 'round' })
      .on('click', () => selectRoute(i)).addTo(routeLayer);
  });
  const r = res.routes[R.sel];
  // cumulative fraction per vertex → colour each stretch by nearest sample's risk
  const g = r.geometry;
  const cum = [0];
  for (let k = 1; k < g.length; k++) {
    const dy = g[k][0] - g[k - 1][0];
    const dx = (g[k][1] - g[k - 1][1]) * Math.cos((g[k][0] * Math.PI) / 180);
    cum.push(cum[k - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1] || 1;
  const fr = r.samples.map((s) => s.km / (r.distanceKm || 1));
  const levelAt = (f) => {
    let best = 0;
    for (let k = 1; k < fr.length; k++) if (Math.abs(fr[k] - f) < Math.abs(fr[best] - f)) best = k;
    return r.samples[best].level;
  };
  L.polyline(g, { color: '#020617', weight: 9, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
  let seg = [g[0]];
  let lv = levelAt(0);
  for (let k = 1; k < g.length; k++) {
    const l2 = levelAt(cum[k] / total);
    seg.push(g[k]);
    if (l2 !== lv || k === g.length - 1) {
      L.polyline(seg, { color: LV_COLOR[lv], weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
      seg = [g[k]];
      lv = l2;
    }
  }
  (r.closures || []).forEach((c) => {
    L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'rmark', html: `<span>${RP_ICON[c.type] || '⚠️'}</span>`, iconSize: [30, 30] }), keyboard: false })
      .bindTooltip(esc(t('rp.' + c.type))).addTo(routeLayer);
  });
  r.hazards.forEach((h) => {
    L.circleMarker([h.lat, h.lon], { radius: 8, color: '#fff', weight: 2, fillColor: LV_COLOR[h.level], fillOpacity: 1 })
      .bindTooltip(esc(t('hazAt', { km: h.km, eta: `${h.etaMin} min` }))).addTo(routeLayer);
  });
  if (fit) map.fitBounds(L.latLngBounds(g), { padding: [60, 60], maxZoom: 12 });
}
function selectRoute(i) {
  R.sel = i;
  $('#route-results').innerHTML = routeResultsHTML(R.res, i);
  drawRoute(false);
}

/* ------------------------------------------------------- search / geolocate */
function bindSuggest(input, list, onPick) {
  if (!input) return;
  let timer, items = [];
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        items = (await api('/api/geocode?q=' + encodeURIComponent(q))).results;
        list.innerHTML = items.length ? items.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}</button></li>`).join('') : `<li class="none">${esc(t('noResults'))}</li>`;
        list.hidden = false;
      } catch { list.hidden = true; }
    }, 280);
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const r = items[+b.dataset.i];
    input.value = r.name;
    list.hidden = true;
    onPick(r);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); list.querySelector('button')?.click(); }
    if (e.key === 'Escape') list.hidden = true;
  });
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 200));
}
let me;
function locate(cb) {
  if (!navigator.geolocation) return toast(t('geoFail'));
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const { latitude: lat, longitude: lon } = p.coords;
      if (me) me.setLatLng([lat, lon]); else me = L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#38bdf8', fillOpacity: 1 }).addTo(map);
      cb(lat, lon);
    },
    () => toast(t('geoFail')),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

/* ------------------------------------------------------------ layout / tabs */
const isMobile = () => matchMedia('(max-width: 860px)').matches;
function openTab(name) {
  S.tab = name;
  $$('#tabs button, #bottomnav button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === name));
  ['place', 'route', 'alerts'].forEach((n) => ($('#tab-' + n).hidden = n !== name));
  document.body.classList.add('sheet-open');
  document.body.classList.remove('layers-open');
  if (name === 'route') renderRoute();
}
function closeSheet() {
  document.body.classList.remove('sheet-open', 'layers-open');
  $$('#bottomnav button').forEach((b) => b.classList.remove('on'));
}

/* --------------------------------------------------------- layers panel UI */
const LAYER_KEYS = ['radar', 'sat', 'wind', 'wave', 'risk', 'floodmap', 'hydro', 'reports', 'trails', 'zones', 'storms', 'alerts'];
function grad(stops) {
  return `linear-gradient(90deg, ${stops.map(([v, c], i) => `rgb(${c[0]},${c[1]},${c[2]}) ${(i / (stops.length - 1)) * 100}%`).join(',')})`;
}
function renderLayers() {
  const sw = (k) => `<label class="sw"><input type="checkbox" data-act="layer" data-v="${k}" ${S.layers[k] ? 'checked' : ''}><span class="knob"></span><span>${esc(t(k))}</span></label>`;
  const seg = (group, keys, cur, label) => `<div class="seg" role="group">${keys.map((k) => `<button class="${k === cur ? 'on' : ''}" data-act="${group}" data-v="${k}">${esc(t(label + k))}</button>`).join('')}</div>`;
  let legend = '';
  if (S.layers.radar) legend += `<div class="lg"><b>${esc(t('radar'))}</b><div class="bar" style="background:linear-gradient(90deg,#a5d8ff,#4a90e2,#1d3fb8,#6a1b9a)"></div><small>— / +</small></div>`;
  if (S.layers.risk) legend += `<div class="lg"><b>${esc(t('risk'))}</b><div class="bar" style="background:linear-gradient(90deg,#22c55e,#facc15,#fb923c,#ef4444)"></div><small>${esc(t('lv.0'))} → ${esc(t('lv.3'))}</small></div>`;
  if (S.layers.wave) legend += `<div class="lg"><b>${esc(t('wave'))}</b><div class="bar" style="background:${grad(WAVE_STOPS.slice(1))}"></div><small>0.3 m → 4 m+</small></div>`;
  if (S.layers.floodmap) legend += `<div class="lg"><b>${esc(t('floodmap'))}</b><small>${esc(t('floodHazardNote'))}</small></div>`;
  if (S.layers.wind) legend += `<div class="lg"><b>${esc(t('wind'))}</b><div class="bar" style="background:linear-gradient(90deg,#bae6fd,#67e8f9,#fde047,#fb923c,#f87171)"></div><small>&lt;8 · 15 · 22 · 30+ kn</small></div>`;
  $('#layerList').innerHTML = LAYER_KEYS.map(sw).join('');
  $('#riskKinds').innerHTML = S.layers.risk ? seg('riskkind', ['overall', 'flood', 'wind', 'sea'], S.riskKind, 'rk.') : '';
  $('#bases').innerHTML = `<h4>${esc(t('basemap'))}</h4>` + seg('base', ['dark', 'light', 'sat'], S.base, 'base.');
  $('#legend').innerHTML = legend ? `<h4>${esc(t('legend'))}</h4>${legend}` : '';
  offline.render();
}
function renderStatic() {
  $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  $$('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', t(el.dataset.i18nTitle)); });
  $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.mode));
  $('#btnLang').textContent = getLang() === 'fil' ? 'EN' : 'FIL';
  renderLayers();
  renderPlace();
  if (S.tab === 'route') renderRoute();
  renderAlerts();
  hydro.redraw();
  if (radar.frames.length) showFrame(radar.idx);
}
function persist() {
  LS.set('mode', S.mode); LS.set('lang', S.lang); LS.set('layers', S.layers); LS.set('riskKind', S.riskKind); LS.set('base', S.base);
}
function syncAll() {
  syncRadar(); syncZones(); syncAlertLayers(); hydro.sync(); trails.sync(); reports.sync(); syncFlood(); scheduleGrid(50); renderLayers(); persist();
}

function setMode(m) {
  if (m === S.mode) return;
  if (m === 'fisher') Object.assign(S.layers, { wind: true, wave: true });
  else if (S.mode === 'fisher') S.layers.wave = false;
  if (m === 'hiker') S.layers.trails = true;
  else if (S.mode === 'hiker') S.layers.trails = false;
  S.mode = m;
  R.res = null;
  routeLayer.clearLayers();
  $('#route-results').innerHTML = '';
  $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
  syncAll();
  if (S.tab === 'route') renderRoute();
  if (S.placeLL) pickPlace(S.placeLL.lat, S.placeLL.lon, { keepTab: true });
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const v = el.dataset.v;
  switch (el.dataset.act) {
    case 'mode': setMode(v); break;
    case 'tab': (S.tab === v && document.body.classList.contains('sheet-open') && isMobile()) ? closeSheet() : openTab(v); break;
    case 'layers': document.body.classList.toggle('layers-open'); document.body.classList.remove('sheet-open'); break;
    case 'layer': S.layers[v] = el.checked; syncAll(); break;
    case 'riskkind': S.riskKind = v; syncAll(); break;
    case 'base': S.base = v; setBase(v); renderLayers(); persist(); break;
    case 'theme': setTheme(S.theme === 'light' ? 'dark' : 'light'); break;
    case 'play': play(); break;
    case 'pick-from': startPick('from'); break;
    case 'pick-to': startPick('to'); break;
    case 'loc-from': useMyLocation('from'); break;
    case 'loc-to': useMyLocation('to'); break;
    case 'find-route': findRoute(); break;
    case 'sel-route': selectRoute(+v); break;
    case 'route-here':
      if (S.place) {
        const n = S.place.nearest;
        setRoutePoint('to', S.place.lat, S.place.lon, n ? `${n.name} (${n.km} km)` : `${S.place.lat.toFixed(3)}, ${S.place.lon.toFixed(3)}`);
        openTab('route');
        if (!R.from) $('#rf-from')?.focus();
      }
      break;
    case 'goto': gotoAlert(+el.dataset.i); break;
    case 'goto-storm': { const s = S.storms.storms[+el.dataset.i]; if (s) map.flyTo([s.lat, s.lon], 6); closeSheet(); break; }
    case 'retry': if (S.placeLL) pickPlace(S.placeLL.lat, S.placeLL.lon); break;
    case 'close': closeSheet(); break;
    case 'lang': S.lang = getLang() === 'fil' ? 'en' : 'fil'; setLang(S.lang); persist(); renderStatic(); break;
    case 'locate': locate((lat, lon) => pickPlace(lat, lon, { fly: true })); break;
    default: handlers[el.dataset.act]?.(el, e); break;
  }
});

map.on('click', (e) => {
  if (nav.isRunning()) return;
  const { lat, lng } = e.latlng;
  if (R.pick) {
    const k = R.pick;
    R.pick = null;
    document.body.classList.remove('picking');
    setRoutePoint(k, lat, lng, `${lat.toFixed(3)}, ${lng.toFixed(3)}`);
    openTab('route');
    return;
  }
  pickPlace(lat, lng);
});
map.on('moveend', () => {
  LS.set('view', { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() });
  scheduleGrid();
  trails.schedule();
  reports.schedule();
});
$('#tlRange').addEventListener('input', (e) => { stopPlay(); showFrame(+e.target.value); });
$('#search').addEventListener('submit', (e) => e.preventDefault());
bindSuggest($('#q'), $('#qres'), (r) => pickPlace(r.lat, r.lon, { fly: true }));
setInterval(() => { loadAlerts(); hydro.load(); if (wantGrid()) refreshGrid(); }, 10 * 60e3);

/* -------------------------------------------------------------------- boot */
const ctx = { L, map, S, LS, api, toast, hint, setDemo, pickPlace, openTab, renderPlace, renderAlerts, syncAll, handlers, R, routeLayer, closeSheet, drawRoute };
[hydro, trails, reports, offline, push, nav].forEach((m) => m.init(ctx));
setLang(S.lang);
setBase(S.base);
setTheme(S.theme, { keepBase: true });
renderStatic();
openTab('place');
if (isMobile()) closeSheet();
syncAlertLayers();
syncZones();
syncFlood();
loadRadar();
loadAlerts();
hydro.load();
hydro.sync(); trails.sync(); reports.sync();
scheduleGrid(100);
{
  const qp = new URLSearchParams(location.search); // deep link from a push notification: ?lat=..&lon=..
  const la = +qp.get('lat'), lo = +qp.get('lon');
  if (qp.has('lat') && la >= 1 && la <= 26 && lo >= 112 && lo <= 134) pickPlace(la, lo, { fly: true });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
