// Live navigation: GPS (or simulator) -> engine -> instruction card, voice, hazard warnings, auto-reroute.
import { t, getLang } from './i18n.js';
import { Nav, describe, hazardLabel, positionAt, cumulative } from './navcore.js';
import { esc, fmtT, RP_ICON } from './panels.js';

const $ = (s) => document.querySelector(s);
let ctx, nav, route, navLayer, marker, running = false, follow = true;
let watchId = null, simTimer = null, sim = null, wake = null, gpsTimer = null, repTimer = null;
let rerouting = false, lastReroute = 0, lastFix = null, spokeReroute = 0, arrivedShown = false;
const voice = { on: true, lang: 'fil', v: null };
let audio;

export function init(c) {
  ctx = c;
  navLayer = c.L.layerGroup();
  Object.assign(c.handlers, {
    'nav-start': () => start(false),
    'nav-sim': () => start(true),
    'nav-end': () => stop(true),
    'nav-mute': toggleVoice,
    'nav-recenter': () => { follow = true; $('#nav-recenter').hidden = true; if (lastFix) c.map.panTo([lastFix.lat, lastFix.lon]); },
    'nav-speed': (el) => { if (sim) sim.mult = +el.dataset.v; document.querySelectorAll('#nav-sim [data-act="nav-speed"]').forEach((b) => b.classList.toggle('on', b === el)); },
    'nav-deviate': () => { if (sim) sim.devUntil = Date.now() + 12000; },
    'nav-done': () => stop(true),
  });
  c.map.on('dragstart', () => { if (running) { follow = false; $('#nav-recenter').hidden = false; } });
  document.addEventListener('visibilitychange', () => { if (running && document.visibilityState === 'visible') getWake(); });
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => {});
}

export const isRunning = () => running;

/* ------------------------------------------------------------------ voice */
export function pickVoice(appLang, voices) {
  const vs = voices || window.speechSynthesis?.getVoices?.() || [];
  const norm = (v) => (v.lang || '').toLowerCase().replace('_', '-');
  const find = (...pre) => vs.find((v) => pre.some((p) => norm(v).startsWith(p)));
  if (appLang === 'fil') {
    const f = find('fil', 'tl');
    return f ? { lang: 'fil', v: f } : { lang: 'en', v: find('en-ph', 'en-us', 'en') || null, fallback: true };
  }
  return { lang: 'en', v: find('en-ph', 'en-us', 'en') || null };
}
function say(text) {
  if (!voice.on || !text || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    if (voice.v) { u.voice = voice.v; u.lang = voice.v.lang; } else u.lang = voice.lang === 'fil' ? 'fil-PH' : 'en-US';
    u.rate = 1;
    speechSynthesis.cancel(); // the newest instruction is the only one that matters
    speechSynthesis.speak(u);
  } catch { /* voice is a bonus; the card always shows the instruction */ }
}
function chime() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.12);
  } catch { /* no audio */ }
  navigator.vibrate?.([180, 80, 180]);
}
function toggleVoice() {
  voice.on = !voice.on;
  if (!voice.on) speechSynthesis?.cancel();
  $('#nav-mute').textContent = voice.on ? '🔊' : '🔇';
  $('#nav-mute').setAttribute('aria-pressed', String(!voice.on));
}

/* ---------------------------------------------------------------- wake lock */
async function getWake() {
  try {
    if ('wakeLock' in navigator) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } else if (!wake) ctx.toast(t('navKeepScreen'), 6000);
  } catch { /* battery saver may refuse */ }
}
const releaseWake = () => { try { wake?.release(); } catch { /* ignore */ } wake = null; };

/* -------------------------------------------------------------------- start */
async function start(simulate) {
  const R = ctx.R;
  if (!R.res || !R.from || !R.to) return ctx.toast(t('needPoints'));
  if (!simulate && !isSecureContext) return ctx.toast(t('navHttps'), 6000);
  if (!simulate && !navigator.geolocation) return ctx.toast(t('geoFail'));
  try { speechSynthesis?.speak(Object.assign(new SpeechSynthesisUtterance(' '), { volume: 0 })); } catch { /* unlock iOS audio on the tap */ }
  const sel = R.res.routes[R.sel];
  try {
    const res = await fetchRoute(R.from, sel);
    const r = res.routes.reduce((a, b) => (Math.abs(b.distanceKm - sel.distanceKm) < Math.abs(a.distanceKm - sel.distanceKm) ? b : a));
    begin(r, { simulate });
  } catch (err) {
    ctx.toast(err.message || t('error'));
  }
}

