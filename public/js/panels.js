// Pure HTML builders for the side panel. All dynamic text goes through esc().
import { t, getLang, reason, wx } from './i18n.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const loc = () => (getLang() === 'fil' ? 'fil-PH' : 'en-PH');
const TZ = 'Asia/Manila';
export const fmtT = (u) => new Date(u * 1000).toLocaleTimeString(loc(), { hour: 'numeric', minute: '2-digit', timeZone: TZ });
export const fmtHour = (u) => new Date(u * 1000).toLocaleTimeString(loc(), { hour: 'numeric', timeZone: TZ });
const dayKey = (u) => new Date(u * 1000).toLocaleDateString('en-CA', { timeZone: TZ });
export function fmtDT(u) {
  if (dayKey(u) === dayKey(Date.now() / 1000)) return fmtT(u);
  return new Date(u * 1000).toLocaleDateString(loc(), { weekday: 'short', timeZone: TZ }) + ' ' + fmtT(u);
}
export const fmtDur = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') + 'm' : ''}`);
const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (d) => (d == null ? '–' : DIRS[Math.round(d / 22.5) % 16]);
const n1 = (v) => (v == null ? '–' : Number(v).toFixed(1).replace(/\.0$/, ''));

export function gauge(score, level, size = 68) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const m = size / 2;
  return `<svg class="gauge lv${level}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="${score}/100">
    <circle class="g-bg" cx="${m}" cy="${m}" r="${r}"/>
    <circle class="g-fg" cx="${m}" cy="${m}" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(1)}" transform="rotate(-90 ${m} ${m})"/>
    <text x="${m}" y="${m + 6}" text-anchor="middle">${score}</text></svg>`;
}

const reasonList = (rs) => (rs.length ? `<ul class="reasons">${rs.map((r) => `<li class="lv${r.s >= 75 ? 3 : r.s >= 50 ? 2 : 1}">${esc(reason(r))}</li>`).join('')}</ul>` : '');

function bars(tl) {
  const W = 480, H = 74, bw = W / tl.length;
  const rects = tl.map((p, i) => {
    const h = Math.max(3, (p.score / 100) * 54);
    const tip = `${fmtT(p.t)} · ${p.score}/100` + (p.precip ? ` · ${n1(p.precip)} mm/h` : '');
    return `<rect class="b lv${p.level}" x="${(i * bw + 1).toFixed(1)}" y="${(58 - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(tip)}</title></rect>`;
  }).join('');
  const labels = tl.map((p, i) => (i % 6 === 0 ? `<text x="${(i * bw + (i === 0 ? 1 : bw / 2)).toFixed(1)}" y="71" text-anchor="${i === 0 ? 'start' : 'middle'}">${i === 0 ? esc(t('now')) : esc(fmtHour(p.t))}</text>` : '')).join('');
  return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('tlTitle'))}">${rects}<line x1="0" y1="59" x2="${W}" y2="59"/>${labels}</svg>`;
}

