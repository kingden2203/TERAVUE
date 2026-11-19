/**
 * Open-Meteo client (forecast, marine, river discharge) with per-point caching,
 * batching, stale-on-error and a clearly-flagged demo fallback.
 * Free API: https://open-meteo.com  (non-commercial use). Set OPEN_METEO_API_KEY for a commercial plan.
 */
import { TTLCache } from './cache.js';
import { fetchJSON } from './upstream.js';
import { snap } from './util.js';
import * as demo from './demo.js';

const KEY = process.env.OPEN_METEO_API_KEY || '';
const base = (p) => (KEY ? `https://customer-${p}.open-meteo.com` : `https://${p}.open-meteo.com`);
const keyq = KEY ? `&apikey=${encodeURIComponent(KEY)}` : '';

export const status = {
  demoForced: process.env.TERRAVUE_DEMO === '1',
  demoAt: 0,
  lastError: null,
};
export const isDemo = () => status.demoForced || Date.now() - status.demoAt < 5 * 60e3;

const FC_CACHE = new TTLCache(15 * 60e3, 20000);
const MR_CACHE = new TTLCache(30 * 60e3, 10000);
const RV_CACHE = new TTLCache(3 * 3600e3, 2000);

const LIGHT = ['precipitation', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'weather_code', 'soil_moisture_0_to_7cm', 'cape'];
const FULL = [...LIGHT, 'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'visibility'];
const MR_VARS = ['wave_height', 'wave_direction', 'wave_period', 'swell_wave_height', 'swell_wave_direction', 'swell_wave_period', 'wind_wave_height', 'ocean_current_velocity', 'ocean_current_direction'];
const EMPTY_MR = { t0: 0, n: 0, hasData: false, wave: [] };

const lonlat = (locs) => `latitude=${locs.map((l) => l.lat).join(',')}&longitude=${locs.map((l) => l.lon).join(',')}`;

async function getMany({ points, prec, cache, prefix, chunk, fetchChunk, demoOne }) {
  const keyOf = (p) => `${prefix}:${snap(p.lat, prec)},${snap(p.lon, prec)}`;
  const res = new Array(points.length);
  const need = new Map();
  points.forEach((p, i) => {
    const k = keyOf(p);
    const hit = cache.get(k);
    if (hit !== undefined) res[i] = hit;
    else if (!need.has(k)) need.set(k, { lat: snap(p.lat, prec), lon: snap(p.lon, prec) });
  });
  if (!need.size) return res;

  const entries = [...need.entries()];
  const chunks = [];
  for (let i = 0; i < entries.length; i += chunk) chunks.push(entries.slice(i, i + chunk));
  const got = new Map();
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      try {
        if (status.demoForced) throw new Error('demo forced');
        const arr = await fetchChunk(c.map((e) => e[1]));
        c.forEach(([k], j) => {
          cache.set(k, arr[j]);
          got.set(k, arr[j]);
        });
      } catch (err) {
        if (!status.demoForced) status.lastError = String(err.message || err);
        for (const [k, loc] of c) {
          const stale = cache.get(k, true);
          const v = stale !== undefined ? stale : demoOne(loc);
          if (v && v.demo) status.demoAt = Date.now();
          got.set(k, v);
        }
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  points.forEach((p, i) => {
    if (res[i] === undefined) res[i] = got.get(keyOf(p));
  });
  return res;
}

function normFc(j) {
  const h = j.hourly;
  return {
    lat: j.latitude, lon: j.longitude, elev: j.elevation, t0: h.time[0], n: h.time.length,
    precip: h.precipitation, wind: h.wind_speed_10m, dir: h.wind_direction_10m, gust: h.wind_gusts_10m,
    code: h.weather_code, soil: h.soil_moisture_0_to_7cm, cape: h.cape, temp: h.temperature_2m,
    appT: h.apparent_temperature, prob: h.precipitation_probability, vis: h.visibility,
  };
}

/** @param {{lat:number,lon:number}[]} points @returns {Promise<object[]>} one series per point */
export function forecast(points, { full = false, prec = 0.05 } = {}) {
  return getMany({
    points, prec, cache: FC_CACHE, prefix: full ? 'f' : 'l', chunk: 25,
    demoOne: (loc) => demo.forecastSeries(loc.lat, loc.lon, full),
    fetchChunk: async (locs) => {
      const url =
        `${base('api')}/v1/forecast?${lonlat(locs)}&hourly=${(full ? FULL : LIGHT).join(',')}` +
        `&wind_speed_unit=kmh&timezone=Asia%2FManila&timeformat=unixtime` +
        `&past_days=${full ? 3 : 2}&forecast_days=${full ? 4 : 2}${keyq}`;
      const j = await fetchJSON(url);
      return (Array.isArray(j) ? j : [j]).map(normFc);
    },
  });
}

function normMr(j) {
  const h = j?.hourly;
  if (!h || !h.wave_height) return EMPTY_MR;
  return {
    t0: h.time[0], n: h.time.length, hasData: h.wave_height.some((v) => v != null),
    wave: h.wave_height, wdir: h.wave_direction, period: h.wave_period, swell: h.swell_wave_height,
    sdir: h.swell_wave_direction, speriod: h.swell_wave_period, wwave: h.wind_wave_height,
    cur: h.ocean_current_velocity, curdir: h.ocean_current_direction,
  };
}

/** Marine series (wave height etc). `hasData=false` means land / no sea cell. */
export function marine(points, { prec = 0.05 } = {}) {
  const url = (locs) =>
    `${base('marine-api')}/v1/marine?${lonlat(locs)}&hourly=${MR_VARS.join(',')}` +
    `&timezone=Asia%2FManila&timeformat=unixtime&past_days=1&forecast_days=4&cell_selection=nearest${keyq}`;
  return getMany({
    points, prec, cache: MR_CACHE, prefix: 'm', chunk: 25,
    demoOne: (loc) => demo.marineSeries(loc.lat, loc.lon),
    fetchChunk: async (locs) => {
      try {
        const j = await fetchJSON(url(locs));
        return (Array.isArray(j) ? j : [j]).map(normMr);
      } catch (err) {
        if (err.status !== 400) throw err;
        // one land-locked point can make the whole batch 400: retry individually
        return Promise.all(
          locs.map((l) => fetchJSON(url([l])).then(normMr).catch((e) => {
            if (e.status === 400) return EMPTY_MR;
            throw e;
          })),
        );
      }
    },
  });
}

/** River discharge (GloFAS via Open-Meteo flood API). Returns null when unavailable. */
export async function river(lat, lon) {
  if (status.demoForced) return null;
  const k = `${snap(lat, 0.05)},${snap(lon, 0.05)}`;
  try {
    return await RV_CACHE.wrap(k, async () => {
      const url =
        `${base('flood-api')}/v1/flood?latitude=${snap(lat, 0.05)}&longitude=${snap(lon, 0.05)}` +
        `&daily=river_discharge&past_days=3&forecast_days=7&timeformat=unixtime${keyq}`;
      const j = await fetchJSON(url);
      const q = j?.daily?.river_discharge;
      if (!q || !q.some((v) => v != null)) return null;
      return { t: j.daily.time, q };
    });
  } catch {
    return null;
  }
}

/** How fast is the river rising? Returns {trend: 0..30 risk points, q, peak} or null. */
export function riverSignal(rv, nowSec) {
  if (!rv) return null;
  const idx = rv.t.findIndex((t) => t + 86400 > nowSec);
  if (idx < 3) return null;
  const past = rv.q.slice(Math.max(0, idx - 3), idx).filter((v) => v != null);
  const fut = rv.q.slice(idx, idx + 4).filter((v) => v != null);
  if (!past.length || !fut.length) return null;
  const avgPast = past.reduce((a, b) => a + b, 0) / past.length;
  const peak = Math.max(...fut);
  if (peak < 20) return null; // not a real river at this point
  const ratio = peak / Math.max(1, avgPast);
  const trend = ratio >= 4 ? 30 : ratio >= 2.5 ? 20 : ratio >= 1.5 ? 10 : 0;
  return { trend, q: +(rv.q[idx] ?? avgPast).toFixed(1), peak: +peak.toFixed(1), ratio: +ratio.toFixed(2) };
}

const EL_CACHE = new TTLCache(7 * 24 * 3600e3, 20000);

/** Terrain elevation (m) for each point (Copernicus 90 m DEM via Open-Meteo). */
export async function elevation(points) {
  const out = new Array(points.length);
  const need = [];
  points.forEach((p, i) => {
    const k = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const hit = EL_CACHE.get(k);
    if (hit !== undefined) out[i] = hit;
    else need.push([i, k, p]);
  });
  for (let c = 0; c < need.length; c += 100) {
    const chunk = need.slice(c, c + 100);
    let vals;
    if (status.demoForced) vals = chunk.map(([, , p]) => demo.elevationAt(p.lat, p.lon));
    else {
      const url = `${base('api')}/v1/elevation?latitude=${chunk.map(([, , p]) => p.lat.toFixed(4)).join(',')}&longitude=${chunk.map(([, , p]) => p.lon.toFixed(4)).join(',')}${keyq}`;
      vals = (await fetchJSON(url)).elevation;
    }
    chunk.forEach(([i, k], j) => {
      out[i] = vals[j];
      EL_CACHE.set(k, vals[j]);
    });
  }
  return out;
}