function fetchRoute(from) {
  const R = ctx.R;
  return ctx.api('/api/route', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: ctx.S.mode, points: [from, R.to].map((p) => ({ lat: p.lat, lon: p.lon })), speedKn: R.speed, nav: true }),
  });
}

function begin(r, { simulate = false, rerouted = false } = {}) {
  const pv = pickVoice(getLang());
  voice.lang = pv.lang; voice.v = pv.v;
  if (pv.fallback && !rerouted) ctx.toast(t('navNoFil'), 6000);
  route = r;
  nav = new Nav(r, { mode: ctx.S.mode, lang: voice.lang, rerouted });
  arrivedShown = false;
  draw(r);
  if (!running) {
    running = true; follow = true;
    document.body.classList.add('navigating');
    ctx.closeSheet();
    $('#nav').hidden = false;
    $('#nav-sim').hidden = !simulate;
    $('#nav-simtag').hidden = !simulate;
    $('#nav-arrived').hidden = true;
    $('#nav-recenter').hidden = true;
    $('#nav-mute').textContent = voice.on ? '🔊' : '🔇';
    ctx.map.setZoom(Math.max(ctx.map.getZoom(), 16));
    getWake();
    repTimer = setInterval(pollReports, 45000);
    if (simulate) startSim(r); else startGps();
  } else if (simulate && sim) {
    sim.coords = r.full; sim.cum = cumulative(r.full); sim.along = 0;
  }
  showInitial();
}

