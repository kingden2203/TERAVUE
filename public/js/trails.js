// Hiking trails (OpenStreetMap) on the map + elevation profile panel for a chosen trail.
import { t, reason } from './i18n.js';
import { esc, gauge, fmtDT, fmtDur } from './panels.js';

const MIN_ZOOM = 11;
const SAC_COL = ['#7dd3fc', '#4ade80', '#facc15', '#fb923c', '#ef4444'];
let ctx, layer, sel, timer, ctl, trails = [];

export function init(c) {
  ctx = c;
  layer = c.L.featureGroup();
  sel = c.L.featureGroup();
  c.handlers['trail-back'] = () => { sel.clearLayers(); c.renderPlace(); };
}

export function sync() {
  if (ctx.S.layers.trails) { layer.addTo(ctx.map); sel.addTo(ctx.map); schedule(100); } else { ctx.map.removeLayer(layer); ctx.map.removeLayer(sel); }
}
export function schedule(ms = 600) {
  clearTimeout(timer);
  timer = setTimeout(load, ms);
}

const sacBucket = (s) => Math.min(4, s);

export async function load() {
  if (!ctx.S.layers.trails) return;
  if (ctx.map.getZoom() < MIN_ZOOM) { layer.clearLayers(); return ctx.hint(t('trailZoom')); }
  ctx.hint('');
  const b = ctx.map.getBounds();
  ctl?.abort();
  ctl = new AbortController();
  try {
    const r = await ctx.api(`/api/trails?s=${b.getSouth().toFixed(4)}&n=${b.getNorth().toFixed(4)}&w=${b.getWest().toFixed(4)}&e=${b.getEast().toFixed(4)}`, { signal: ctl.signal });
    trails = r.trails;
    if (r.demo) ctx.setDemo(true);
    layer.clearLayers();
    r.trails.forEach((g, i) => {
      const col = SAC_COL[sacBucket(g.sac)];
      for (const line of g.lines) {
        ctx.L.polyline(line, { color: col, weight: 4, opacity: 0.9, dashArray: g.sac ? null : '5 6', bubblingMouseEvents: false })
          .bindTooltip(`${esc(g.name || '—')} · ${g.km} km`, { sticky: true }).on('click', () => open(i)).addTo(layer);
      }
    });
    if (!r.trails.length) ctx.hint(t('trailNone'));
  } catch (err) {
    if (err.name !== 'AbortError') ctx.hint(t('trailsBusy'));
  }
}

/** Join a trail's separate OSM ways end-to-end so the profile covers the whole walk. */
export function chain(lines) {
  const near = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.97) < 0.0005; // ~50 m
  const left = lines.map((l) => l.slice()).sort((a, b) => b.length - a.length);
  let cur = left.shift() || [];
  let progress = true;
  while (left.length && progress) {
    progress = false;
    for (let i = 0; i < left.length; i++) {
      const l = left[i], end = cur[cur.length - 1], start = cur[0];
      if (near(end, l[0])) cur = cur.concat(l.slice(1));
      else if (near(end, l[l.length - 1])) cur = cur.concat(l.slice(0, -1).reverse());
      else if (near(start, l[l.length - 1])) cur = l.slice(0, -1).concat(cur);
      else if (near(start, l[0])) cur = l.slice(1).reverse().concat(cur);
      else continue;
      left.splice(i, 1);
      progress = true;
      break;
    }
  }
  return cur;
}

function thin(pts, max = 200) {
  if (pts.length <= max) return pts;
  const k = (pts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * k)]);
}