const tile = (label, value, sub = '') => `<div class="tile"><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

export function placeHTML(d, mode) {
  const a = d.modes[mode];
  const c = d.now;
  const notSea = mode === 'fisher' && !d.isSea;
  const modeChips = ['general', 'motorcycle', 'hiker', 'fisher']
    .map((m) => `<button class="chip lv${d.modes[m].level}${m === mode ? ' on' : ''}" data-act="mode" data-v="${m}">${esc(t('mode.' + m))}<b>${d.modes[m].score}</b></button>`)
    .join('');
  const tiles = [
    tile(t('cWind'), `${n1(c.windKn)} kn`, `${compass(c.dir)} · ${n1(c.windKmh)} km/h`),
    tile(t('cGust'), `${n1(c.gustKn)} kn`, `${n1(c.gust)} km/h`),
    tile(t('cRain'), `${n1(c.precip)} mm/h`, esc(wx(c.code))),
    tile(t('cRain24'), `${n1(c.rain24)} mm`, c.prob != null ? `${c.prob}%` : ''),
    tile(t('cTemp'), `${n1(c.appT)}°C`, c.temp != null ? `${n1(c.temp)}°C` : ''),
    tile(t('cVis'), c.vis == null ? '–' : `${n1(c.vis / 1000)} km`),
  ];
  if (d.isSea) {
    tiles.push(tile(t('cWave'), `${n1(c.wave)} m`, c.period ? `${n1(c.period)} s · ${compass(c.wdir)}` : ''));
    tiles.push(tile(t('cSwell'), `${n1(c.swell)} m`, c.sdir != null ? compass(c.sdir) : ''));
    if (c.cur != null) tiles.push(tile(t('cCur'), `${n1(c.cur)} m/s`, compass(c.curdir)));
  } else tiles.push(tile(t('cElev'), `${Math.round(d.elev ?? 0)} m`));
  if (d.river) tiles.push(tile(t('cRiver'), esc(t('riverVal', { q: n1(d.river.q), peak: n1(d.river.peak) }))));

  const wins = d.windows.length
    ? `<div class="wins">${d.windows.map((w) => `<span class="win${w.best ? ' best' : ''}">${w.start <= d.now.t ? esc(t('now')) : esc(fmtDT(w.start))} – ${esc(fmtDT(w.end))}<small>${w.hours}h</small></span>`).join('')}</div>`
    : `<p class="muted">${esc(t('noWindow'))}</p>`;
  const zones = d.zones.length ? `<p class="zonenote">⚠ ${esc(t('zoneNote'))}: ${d.zones.map((z) => esc(z.n)).join(', ')}</p>` : '';

  return `
  <div class="ph">
    <div><h3>${esc(d.nearest ? t('nearLabel', { km: d.nearest.km, name: d.nearest.name }) : t('here'))}</h3>
    <p class="muted">${d.lat.toFixed(3)}°, ${d.lon.toFixed(3)}° · ${d.isSea ? esc(t('sea')) : esc(t('land'))}</p></div>
    <button class="btn small" data-act="route-here">${esc(t('routeHere'))} →</button>
  </div>
  <div class="verdict lv${a.level}">
    ${gauge(a.score, a.level)}
    <div><strong>${esc(t('verdict.' + a.level))}</strong>${reasonList(a.reasons)}</div>
  </div>
  ${notSea ? `<p class="note">${esc(t('notSea'))}</p>` : ''}
  ${zones}
  <h4>${esc(t('modesTitle'))}</h4><div class="chips">${modeChips}</div>
  <div class="tiles">${tiles.join('')}</div>
  <h4>${esc(t('tlTitle'))}</h4>${bars(d.timeline)}
  <h4>${esc(t('windowsTitle'))}</h4>${wins}
  ${reportsHTML(d.reports || [])}
  <p class="fine">${esc(t('disclaimer'))}</p>`;
}

export const RP_ICON = { flood: '🌊', closed: '⛔', landslide: '⛰️', fallen: '🌳', damaged: '🚧' };
export const ago = (min) => (min < 90 ? t('ago.m', { n: Math.max(1, min) }) : t('ago.h', { n: Math.round(min / 60) }));
export function reportCard(r, withKm = false) {
  return `<div class="rp"><span class="rpi">${RP_ICON[r.type] || '⚠️'}</span><div><b>${esc(t('rp.' + r.type))}</b>${withKm && r.km != null ? ` <small>· ${esc(t('km', { n: r.km < 0.1 ? '<0.1' : r.km }))}</small>` : ''}
    ${r.note ? `<p>${esc(r.note)}</p>` : ''}<small class="muted">${esc(ago(r.age))} · ${esc(t('rpConfirms', { n: r.confirms }))}</small>
    <div class="rpv"><button class="btn small" data-act="rp-vote" data-id="${esc(r.id)}" data-v="still">${esc(t('rpStill'))}</button><button class="btn small" data-act="rp-vote" data-id="${esc(r.id)}" data-v="gone">${esc(t('rpGone'))}</button></div></div></div>`;
}
function reportsHTML(list) {
  const btns = Object.keys(RP_ICON).map((k) => `<button class="rpb" data-act="rp-add" data-v="${k}"><span>${RP_ICON[k]}</span>${esc(t('rp.' + k))}</button>`).join('');
  return `<h4>${esc(t('rpTitle'))}</h4>
  ${list.length ? `<div class="rplist">${list.map((r) => reportCard(r, true)).join('')}</div>` : `<p class="muted">${esc(t('rpNone'))}</p>`}
  <details class="rpadd"><summary>${esc(t('rpAdd'))}</summary>
    <input id="rp-note" type="text" maxlength="120" placeholder="${esc(t('rpNote'))}">
    <div class="rpbtns">${btns}</div><p class="fine">${esc(t('rpHint'))} ${esc(t('rpDisclaimer'))}</p></details>`;
}

export function routeFormHTML(R, mode) {
  const field = (k, label) => `
    <label class="rf"><span>${esc(label)}</span>
      <div class="rfrow"><input id="rf-${k}" type="search" autocomplete="off" value="${esc(R[k]?.name || '')}" placeholder="${esc(t('search'))}">
      <button class="icon" data-act="loc-${k}" title="${esc(t('myLoc'))}" aria-label="${esc(t('myLoc'))}">◎</button>
      <button class="icon" data-act="pick-${k}" title="${esc(t('pickMap'))}" aria-label="${esc(t('pickMap'))}">⌖</button></div>
      <ul class="suggest" id="sg-${k}" hidden></ul></label>`;
  return `${field('from', t('from'))}${field('to', t('to'))}
    ${mode === 'fisher' ? `<label class="rf"><span>${esc(t('speed'))}</span><input id="rf-speed" type="number" min="2" max="40" value="${R.speed}"></label>` : ''}
    <button class="btn primary wide" data-act="find-route">${esc(t('findRoute'))}</button>`;
}

const tagLabel = { recommended: 'tagRecommended', fastest: 'tagFastest', safest: 'tagSafest' };

export function routeResultsHTML(res, sel) {
  const cards = res.routes.map((r, i) => {
    const tags = r.tags.map((x) => `<span class="tag ${x}">${esc(t(tagLabel[x]))}</span>`).join('');
    const name = r.sea ? t('seaLeg') : t('routeN', { n: i + 1 });
    return `<button class="rcard lv${r.levelNow}${i === sel ? ' on' : ''}" data-act="sel-route" data-v="${i}">
      ${gauge(r.scoreNow, r.levelNow, 48)}
      <div><b>${esc(name)}</b> ${tags}<p class="muted">${r.sea ? (r.distanceKm / 1.852).toFixed(1) + ' nm' : r.distanceKm + ' km'} · ${esc(fmtDur(r.durationMin))} · ${r.hazards.length ? esc(t('hazards', { n: r.hazards.length })) : esc(t('noHazards'))}</p></div></button>`;
  }).join('');
  const r = res.routes[sel];
  const adv = res.advice;
  const best = r.departures.reduce((a, b) => (b.score < a.score ? b : a));
  const advText = { go: t('advGo'), wait: t('advWait', { time: fmtDT(best.t), h: best.h }), caution: t('advCaution'), avoid: t('advAvoid') }[adv.action];
  const dep = r.departures.map((d) => `<div class="dep${d.h === best.h && adv.action === 'wait' ? ' best' : ''}" title="${esc(fmtT(d.t))} · ${d.score}/100"><i class="lv${d.level}" style="height:${Math.max(4, d.score * 0.5)}px"></i><span>${d.h === 0 ? esc(t('now')) : d.h % 3 === 0 ? '+' + d.h + 'h' : ''}</span></div>`).join('');
  const clo = (r.closures || []).map((c) => `<li class="lv3"><b>${RP_ICON[c.type] || '⚠️'} ${esc(t('rp.' + c.type))}</b><small>${esc(c.note || '')} ${esc(ago(c.age))}</small></li>`).join('');
  const haz = r.hazards.slice(0, 5).map((h) => `<li class="lv${h.level}"><b>${esc(h.reasons[0] ? reason(h.reasons[0]) : '')}</b><small>${esc(t('hazAt', { km: h.km, eta: fmtDur(h.etaMin) }))}</small></li>`).join('');
  return `<div class="rcards">${cards}</div>
  <div class="advice ${adv.action}">${esc(advText)}</div>
  <div class="navbtns"><button class="btn primary" data-act="nav-start">▶ ${esc(t('navStart'))}</button><button class="btn" data-act="nav-sim">${esc(t('navSim'))}</button></div>
  ${(r.zones || []).length ? `<p class="note">⚠ ${esc(t('zonesRoute'))} ${r.zones.map((z) => esc(z.n)).join(', ')}</p>` : ''}
  ${r.sea ? `<p class="note">${esc(t('seaWarn'))}</p>` : ''}${r.crossesLand ? `<p class="note warn">${esc(t('landWarn'))}</p>` : ''}
  <h4>${esc(t('depTitle'))}</h4><div class="deps">${dep}</div>
  ${clo || haz ? `<ul class="haz">${clo}${haz}</ul>` : ''}
  ${(r.closures || []).length ? `<p class="fine">${esc(t('rpRoute', { n: r.closures.length }))} · ${esc(t('rpDisclaimer'))}</p>` : ''}
  <p class="fine">${esc(t('disclaimer'))}</p>`;
}

export function alertsHTML(al, st, extra = {}) {
  const list = al.alerts.length
    ? al.alerts.map((a, i) => `<button class="acard lv${a.level}" data-act="goto" data-i="${i}">
        <span class="dot lv${a.level}"></span>
        <div><b>${esc(a.name)}</b> <small>${esc(t(a.type === 'sea' ? 'sea' : 'land'))} · ${a.score}/100</small>
        ${reasonList(a.reasons)}<small class="muted">${esc(t('peak', { time: fmtDT(a.peakT) }))}</small></div></button>`).join('')
    : `<p class="muted">${esc(t('noAlerts'))}</p>`;
  const storms = st.storms.length
    ? st.storms.map((s, i) => `<button class="acard storm" data-act="goto-storm" data-i="${i}"><span class="dot lv${s.level === 'Red' ? 3 : s.level === 'Orange' ? 2 : 1}"></span>
        <div><b>${esc(s.name)}</b> <small>${esc(s.level)}</small><p class="muted">${esc(s.severity)}</p></div></button>`).join('')
    : `<p class="muted">${esc(t('noStorms'))}</p>`;
  return `${extra.top || ''}<h4>${esc(t('alertsTitle'))}</h4><div class="alist">${list}</div>
  ${extra.mid || ''}
  <h4>${esc(t('stormsTitle'))}</h4><div class="alist">${storms}</div>
  <h4>${esc(t('emergency'))}</h4><p>${esc(t('emergencyText'))}</p>
  <h4>${esc(t('official'))}</h4>
  <p><a href="https://bagong.pagasa.dost.gov.ph/" target="_blank" rel="noopener noreferrer">PAGASA</a> · <a href="https://ndrrmc.gov.ph/" target="_blank" rel="noopener noreferrer">NDRRMC</a> · <a href="https://www.georisk.gov.ph/" target="_blank" rel="noopener noreferrer">GeoRiskPH</a></p>
  <p class="fine">${esc(t('disclaimer'))}</p>`;
}
