import { forecast, marine, river, riverSignal, isDemo } from './openmeteo.js';
import { assess, recordAt, findWindows, normMode, MODES } from './risk.js';
import { CITIES, SEAS, ZONES, zonesAt, nearestCity } from './places.js';
import { haversineKm, HttpError, KMH_TO_KN, levelOf } from './util.js';
import { TTLCache } from './cache.js';
import { fetchJSON } from './upstream.js';
import { reportsAround, reportsNear } from './reports.js';
import { mapOsrmSteps, stepsFromGeometry, zonesAlong } from './nav.js';

const hourNow = () => Math.floor(Date.now() / 1000 / 3600) * 3600;
const ctxFor = (lat, lon, extra = {}) => {
  const z = zonesAt(lat, lon);
  return { floodZone: z.some((x) => x.type === 'flood'), landslideZone: z.some((x) => x.type === 'landslide'), ...extra };
};
const pub = (a) => (a ? { score: a.score, level: a.level, reasons: a.reasons, sea: a.sea } : null);

function conditions(r) {
  if (!r) return null;
  return {
    t: r.t, temp: r.temp, appT: r.appT, precip: r.precip, prob: r.prob, code: r.code,
    windKmh: r.wind, windKn: r.wind == null ? null : +(r.wind * KMH_TO_KN).toFixed(1), dir: r.dir,
    gust: r.gust, gustKn: r.gust == null ? null : +(r.gust * KMH_TO_KN).toFixed(1), vis: r.vis,
    rain24: +r.rain24.toFixed(1), rain72: +r.rain72.toFixed(1), soil: r.soil,
    wave: r.wave ?? null, wdir: r.wdir ?? null, period: r.period ?? null, swell: r.swell ?? null,
    sdir: r.sdir ?? null, cur: r.cur ?? null, curdir: r.curdir ?? null,
  };
}

/* ------------------------------------------------------------------ point */
export async function pointReport({ lat, lon, mode }) {
  mode = normMode(mode);
  const [fcs, mrs, rv] = await Promise.all([
    forecast([{ lat, lon }], { full: true, prec: 0.01 }),
    marine([{ lat, lon }], { prec: 0.01 }),
    river(lat, lon),
  ]);
  const fc = fcs[0];
  const mr = mrs[0];
  const t0 = hourNow();
  const sig = riverSignal(rv, t0);
  const zones = zonesAt(lat, lon);
  const ctx = ctxFor(lat, lon, { riverTrend: sig?.trend || 0 });

  const nowRec = recordAt(fc, mr, t0, true);
  const modes = {};
  for (const m of MODES) modes[m] = pub(assess(nowRec, m, ctx));

  const timeline = [];
  for (let h = 0; h < 48; h++) {
    const rec = recordAt(fc, mr, t0 + h * 3600);
    if (!rec) break;
    const a = assess(rec, mode, ctx);
    timeline.push({
      t: rec.t, score: a.score, level: a.level, precip: rec.precip, gust: rec.gust,
      windKn: +(rec.wind * KMH_TO_KN).toFixed(1), wave: rec.wave ?? null, top: a.reasons[0]?.k || null,
    });
  }
  return {
    demo: isDemo(), lat, lon, elev: fc.elev, isSea: !!nowRec?.wave && mr?.hasData, nearest: nearestCity(lat, lon),
    zones: zones.map((z) => ({ id: z.id, n: z.n, type: z.type })), reports: reportsAround(lat, lon, 5),
    now: conditions(nowRec), mode, modes, timeline, windows: findWindows(timeline),
    river: sig ? { q: sig.q, peak: sig.peak, ratio: sig.ratio, trend: sig.trend } : null,
  };
}

/* ------------------------------------------------------------------- grid */
const STEPS = [0.1, 0.25, 0.5, 1, 2];
const bad = (m) => new HttpError(400, m);

