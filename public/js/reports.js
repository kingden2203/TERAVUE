// Community road reports: map markers, report form, "still here / gone" votes.
import { t } from './i18n.js';
import { esc, reportCard, RP_ICON } from './panels.js';

let ctx, layer, timer, ctl;
const MIN_ZOOM = 8;

export function init(c) {
  ctx = c;
  layer = c.L.layerGroup();
  c.handlers['rp-add'] = (el) => submit(el.dataset.v);
  c.handlers['rp-vote'] = (el) => vote(el.dataset.id, el.dataset.v, el);
}

export function sync() {
  if (ctx.S.layers.reports) { layer.addTo(ctx.map); schedule(100); } else ctx.map.removeLayer(layer);
}

export function schedule(ms = 500) {
  clearTimeout(timer);
  timer = setTimeout(load, ms);
}

export async function load() {
  if (!ctx.S.layers.reports || ctx.map.getZoom() < MIN_ZOOM) return layer.clearLayers();
  const b = ctx.map.getBounds();
  ctl?.abort();
  ctl = new AbortController();
  try {
    const { reports } = await ctx.api(`/api/reports?s=${b.getSouth().toFixed(3)}&n=${b.getNorth().toFixed(3)}&w=${b.getWest().toFixed(3)}&e=${b.getEast().toFixed(3)}`, { signal: ctl.signal });
    draw(reports);
  } catch { /* offline or aborted */ }
}

function draw(list) {
  layer.clearLayers();
  const L = ctx.L;
  for (const r of list) {
    L.marker([r.lat, r.lon], { icon: L.divIcon({ className: 'rmark', html: `<span>${RP_ICON[r.type] || '⚠️'}</span>`, iconSize: [30, 30] }), keyboard: false })
      .bindPopup(`<div class="rpop">${reportCard(r)}</div>`, { minWidth: 200 }).addTo(layer);
  }
}

async function submit(type) {
  const ll = ctx.S.placeLL;
  if (!ll) return ctx.toast(t('rpPickFirst'));
  const note = document.getElementById('rp-note')?.value || '';
  try {
    const r = await ctx.api('/api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, lat: ll.lat, lon: ll.lon, note }) });
    ctx.toast(t(r.merged ? 'rpMerged' : 'rpThanks'));
    ctx.S.layers.reports = true;
    ctx.syncAll();
    ctx.pickPlace(ll.lat, ll.lon, { keepTab: true });
  } catch (err) {
    ctx.toast(err.message || t('error'));
  }
}

async function vote(id, v, el) {
  try {
    await ctx.api('/api/reports/vote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, v }) });
    if (el) { el.disabled = true; el.textContent = '✓'; }
    ctx.toast(t('rpThanks'));
    schedule(300);
  } catch (err) {
    ctx.toast(err.message || t('error'));
  }
}