function draw(r) {
  const L = ctx.L;
  ctx.routeLayer.clearLayers();
  navLayer.clearLayers().addTo(ctx.map);
  L.polyline(r.full, { color: '#020617', weight: 11, opacity: 0.6, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(navLayer);
  L.polyline(r.full, { color: '#22d3ee', weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(navLayer);
  (r.closures || []).forEach((c) => L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'rmark', html: `<span>${RP_ICON[c.type] || '⚠️'}</span>`, iconSize: [30, 30] }), interactive: false }).addTo(navLayer));
  (r.hazards || []).forEach((h) => L.circleMarker([h.lat, h.lon], { radius: 8, color: '#fff', weight: 2, fillColor: ['#22c55e', '#facc15', '#fb923c', '#ef4444'][h.level], fillOpacity: 1, interactive: false }).addTo(navLayer));
  const dest = r.full[r.full.length - 1];
  L.marker(dest, { icon: L.divIcon({ className: 'abm', html: 'B', iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false }).addTo(navLayer);
  if (!marker) marker = L.marker(r.full[0], { icon: L.divIcon({ className: 'me', html: '<svg viewBox="0 0 40 40" width="44" height="44"><circle cx="20" cy="20" r="17" fill="rgba(34,211,238,.25)"/><path d="M20 5 L30 31 L20 25 L10 31 Z" fill="#22d3ee" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>', iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: 1000, interactive: false });
  marker.setLatLng(r.full[0]).addTo(ctx.map);
  ctx.map.panTo(r.full[0]);
}

/* ---------------------------------------------------------------------- GPS */
function startGps() {
  $('#nav-gps').hidden = false;
  $('#nav-gps').textContent = t('navGpsWait');
  gpsTimer = setTimeout(() => { $('#nav-gps').hidden = false; $('#nav-gps').textContent = t('navGpsWeak'); }, 12000);
  watchId = navigator.geolocation.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed ?? undefined, heading: p.coords.heading ?? undefined, t: p.timestamp || Date.now() }),
    (err) => {
      if (err.code === 1) { ctx.toast(t('navGpsDenied'), 6000); stop(false); }
      else { $('#nav-gps').hidden = false; $('#nav-gps').textContent = t('navGpsWeak'); }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}

/* ---------------------------------------------------------------- simulator */
function startSim(r) {
  const mode = ctx.S.mode;
  sim = { coords: r.full, cum: cumulative(r.full), along: 0, mult: 5, kmh: mode === 'hiker' ? 5 : 40, devUntil: 0 };
  document.querySelectorAll('#nav-sim [data-act="nav-speed"]').forEach((b) => b.classList.toggle('on', +b.dataset.v === 5));
  simTimer = setInterval(() => {
    sim.along += (sim.kmh / 3.6) * 0.5 * sim.mult;
    const p = positionAt(sim.coords, sim.cum, sim.along);
    const dev = Date.now() < sim.devUntil ? 0.0014 : 0; // ~150 m sideways while "lost"
    onFix({ lat: p.lat, lon: p.lon + dev, acc: 8, speed: (sim.kmh / 3.6) * sim.mult, heading: p.heading, t: Date.now() });
  }, 500);
}

/* ------------------------------------------------------------------ updates */
function onFix(fix) {
  if (!running || !nav) return;
  lastFix = fix;
  clearTimeout(gpsTimer);
  $('#nav-gps').hidden = true;
  const st = nav.update(fix);
  render(st, fix);
  if (st.speak.length) {
    chime();
    say(st.speak.map((s) => s.text).join(' '));
  }
  if (st.offRoute) reroute(fix, false);
  if (st.arrived && !arrivedShown) { arrivedShown = true; arrive(); }
}

const fmtDist = (m) => (m >= 950 ? `${(m / 1000).toFixed(m >= 9950 ? 0 : 1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const arrowDeg = { straight: 0, 'slight right': 45, right: 90, 'sharp right': 135, uturn: 180, 'sharp left': -135, left: -90, 'slight left': -45 };

function arrowSVG(step) {
  if (step.ty === 'arrive') return '<svg viewBox="0 0 48 48" width="52" height="52"><path d="M24 4c-7 0-12 5-12 12 0 9 12 26 12 26s12-17 12-26c0-7-5-12-12-12z" fill="#fff"/><circle cx="24" cy="16" r="5" fill="#0b1630"/></svg>';
  if (step.ty === 'roundabout' || step.ty === 'rotary') return `<svg viewBox="0 0 48 48" width="52" height="52"><circle cx="24" cy="26" r="12" fill="none" stroke="#fff" stroke-width="5"/><path d="M24 2v12" stroke="#fff" stroke-width="5" stroke-linecap="round"/><text x="24" y="31" text-anchor="middle" fill="#fff" font-size="14" font-weight="700">${esc(step.ex || '')}</text></svg>`;
  const deg = step.ty === 'depart' ? 0 : arrowDeg[step.mo || 'straight'] ?? 0;
  return `<svg viewBox="0 0 48 48" width="52" height="52" style="transform:rotate(${deg}deg)"><path d="M24 6 L38 24 H29 V42 H19 V24 H10 Z" fill="#fff"/></svg>`;
}

function showInitial() {
  const first = route.steps[1] || route.steps[0];
  setCard(first, route.steps[1] ? route.steps[1].dist || 0 : 0, route.steps[2] || null);
  $('#nav-dist').textContent = '';
}

function setCard(step, dist, after, afterDist) {
  const L = getLang();
  $('#nav-arrow').innerHTML = arrowSVG(step);
  $('#nav-dist').textContent = dist ? fmtDist(dist) : '';
  $('#nav-text').textContent = describe(step, L);
  const then = $('#nav-then');
  if (after && after.ty !== 'depart') { then.hidden = false; then.textContent = `${t('navThen')}: ${describe(after, L)}${afterDist ? ` · ${fmtDist(afterDist)}` : ''}`; } else then.hidden = true;
}

function render(st, fix) {
  const L = getLang();
  if (route.sea && st.toDest) {
    const b = Math.round(st.toDest.bearing);
    $('#nav-arrow').innerHTML = `<svg viewBox="0 0 48 48" width="52" height="52" style="transform:rotate(${b}deg)"><path d="M24 6 L38 24 H29 V42 H19 V24 H10 Z" fill="#fff"/></svg>`;
    $('#nav-dist').textContent = `${(st.toDest.dist / 1852).toFixed(1)} nm`;
    $('#nav-text').textContent = `${t('navHeading')} ${b}° ${COMPASS[Math.round(b / 45) % 8]}`;
    $('#nav-then').hidden = true;
  } else {
    setCard(st.next, st.next.dist, st.after, st.after?.dist);
  }
  const eta = new Date(Date.now() + st.etaSec * 1000);
  $('#nav-eta').textContent = fmtT(eta.getTime() / 1000);
  $('#nav-min').textContent = `${Math.max(1, Math.round(st.etaSec / 60))} min`;
  $('#nav-km').textContent = route.sea ? `${(st.remaining / 1852).toFixed(1)} nm` : fmtDist(st.remaining);
  $('#nav-bar i').style.width = `${Math.round(st.progress * 100)}%`;
  $('#nav-spd').textContent = route.sea ? `${(st.speed * 1.944).toFixed(1)} kn` : `${Math.round(st.speed * 3.6)} km/h`;

  const hz = st.hazardsAhead[0];
  const box = $('#nav-haz');
  if (hz) { box.hidden = false; box.className = `navhaz ${hz.severe ? 'sev' : ''}`; box.textContent = `⚠ ${hazardLabel(hz, L)} · ${fmtDist(hz.dist)}`; } else box.hidden = true;
  const rr = $('#nav-rr');
  rr.hidden = !rerouting;
  if (rerouting) rr.textContent = t('navRerouting');

  const ll = st.offDist < 60 ? [st.snapped.lat, st.snapped.lon] : [fix.lat, fix.lon];
  marker.setLatLng(ll);
  const svg = marker.getElement()?.querySelector('svg');
  if (svg) svg.style.transform = `rotate(${st.heading || 0}deg)`;
  if (follow) ctx.map.panTo(ll, { animate: true, duration: 0.4, easeLinearity: 1 });
}

/* ----------------------------------------------------------------- reroute */
async function reroute(fix, forced) {
  const now = Date.now();
  if (rerouting || now - lastReroute < (forced ? 5000 : 15000) || route.sea) return;
  rerouting = true;
  lastReroute = now;
  $('#nav-rr').hidden = false;
  $('#nav-rr').textContent = t('navRerouting');
  if (now - spokeReroute > 30000) { spokeReroute = now; chime(); say(voice.lang === 'en' ? 'You left the route. Finding a new route.' : 'Lumihis ka sa ruta. Naghahanap ng bagong ruta.'); }
  try {
    const res = await fetchRoute({ lat: fix.lat, lon: fix.lon });
    const r = res.routes.find((x) => x.id === res.recommended) || res.routes[0];
    begin(r, { simulate: !!sim, rerouted: true });
    ctx.setDemo(res.demo);
  } catch {
    $('#nav-rr').textContent = t('navRerouteFail');
    setTimeout(() => { rerouting = false; }, 8000);
    return;
  }
  rerouting = false;
  $('#nav-rr').hidden = true;
}

/** New road reports appearing on the road ahead while driving. */
async function pollReports() {
  if (!running || !lastFix || route.sea) return;
  const d = 0.04;
  try {
    const { reports } = await ctx.api(`/api/reports?s=${(lastFix.lat - d).toFixed(3)}&n=${(lastFix.lat + d).toFixed(3)}&w=${(lastFix.lon - d).toFixed(3)}&e=${(lastFix.lon + d).toFixed(3)}`);
    for (const r of reports) {
      const severe = ['closed', 'flood', 'landslide'].includes(r.type);
      const ev = nav.addEvent({ id: `c${r.id}`, kind: r.type, lat: r.lat, lon: r.lon, severe });
      const ahead = ev ? ev.at - nav.along : 0;
      if (ev && severe && ahead > 200 && ahead < 8000) { reroute(lastFix, true); break; }
    }
  } catch { /* offline: keep driving on what we know */ }
}

/* -------------------------------------------------------------------- end */
function arrive() {
  $('#nav-arrived').hidden = false;
  $('#nav-sim').hidden = true;
}

export function stop(restore) {
  running = false;
  clearInterval(simTimer); simTimer = null; sim = null;
  clearInterval(repTimer); clearTimeout(gpsTimer);
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  releaseWake();
  try { speechSynthesis?.cancel(); } catch { /* ignore */ }
  navLayer.clearLayers();
  if (marker) ctx.map.removeLayer(marker);
  document.body.classList.remove('navigating');
  $('#nav').hidden = true;
  nav = null; rerouting = false;
  if (restore) { ctx.drawRoute(false); ctx.openTab('route'); }
}