export async function gridReport({ s, w, n, e, mode, withMarine }) {
  mode = normMode(mode);
  s = Math.max(s, 3); n = Math.min(n, 23); w = Math.max(w, 114); e = Math.min(e, 132);
  if (!(n > s && e > w)) throw bad('bbox outside coverage');
  const cells = (st) => (Math.ceil((e - w) / st) + 2) * (Math.ceil((n - s) / st) + 2);
  const step = STEPS.find((st) => cells(st) <= 140) || 2;
  const lat0 = +(Math.floor(s / step) * step).toFixed(4);
  const lon0 = +(Math.floor(w / step) * step).toFixed(4);
  const ny = Math.ceil((n - lat0) / step) + 1;
  const nx = Math.ceil((e - lon0) / step) + 1;
  const pts = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push({ lat: +(lat0 + j * step).toFixed(4), lon: +(lon0 + i * step).toFixed(4) });

  const [fcs, mrs] = await Promise.all([forecast(pts, { full: false }), withMarine ? marine(pts) : null]);
  const t0 = hourNow();
  const F = { precip: [], rain24: [], windKn: [], windDir: [], gust: [], wave: [], waveDir: [], risk: [], flood: [], waveRisk: [], windRisk: [] };
  pts.forEach((p, k) => {
    const rec = recordAt(fcs[k], mrs ? mrs[k] : null, t0, true);
    const ctx = ctxFor(p.lat, p.lon);
    const a = assess(rec, mode, ctx);
    const g = assess(rec, 'general', ctx);
    F.precip.push(rec.precip);
    F.rain24.push(+rec.rain24.toFixed(1));
    F.windKn.push(+(rec.wind * KMH_TO_KN).toFixed(1));
    F.windDir.push(rec.dir);
    F.gust.push(rec.gust);
    F.wave.push(rec.wave ?? null);
    F.waveDir.push(rec.wdir ?? null);
    F.risk.push(a.score);
    F.flood.push(Math.round(g.comps.flood));
    F.waveRisk.push(g.comps.wave == null ? null : Math.round(g.comps.wave));
    F.windRisk.push(Math.round(Math.max(g.comps.gust || 0, g.comps.wind || 0)));
  });
  return { demo: isDemo(), t: t0, mode, step, lat0, lon0, nx, ny, fields: F };
}

/* ------------------------------------------------------------------ route */
async function osrm(mode, pts, nav) {
  const host = mode === 'hiker' ? 'https://routing.openstreetmap.de/routed-foot' : 'https://router.project-osrm.org';
  const coords = pts.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const alt = pts.length === 2 ? '3' : 'false';
  const j = await fetchJSON(`${host}/route/v1/driving/${coords}?alternatives=${alt}&overview=full&geometries=geojson&steps=${nav ? 'true' : 'false'}`, { timeout: 15000 });
  if (j.code !== 'Ok' || !j.routes?.length) throw new HttpError(404, 'No route found between those points');
  return j.routes.map((r) => {
    const coords = r.geometry.coordinates.map(([lo, la]) => [la, lo]);
    return { distance: r.distance, duration: r.duration, coords, steps: nav ? mapOsrmSteps(r.legs, coords) : null };
  });
}

function line(a, b, n) {
  return Array.from({ length: n + 1 }, (_, i) => [a.lat + ((b.lat - a.lat) * i) / n, a.lon + ((b.lon - a.lon) * i) / n]);
}

/** Straight-ish placeholder routes when the routing service is unreachable in demo mode. */
function demoRoutes(pts, mode) {
  const a = pts[0], b = pts[pts.length - 1];
  const km = haversineKm(a, b) * 1.25;
  const speed = mode === 'hiker' ? 4 : 40;
  return [0, 0.25, -0.25].map((bulge, k) => {
    let c = line(a, b, 40);
    if (bulge) {
      // one corner: a -> W -> b, where W is pushed sideways from the midpoint
      const w = { lat: (a.lat + b.lat) / 2 - (b.lon - a.lon) * bulge * 1.2, lon: (a.lon + b.lon) / 2 + (b.lat - a.lat) * bulge * 1.2 };
      c = line(a, w, 40).concat(line(w, b, 40).slice(1));
    }
    return { distance: km * 1000 * (1 + Math.abs(bulge) * 0.3), duration: ((km * (1 + Math.abs(bulge) * 0.3)) / speed) * 3600 * (k === 0 ? 1 : 1.1), coords: c };
  });
}

function seaLeg(pts, speedKn) {
  const a = pts[0], b = pts[pts.length - 1];
  const km = haversineKm(a, b);
  return [{ distance: km * 1000, duration: (km / 1.852 / speedKn) * 3600, coords: line(a, b, Math.max(8, Math.ceil(km / 4))), sea: true }];
}

function sampleRoute(coords, totalKm) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm({ lat: coords[i - 1][0], lon: coords[i - 1][1] }, { lat: coords[i][0], lon: coords[i][1] }));
  const total = cum[cum.length - 1] || 1;
  const count = Math.min(16, Math.max(4, Math.ceil(totalKm / 8)));
  const out = [];
  let j = 0;
  for (let s = 0; s < count; s++) {
    const target = (total * s) / (count - 1);
    while (j < cum.length - 1 && cum[j] < target) j++;
    out.push({ lat: coords[j][0], lon: coords[j][1], frac: target / total, km: +((totalKm * target) / total).toFixed(1) });
  }
  return out;
}

