/**
 * Hiking trails (OpenStreetMap via Overpass) and elevation profiles (Open-Meteo / Copernicus 90 m DEM).
 * Overpass etiquette: identify ourselves, cache 24 h, small bbox only, no parallel queries, pause on 429.
 */
import { fetchJSON } from './upstream.js';
import { TTLCache } from './cache.js';
import { haversineKm, HttpError, snap } from './util.js';
import { elevation, status } from './openmeteo.js';
import { pointReport } from './service.js';
import { MODES } from './risk.js';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const TRAIL_CACHE = new TTLCache(24 * 3600e3, 300);
const MAX_SPAN = 0.4; // degrees
let pausedUntil = 0;
let gate = Promise.resolve();

const SAC = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3, alpine_hiking: 4, demanding_alpine_hiking: 5, difficult_alpine_hiking: 6 };

function queryFor(s, w, n, e) {
  const b = `${s},${w},${n},${e}`;
  return (
    `[out:json][timeout:25][maxsize:33554432];(` +
    `way["highway"~"^(path|footway|track)$"]["footway"!~"^(sidewalk|crossing)$"]["name"](${b});` +
    `way["highway"="path"]["sac_scale"](${b});` +
    `);out tags geom 700;`
  );
}

async function overpass(query) {
  if (Date.now() < pausedUntil) throw new HttpError(503, 'Trail data is busy. Try again in a minute.');
  // one query at a time (Overpass fair-use)
  const run = gate.then(async () => {
    let last;
    for (const url of OVERPASS) {
      try {
        return await fetchJSON(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout: 30000, retries: 0 });
      } catch (err) {
        last = err;
        if (err.status === 429 || err.status === 406) { pausedUntil = Date.now() + 30000; break; }
      }
    }
    throw new HttpError(503, 'Trail data is unavailable right now');
  });
  gate = run.catch(() => {});
  return run;
}

const lineKm = (pts) => pts.reduce((s, p, i) => (i ? s + haversineKm({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: p[0], lon: p[1] }) : 0), 0);
function thin(pts, max = 60) {
  if (pts.length <= max) return pts;
  const k = (pts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * k)]);
}

/** Overpass elements -> one entry per trail name, with its separate line pieces. */
export function groupTrails(elements) {
  const groups = new Map();
  for (const el of elements || []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tg = el.tags || {};
    const key = (tg.name || tg.ref || '').trim() || `~${el.id}`;
    const pts = el.geometry.map((g) => [+g.lat.toFixed(5), +g.lon.toFixed(5)]);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { id: el.id, name: tg.name || tg.ref || null, sac: 0, surface: tg.surface || null, lines: [], km: 0, kind: tg.highway }));
    g.lines.push(pts);
    g.km += lineKm(pts);
    g.sac = Math.max(g.sac, SAC[tg.sac_scale] || 0);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, km: +g.km.toFixed(2), lines: g.lines.map((l) => thin(l)).slice(0, 40), start: g.lines[0][0] }))
    .filter((g) => g.km >= 0.2)
    .sort((a, b) => (b.sac > 0) - (a.sac > 0) || b.km - a.km);
}

export async function trailsReport({ s, w, n, e }) {
  if (n - s > MAX_SPAN || e - w > MAX_SPAN) throw new HttpError(400, 'Zoom in to see trails');
  if (status.demoForced) return demoTrails({ s, w, n, e });
  // snap outward so neighbouring views share a cache entry
  const q = [snap(s - 0.025, 0.05), snap(w - 0.025, 0.05), snap(n + 0.025, 0.05), snap(e + 0.025, 0.05)];
  const key = q.join(',');
  const data = await TRAIL_CACHE.wrap(key, async () => {
    const j = await overpass(queryFor(...q));
    const all = groupTrails(j.elements);
    return { trails: all.slice(0, 120), truncated: all.length > 120 };
  });
  return { demo: false, ...data };
}