async function open(i) {
  const g = trails[i];
  if (!g) return;
  ctx.openTab('place');
  const line = thin(chain(g.lines));
  sel.clearLayers();
  ctx.L.polyline(line, { color: '#fff', weight: 8, opacity: 0.9, interactive: false }).addTo(sel);
  ctx.L.polyline(line, { color: SAC_COL[sacBucket(g.sac)], weight: 4, interactive: false }).addTo(sel);
  ctx.map.fitBounds(ctx.L.latLngBounds(line), { padding: [50, 50], maxZoom: 15 });
  const head = `<button class="btn small" data-act="trail-back">${esc(t('trailBack'))}</button>
    <div class="ph"><div><h3>${esc(g.name || '—')}</h3><p class="muted">${g.km} km · ${esc(t('sac.' + sacBucket(g.sac)))}${g.lines.length > 1 ? ' · ' + esc(t('trailParts', { n: g.lines.length })) : ''}</p></div></div>`;
  const box = document.getElementById('tab-place');
  box.innerHTML = head + `<div class="skeleton"><i></i><i></i></div><p class="muted">${esc(t('trailLoading'))}</p>`;
  try {
    const p = await ctx.api('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points: line.map(([lat, lon]) => ({ lat, lon })) }) });
    if (!box.innerHTML.includes('data-act="trail-back"')) return; // user went elsewhere
    box.innerHTML = head + profileHTML(p) + `<p class="fine">${esc(t('profileNote'))} ${esc(t('disclaimer'))}</p>`;
  } catch (err) {
    box.innerHTML = head + `<p class="note warn">${esc(err.message || t('error'))}</p>`;
  }
}

function chart(p) {
  const W = 480, H = 156, pl = 34, pr = 10, pt = 20, pb = 18;
  const km = p.km, lo = Math.floor(p.min / 10) * 10, hi = Math.ceil(p.max / 10) * 10 || lo + 10;
  const x = (d) => pl + (d / km) * (W - pl - pr);
  const y = (e) => pt + (1 - (e - lo) / (hi - lo || 1)) * (H - pt - pb);
  const line = p.profile.map(([d, e]) => `${x(d).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${H - pb} ${line} ${x(km).toFixed(1)},${H - pb}`;
  const top = p.profile.reduce((a, b) => (b[1] > a[1] ? b : a));
  const ticks = [lo, Math.round((lo + hi) / 2), hi].map((e) => `<text x="${pl - 4}" y="${y(e) + 3}" text-anchor="end">${e}</text><line x1="${pl}" x2="${W - pr}" y1="${y(e)}" y2="${y(e)}"/>`).join('');
  const kms = [0, 0.5, 1].map((f) => `<text x="${x(km * f)}" y="${H - 4}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${(km * f).toFixed(1)} km</text>`).join('');
  return `<svg class="elev" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('trailLoading'))}">${ticks}${kms}
    <polygon points="${area}" class="ea"/><polyline points="${line}" class="el"/>
    <circle cx="${x(top[0])}" cy="${y(top[1])}" r="4" class="ep"/><text x="${x(top[0])}" y="${y(top[1]) - 8}" text-anchor="middle" class="et">${top[1]} m</text></svg>`;
}

export function profileHTML(p) {
  const tile = (l, v) => `<div class="tile"><span>${esc(l)}</span><b>${v}</b></div>`;
  const s = p.summit;
  const wins = s?.windows?.length ? `<div class="wins">${s.windows.map((w) => `<span class="win${w.best ? ' best' : ''}">${esc(fmtDT(w.start))} – ${esc(fmtDT(w.end))}</span>`).join('')}</div>` : '';
  const weather = s?.risk ? `<h4>${esc(t('summitNow'))} · ${s.elev} m</h4>
    <div class="verdict lv${s.risk.level}">${gauge(s.risk.score, s.risk.level, 56)}<div><strong>${esc(t('verdict.' + s.risk.level))}</strong>${s.risk.reasons.length ? `<ul class="reasons">${s.risk.reasons.map((r) => `<li class="lv${r.s >= 75 ? 3 : r.s >= 50 ? 2 : 1}">${esc(reason(r))}</li>`).join('')}</ul>` : ''}</div></div>
    <h4>${esc(t('windowsTitle'))}</h4>${wins || `<p class="muted">${esc(t('noWindow'))}</p>`}` : '';
  return `<div class="tiles">${tile(t('distance'), `${p.km} km`)}${tile(t('gain'), `↑ ${p.gain} m`)}${tile(t('loss'), `↓ ${p.loss} m`)}
    ${tile(t('maxEl'), `${p.max} m`)}${tile(t('hikeTime'), esc(fmtDur(Math.round(p.hours * 60))))}${tile('Min', `${p.min} m`)}</div>${chart(p)}${weather}`;
}