const thin = (coords, max = 500) => {
  if (coords.length <= max) return coords;
  const k = Math.ceil(coords.length / max);
  const o = coords.filter((_, i) => i % k === 0);
  if (o[o.length - 1] !== coords[coords.length - 1]) o.push(coords[coords.length - 1]);
  return o;
};

export async function routeReport({ mode, points, speedKn = 8, nav = false }) {
  mode = normMode(mode);
  if (!Array.isArray(points) || points.length < 2 || points.length > 5) throw bad('Need 2-5 points');
  const pts = points.map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }));
  if (pts.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) throw bad('Invalid coordinates');

  let raw;
  const sea = mode === 'fisher';
  if (sea) raw = seaLeg(pts, Math.min(40, Math.max(2, Number(speedKn) || 8)));
  else {
    try {
      raw = await osrm(mode, pts, nav);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (!isDemo()) throw new HttpError(502, 'Routing service is unreachable right now');
      raw = demoRoutes(pts, mode);
    }
  }
  raw = raw.slice(0, 3);

  const routes = raw.map((r) => {
    const km = r.distance / 1000;
    return { ...r, km, durH: Math.max(0.05, r.duration / 3600), samples: sampleRoute(r.coords, km) };
  });
  const all = routes.flatMap((r) => r.samples);
  const [fcs, mrs] = await Promise.all([forecast(all, { full: true, prec: 0.05 }), sea ? marine(all, { prec: 0.05 }) : null]);

  const t0 = hourNow();
  let off = 0;
  const result = routes.map((r, idx) => {
    const sfc = fcs.slice(off, off + r.samples.length);
    const smr = mrs ? mrs.slice(off, off + r.samples.length) : null;
    off += r.samples.length;
    const scoreAt = (d) => {
      const per = r.samples.map((s, i) => {
        const t = t0 + Math.round(d + s.frac * r.durH) * 3600;
        const rec = recordAt(sfc[i], smr ? smr[i] : null, t, true);
        return { rec, a: assess(rec, mode, ctxFor(s.lat, s.lon)) };
      });
      const sc = per.map((p) => p.a.score);
      const mean = sc.reduce((x, y) => x + y, 0) / sc.length;
      return { per, score: Math.round(0.65 * Math.max(...sc) + 0.35 * mean) };
    };
    const now = scoreAt(0);
    const departures = [];
    for (let d = 0; d <= 12; d++) {
      const sc = d === 0 ? now.score : scoreAt(d).score;
      departures.push({ h: d, t: t0 + d * 3600, score: sc, level: levelOf(sc) });
    }
    const samples = r.samples.map((s, i) => {
      const { rec, a } = now.per[i];
      return {
        lat: s.lat, lon: s.lon, km: s.km, etaMin: Math.round(s.frac * r.durH * 60), score: a.score, level: a.level,
        reasons: a.reasons.slice(0, 2), land: sea && !a.sea, windKn: +(rec.wind * KMH_TO_KN).toFixed(0), wave: rec.wave ?? null, precip: rec.precip,
      };
    });
    // Community road reports on the route (closed / flooded / landslide / fallen / damaged) push its score up.
    const geometry = thin(r.coords);
    const closures = sea ? [] : reportsNear(geometry, 0.5);
    const pen = Math.min(40, closures.reduce((s, c) => s + (['closed', 'flood', 'landslide'].includes(c.type) ? 30 : 15), 0));
    const bump = (v) => Math.min(100, v + pen);
    const extra = nav ? { full: r.coords, steps: r.steps && r.steps.length > 1 ? r.steps : stepsFromGeometry(r.coords) } : {};
    return {
      id: idx, sea, distanceKm: +r.km.toFixed(1), durationMin: Math.round(r.durH * 60), geometry, ...extra,
      zones: sea ? [] : zonesAlong(r.coords),
      samples, hazards: samples.filter((s) => s.score >= 50), crossesLand: samples.some((s) => s.land),
      closures, scoreNow: bump(now.score), levelNow: levelOf(bump(now.score)),
      departures: departures.map((d) => ({ ...d, score: bump(d.score), level: levelOf(bump(d.score)) })),
    };
  });

  const fastest = result.reduce((a, b) => (b.durationMin < a.durationMin ? b : a));
  const safest = result.reduce((a, b) => (b.scoreNow < a.scoreNow ? b : a));
  const cost = (r) => r.scoreNow + 25 * (r.durationMin / fastest.durationMin - 1);
  const rec = result.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  result.forEach((r) => {
    r.tags = [];
    if (r.id === rec.id) r.tags.push('recommended');
    if (r.id === fastest.id) r.tags.push('fastest');
    if (r.id === safest.id) r.tags.push('safest');
  });
  const bestDep = rec.departures.reduce((a, b) => (b.score < a.score ? b : a));
  let action = 'caution';
  if (rec.scoreNow < 25) action = 'go';
  else if (bestDep.score < 25 && bestDep.h > 0) action = 'wait';
  else if (rec.scoreNow >= 75 && bestDep.score >= 50) action = 'avoid';
  return { demo: isDemo(), mode, recommended: rec.id, advice: { action, waitH: bestDep.h, bestScore: bestDep.score }, routes: result };
}

