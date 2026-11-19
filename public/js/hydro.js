// River Flow Alerts + dam levels: map markers and the panel sections.
import { t } from './i18n.js';
import { esc, fmtDT } from './panels.js';

const COL = ['#22c55e', '#facc15', '#fb923c', '#ef4444'];
let ctx, layer;
export const data = { rivers: null, dams: null };

export function init(c) {
  ctx = c;
  layer = c.L.layerGroup();
  c.handlers['goto-ll'] = (el) => c.pickPlace(+el.dataset.lat, +el.dataset.lon, { fly: true });
}

export const sync = () => (ctx.S.layers.hydro ? layer.addTo(ctx.map) : ctx.map.removeLayer(layer));

export async function load() {
  try {
    const [r, d] = await Promise.all([ctx.api('/api/rivers'), ctx.api('/api/dams')]);
    data.rivers = r;
    data.dams = d;
    if (r.demo || d.demo) ctx.setDemo(true);
    draw();
    ctx.renderAlerts();
  } catch { /* best effort */ }
}

/** How many rivers/dams are at "rising fast" or worse (for the Alerts badge). */
export const urgent = () =>
  (data.rivers?.rivers || []).filter((r) => r.ok && r.level >= 2).length + (data.dams?.dams || []).filter((d) => d.live && d.level >= 2).length;

function spark(r, w = 150, h = 34) {
  const v = r.series.map((x) => x ?? 0);
  const max = Math.max(...v, 1), min = Math.min(...v);
  const x = (i) => (i / (v.length - 1)) * (w - 4) + 2;
  const y = (q) => h - 3 - ((q - min) / (max - min || 1)) * (h - 8);
  const today = Math.min(v.length - 1, Math.max(0, Math.floor((Date.now() / 1000 - r.t0) / 86400)));
  const pts = v.map((q, i) => `${x(i).toFixed(1)},${y(q).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(r.n)}">
    <line x1="${x(today).toFixed(1)}" y1="0" x2="${x(today).toFixed(1)}" y2="${h}" stroke="currentColor" opacity=".35" stroke-dasharray="2 3"/>
    <polyline points="${pts}" fill="none" stroke="${COL[r.level]}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

const riverLine = (r) => t('rvLine', { q: r.q, peak: r.peak, ratio: r.ratio });
const damLine = (d) => t('damLine', { rwl: d.rwl, nhwl: d.nhwl, margin: d.margin });

function draw() {
  layer.clearLayers();
  const L = ctx.L;
  for (const r of data.rivers?.rivers || []) {
    if (!r.ok) continue;
    L.circleMarker([r.lat, r.lon], { radius: 5 + r.level * 1.5, color: '#fff', weight: 2, fillColor: COL[r.level], fillOpacity: 0.95, bubblingMouseEvents: false })
      .bindPopup(`<b>${esc(r.n)}</b><br>${esc(t('rv.' + r.level))}<br><small>${esc(riverLine(r))}</small><br>${spark(r)}<br><small>${esc(t('riversNote'))}</small>`)
      .bindTooltip(`${esc(r.n)} · ${esc(t('rv.' + r.level))}`).addTo(layer);
  }
  for (const d of data.dams?.dams || []) {
    const c = d.live ? COL[d.level] : '#64748b';
    L.marker([d.lat, d.lon], { icon: L.divIcon({ className: 'dmark', html: `<i style="background:${c}"></i>`, iconSize: [18, 18] }), keyboard: false })
      .bindPopup(`<b>${esc(d.n)} Dam</b><br>${d.live ? `${esc(t('dm.' + d.level))}<br><small>${esc(damLine(d))}</small>${d.obs ? `<br><small>${esc(t('damObs', { obs: d.obs }))}</small>` : ''}` : esc(t('damNoLive'))}<br><small>${esc(d.use)}</small>`)
      .bindTooltip(`${esc(d.n)} Dam`).addTo(layer);
  }
}
export const redraw = () => data.rivers && draw();

/** HTML for the Alerts tab. */
export function html() {
  if (!data.rivers && !data.dams) return '';
  const rv = (data.rivers?.rivers || []).filter((r) => r.ok);
  const rivers = rv.length
    ? rv.map((r) => `<button class="acard lv${r.level}" data-act="goto-ll" data-lat="${r.lat}" data-lon="${r.lon}">
        <span class="dot lv${r.level}"></span><div class="grow"><b>${esc(r.n)}</b> <small>${esc(t('rv.' + r.level))}</small>
        <p class="muted">${esc(riverLine(r))}</p></div>${spark(r, 84, 28)}</button>`).join('')
    : `<p class="muted">${esc(t('noRivers'))}</p>`;
  const dm = data.dams;
  const err = dm?.error === 'parse' ? t('damErrParse') : dm?.error === 'unreachable' ? t('damErrNet') : '';
  const dams = (dm?.dams || []).map((d) => `<div class="acard dam lv${d.live ? d.level : 0}${d.live ? '' : ' off'}">
      <span class="dot lv${d.live ? d.level : 0}"></span><div><b>${esc(d.n)}</b> <small>${d.live ? esc(t('dm.' + d.level)) : esc(t('damNoLive'))}</small>
      ${d.live ? `<p class="muted">${esc(damLine(d))}${d.obs ? ' · ' + esc(t('damObs', { obs: d.obs })) : ''}</p>` : ''}</div></div>`).join('');
  return `<h4>${esc(t('riversTitle'))}</h4><p class="fine">${esc(t('riversNote'))}</p><div class="alist">${rivers}</div>
    <h4>${esc(t('damsTitle'))}</h4>${err ? `<p class="note warn">${esc(err)}</p>` : ''}<div class="alist">${dams}</div>
    <p class="fine">${esc(t('damsNote'))} <a href="${esc(dm?.source || 'https://bagong.pagasa.dost.gov.ph/flood')}" target="_blank" rel="noopener noreferrer">PAGASA</a>${dm?.t ? ' · ' + esc(fmtDT(dm.t / 1000)) : ''}</p>`;
}