function demoTrails({ s, w, n, e }) {
  const cLat = (s + n) / 2, cLon = (w + e) / 2;
  const mk = (id, name, sac, ang, len) => {
    const pts = Array.from({ length: 25 }, (_, i) => {
      const f = i / 24;
      return [+(cLat + Math.sin(ang) * len * f + 0.004 * Math.sin(f * 9)).toFixed(5), +(cLon + Math.cos(ang) * len * f + 0.004 * Math.cos(f * 7)).toFixed(5)];
    });
    return { id, name, sac, surface: null, lines: [pts], km: +lineKm(pts).toFixed(2), start: pts[0], kind: 'path' };
  };
  return { demo: true, truncated: false, trails: [mk(1, 'Sample Summit Trail', 2, 0.6, 0.05), mk(2, 'Sample Ridge Loop', 3, 2.4, 0.04), mk(3, 'Sample Falls Path', 1, 4.1, 0.03)] };
}

/* --------------------------------------------------------- elevation profile */
function resample(pts, count) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm({ lat: pts[i - 1].lat, lon: pts[i - 1].lon }, pts[i]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 1;
  for (let k = 0; k < count; k++) {
    const d = (total * k) / (count - 1);
    while (j < pts.length - 1 && cum[j] < d) j++;
    const span = cum[j] - cum[j - 1] || 1;
    const f = Math.min(1, Math.max(0, (d - cum[j - 1]) / span));
    out.push({ lat: pts[j - 1].lat + (pts[j].lat - pts[j - 1].lat) * f, lon: pts[j - 1].lon + (pts[j].lon - pts[j - 1].lon) * f, km: d });
  }
  return { pts: out, total };
}

/** Lightly smooth, then count climbing/descending only for changes bigger than a 3 m dead-band (DEM noise). */
export function gainLoss(el) {
  const sm = el.map((_, i) => {
    const a = el[Math.max(0, i - 1)], b = el[i], c = el[Math.min(el.length - 1, i + 1)];
    return 0.25 * a + 0.5 * b + 0.25 * c; // light smoothing keeps summits from being shaved off
  });
  let gain = 0, loss = 0, ref = sm[0];
  for (const v of sm.slice(1)) {
    if (v - ref >= 3) { gain += v - ref; ref = v; }
    else if (ref - v >= 3) { loss += ref - v; ref = v; }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

export async function profileReport({ points }) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 300) throw new HttpError(400, 'Need 2-300 points');
  const pts = points.map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }));
  if (pts.some((p) => !(p.lat >= 1 && p.lat <= 26 && p.lon >= 112 && p.lon <= 134))) throw new HttpError(400, 'Invalid coordinates');
  const { pts: rs, total } = resample(pts, Math.min(80, Math.max(12, Math.ceil(pointsKm(pts) * 4))));
  if (total < 0.05) throw new HttpError(400, 'Trail is too short');
  let el;
  try { el = await elevation(rs); } catch { throw new HttpError(502, 'Elevation service is unavailable right now'); }
  if (el.some((v) => v == null)) throw new HttpError(502, 'Elevation data is incomplete');
  const { gain, loss } = gainLoss(el);
  const top = el.indexOf(Math.max(...el));
  const hours = total / 5 + gain / 600 + loss / 1800; // Naismith with a small descent allowance
  const summit = rs[top];
  let sum = null;
  try {
    const r = await pointReport({ lat: summit.lat, lon: summit.lon, mode: 'hiker' });
    sum = { lat: summit.lat, lon: summit.lon, elev: Math.round(el[top]), risk: r.modes.hiker, windows: r.windows, zones: r.zones, now: r.now };
  } catch { /* weather is a bonus; the profile still stands */ }
  return {
    demo: status.demoForced, km: +total.toFixed(2), gain, loss, min: Math.round(Math.min(...el)), max: Math.round(Math.max(...el)),
    hours: +hours.toFixed(1), profile: rs.map((p, i) => [+p.km.toFixed(3), Math.round(el[i])]), summit: sum, modes: MODES.length,
  };
}
const pointsKm = (pts) => pts.reduce((s, p, i) => (i ? s + haversineKm(pts[i - 1], p) : 0), 0);
