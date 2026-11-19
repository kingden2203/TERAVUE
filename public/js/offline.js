// Offline support: save a map area (tiles) for later, show offline / stale-data banners.
// Tiles are kept in per-area caches; the service worker serves them (and the last API answers) when there is no signal.
import { t } from './i18n.js';
import { esc, fmtT } from './panels.js';

const CAP = 350; // tiles per saved area: keep to a small, polite amount (tile servers are not a bulk-download service)
const MAX_AREAS = 6;
const PREFIX = 'terravue-area-';
let ctx, busy = null;

/** Must match sw.js: Leaflet picks a random a-d subdomain, so store/look up under "a". */
export const normTile = (u) => u.replace(/^https:\/\/[b-d]\.basemaps\.cartocdn\.com/, 'https://a.basemaps.cartocdn.com');

export function init(c) {
  ctx = c;
  c.handlers['off-save'] = save;
  c.handlers['off-del'] = (el) => del(el.dataset.id);
  addEventListener('offline', () => netBar(t('offBanner')));
  addEventListener('online', () => { netBar(''); c.toast(t('backOnline')); });
  if (!navigator.onLine) netBar(t('offBanner'));
}

function netBar(msg) {
  const b = document.getElementById('netbar');
  b.hidden = !msg;
  b.textContent = msg;
}
export function markStale(savedMs) {
  netBar(savedMs ? t('stale', { time: fmtT(savedMs / 1000) }) : t('offBanner'));
}

const x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const y = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);

export function planTiles(bounds, z0, template, cap = CAP) {
  const urls = [];
  const zooms = [z0, z0 - 1, z0 + 1, z0 - 2, z0 + 2, z0 + 3].filter((z) => z >= 5 && z <= 15);
  for (const z of zooms) {
    const x0 = x(bounds.getWest(), z), x1 = x(bounds.getEast(), z), y0 = y(bounds.getNorth(), z), y1 = y(bounds.getSouth(), z);
    const n = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (urls.length + n > cap) { if (z >= z0) break; continue; }
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) urls.push(template(z, ix, iy));
  }
  return urls;
}

const areas = () => ctx.LS.get('areas', []);

async function save() {
  if (busy) return;
  if (!('caches' in window)) return ctx.toast(t('offFail'));
  const S = ctx.S;
  if (S.base === 'sat') return ctx.toast(t('offNoSat'));
  if (areas().length >= MAX_AREAS) return ctx.toast(t('offFail'));
  const path = S.base === 'dark' ? 'dark_all' : 'rastertiles/voyager';
  const r = L.Browser.retina ? '@2x' : '';
  const urls = planTiles(ctx.map.getBounds(), ctx.map.getZoom(), (z, ix, iy) => `https://a.basemaps.cartocdn.com/${path}/${z}/${ix}/${iy}${r}.png`);
  const id = Date.now().toString(36);
  const center = ctx.map.getCenter();
  busy = { n: 0, total: urls.length };
  render();
  try {
    const cache = await caches.open(PREFIX + id);
    let next = 0, ok = 0;
    const worker = async () => {
      while (next < urls.length) {
        const u = urls[next++];
        try {
          const res = await fetch(u);
          if (res.ok) { await cache.put(u, res); ok++; }
        } catch { /* skip this tile */ }
        busy.n++;
        if (busy.n % 10 === 0) render();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (ok < urls.length * 0.8) { await caches.delete(PREFIX + id); throw new Error('incomplete'); }
    // also remember the weather for the centre while we have signal (the service worker caches these answers)
    ctx.api(`/api/point?lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}&mode=${S.mode}`).catch(() => {});
    ctx.api('/api/alerts').catch(() => {});
    ctx.api('/api/rivers').catch(() => {});
    ctx.api('/api/dams').catch(() => {});
    const b = ctx.map.getBounds();
    if (b.getNorth() - b.getSouth() <= 0.4 && b.getEast() - b.getWest() <= 0.4) {
      ctx.api(`/api/trails?s=${b.getSouth().toFixed(4)}&n=${b.getNorth().toFixed(4)}&w=${b.getWest().toFixed(4)}&e=${b.getEast().toFixed(4)}`).catch(() => {});
    }
    const name = S.place?.nearest?.name || `${center.lat.toFixed(2)}, ${center.lng.toFixed(2)}`;
    ctx.LS.set('areas', [...areas(), { id, name, tiles: ok, z: ctx.map.getZoom(), date: Date.now() }]);
    ctx.toast(t('offDone', { n: ok }));
  } catch {
    ctx.toast(t('offFail'));
  } finally {
    busy = null;
    render();
  }
}

async function del(id) {
  try { await caches.delete(PREFIX + id); } catch { /* ignore */ }
  ctx.LS.set('areas', areas().filter((a) => a.id !== id));
  render();
}

export function html() {
  const list = areas();
  const prog = busy ? `<div class="prog"><i style="width:${Math.round((busy.n / busy.total) * 100)}%"></i></div><small>${esc(t('offSaving', { n: busy.n, total: busy.total }))}</small>` : '';
  return `<h4>${esc(t('offTitle'))}</h4>
    <button class="btn small wide" data-act="off-save" ${busy ? 'disabled' : ''}>⬇ ${esc(t('offSave'))}</button>${prog}
    ${list.length ? `<p class="fine">${esc(t('offList'))}</p>` + list.map((a) => `<div class="area"><span>${esc(a.name)} <small>· ${a.tiles}</small></span><button class="icon sm" data-act="off-del" data-id="${esc(a.id)}" aria-label="${esc(t('offDel'))}" title="${esc(t('offDel'))}">✕</button></div>`).join('') : ''}
    <p class="fine">${esc(t('offNote'))}</p>`;
}
export function render() {
  const el = document.getElementById('offline');
  if (el) el.innerHTML = html();
}