/* ----------------------------------------------------------------- alerts */
const ALERTS = new TTLCache(10 * 60e3, 4);

export function alertsReport() {
  return ALERTS.wrap('a', async () => {
    const pts = [...CITIES, ...SEAS];
    const [fcs, mrs] = await Promise.all([forecast(pts, { full: false }), marine(SEAS)]);
    const t0 = hourNow();
    const out = [];
    pts.forEach((p, k) => {
      const isSea = k >= CITIES.length;
      const mode = isSea ? 'fisher' : 'general';
      const mr = isSea ? mrs[k - CITIES.length] : null;
      const ctx = ctxFor(p.lat, p.lon);
      let peak = null;
      for (let h = 0; h < 12; h++) {
        const rec = recordAt(fcs[k], mr, t0 + h * 3600);
        const a = rec && assess(rec, mode, ctx);
        if (a && (!peak || a.score > peak.a.score)) peak = { a, t: rec.t };
      }
      if (peak && peak.a.level >= 1) out.push({ name: p.n, lat: p.lat, lon: p.lon, type: isSea ? 'sea' : 'land', score: peak.a.score, level: peak.a.level, peakT: peak.t, reasons: peak.a.reasons.slice(0, 3) });
    });
    out.sort((a, b) => b.score - a.score);
    return { demo: isDemo(), t: Date.now(), alerts: out.slice(0, 40) };
  });
}

/* ----------------------------------------------------------------- storms */
const STORMS = new TTLCache(30 * 60e3, 2);

export function stormsReport() {
  return STORMS.wrap('s', async () => {
    try {
      if (process.env.TERRAVUE_DEMO === '1') return { storms: [], source: 'demo' };
      const j = await fetchJSON('https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP', { timeout: 10000 });
      const storms = (j.features || [])
        .filter((f) => f.properties?.eventtype === 'TC' && f.geometry?.type === 'Point')
        .map((f) => {
          const p = f.properties;
          const [lon, lat] = f.geometry.coordinates;
          return {
            id: p.eventid, name: p.name || p.eventname || 'Tropical cyclone', level: p.alertlevel || 'Green',
            lat, lon, from: p.fromdate, to: p.todate, current: String(p.iscurrent) === 'true',
            severity: p.severitydata?.severitytext || p.description || '', url: p.url?.report || p.url?.details || null,
          };
        })
        .filter((s) => s.current && s.lon > 90 && s.lon < 180 && s.lat > -5 && s.lat < 45);
      return { storms, source: 'GDACS' };
    } catch (err) {
      return { storms: [], source: 'GDACS', error: 'unavailable' };
    }
  });
}

/* ---------------------------------------------------------------- geocode */
const GEO = new TTLCache(24 * 3600e3, 3000);
let nominatimGate = Promise.resolve();

export function geocode(q) {
  q = String(q || '').trim().slice(0, 80);
  if (q.length < 2) return Promise.resolve({ results: [] });
  return GEO.wrap(q.toLowerCase(), async () => {
    let results = [];
    try {
      const j = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json&countryCode=PH`);
      results = (j.results || []).map((r) => ({
        name: [r.name, r.admin2 || r.admin1].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude,
      }));
    } catch { /* fall through to Nominatim */ }
    if (!results.length) {
      nominatimGate = nominatimGate.then(() => new Promise((r) => setTimeout(r, 1100)));
      await nominatimGate;
      try {
        const j = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=ph&limit=6`);
        results = j.map((r) => ({ name: r.display_name.split(', ').slice(0, 3).join(', '), lat: +r.lat, lon: +r.lon }));
      } catch { /* none */ }
    }
    return { results };
  });
}

export const hazardZones = () => ZONES.map((z) => ({ id: z.id, n: z.n, type: z.type, lat: z.lat, lon: z.lon, r: z.r }));
