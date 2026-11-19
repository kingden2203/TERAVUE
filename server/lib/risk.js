/**
 * TERRAVUE risk engine.
 * Turns an hourly weather/sea record into a 0-100 hazard score per travel mode.
 * Thresholds are practical heuristics loosely based on PAGASA rainfall / wind / wave
 * categories. They are NOT an official warning; the UI says so.
 */
import { ramp, clamp, levelOf, KMH_TO_KN } from './util.js';

const RAIN = [[0, 0], [0.5, 3], [2.5, 15], [7.5, 35], [15, 60], [30, 90], [50, 100]]; // mm/h
const GUST = [[0, 0], [30, 5], [50, 30], [62, 50], [89, 75], [118, 100]]; // km/h
const SEAWIND = [[0, 0], [10, 5], [15, 20], [20, 40], [25, 60], [33, 85], [40, 100]]; // knots
const WAVE = [[0, 0], [0.5, 5], [1, 20], [1.5, 40], [2, 60], [2.5, 80], [3.5, 100]]; // metres (small boats)
const VIS = [[200, 90], [1000, 60], [2000, 35], [5000, 12], [10000, 0]]; // metres
const HEAT = [[33, 0], [38, 20], [41, 45], [45, 75], [52, 100]]; // apparent temp C
const FLOOD_RAIN = [[0, 0], [30, 10], [60, 30], [100, 55], [150, 75], [250, 100]]; // mm in ~24h
const SLIDE_RAIN = [[0, 0], [80, 12], [150, 38], [250, 70], [350, 100]]; // mm in ~72h

/** How much each hazard matters for each kind of traveller. */
export const MODE_WEIGHTS = {
  general: { rain: 1, gust: 1, thunder: 1, vis: 0.7, flood: 1, landslide: 0.8, heat: 0.5, wave: 0.8, wind: 0.5 },
  motorcycle: { rain: 1.15, gust: 1.1, thunder: 1, vis: 1, flood: 1.1, landslide: 0.8, heat: 0.3 },
  hiker: { rain: 1, gust: 0.9, thunder: 1.2, vis: 0.8, flood: 1, landslide: 1.1, heat: 1 },
  fisher: { rain: 0.6, gust: 0.6, thunder: 1.1, vis: 0.8, wave: 1, wind: 1 },
};
export const MODES = Object.keys(MODE_WEIGHTS);
export const normMode = (m) => (MODE_WEIGHTS[m] ? m : 'general');

function thunder(r) {
  if (r.code >= 96) return 85;
  if (r.code >= 95) return 75;
  if (r.cape >= 1500 && r.prob >= 50) return 45;
  if (r.code >= 80 && r.code <= 82) return 15;
  return 0;
}

function flood(r, ctx) {
  let s = ramp(r.rain24, FLOOD_RAIN);
  if (r.soil != null && r.soil > 0.4) s += ramp(r.soil, [[0.4, 0], [0.5, 12]]);
  s += ramp(r.precip, [[7.5, 0], [30, 15]]); // flash-flood push from heavy rain right now
  if (ctx.floodZone && r.rain24 >= 30) s += 15;
  if (ctx.riverTrend) s += ctx.riverTrend;
  if (r.elev != null && r.elev > 600) s *= 0.6;
  return clamp(s);
}

function landslide(r, ctx) {
  const base = ramp(r.rain72, SLIDE_RAIN);
  const terrain = r.elev >= 300 || ctx.landslideZone ? 1 : 0.25;
  return clamp(base * terrain * (ctx.landslideZone ? 1.25 : 1));
}

/** @returns {{score:number, level:number, comps:Object, reasons:Array, sea:boolean}|null} */
export function assess(r, mode = 'general', ctx = {}) {
  if (!r) return null;
  const w = MODE_WEIGHTS[normMode(mode)];
  const kn = r.wind == null ? null : r.wind * KMH_TO_KN;
  const sea = r.wave != null;
  const raw = {
    rain: ramp(r.precip, RAIN),
    gust: ramp(r.gust, GUST),
    thunder: thunder(r),
    vis: r.vis == null ? 0 : ramp(r.vis, VIS),
    flood: flood(r, ctx),
    landslide: landslide(r, ctx),
    heat: ramp(r.appT, HEAT),
  };
  if (sea) {
    raw.wave = ramp(r.wave, WAVE);
    raw.wind = ramp(kn, SEAWIND);
  }
  const vals = {
    rain: r.precip, gust: r.gust, thunder: null, vis: r.vis == null ? null : r.vis / 1000,
    flood: r.rain24, landslide: r.rain72, heat: r.appT, wave: r.wave, wind: kn,
  };
  const comps = {};
  for (const k of Object.keys(raw)) if (w[k]) comps[k] = clamp(raw[k] * w[k]);
  const arr = Object.values(comps);
  let score = Math.max(0, ...arr);
  if (arr.filter((v) => v >= 50).length >= 2) score += 10;
  score = Math.round(clamp(score));
  const reasons = Object.entries(comps)
    .filter(([, v]) => v >= 25)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, s]) => ({ k, s: Math.round(s), v: vals[k] == null ? null : +Number(vals[k]).toFixed(1), ...(k === 'flood' && ctx.riverTrend > 0 ? { river: true } : {}) }));
  return { score, level: levelOf(score), comps, reasons, sea };
}

const at = (a, i) => (a ? a[i] : null);

/** Merge forecast + marine series into one record for the hour containing unix time `t`. */
export function recordAt(fc, mr, t, clampIdx = false) {
  if (!fc) return null;
  let i = Math.round((t - fc.t0) / 3600);
  if (i < 0 || i >= fc.n) {
    if (!clampIdx) return null;
    i = Math.min(fc.n - 1, Math.max(0, i));
  }
  const sum = (a, b) => {
    let s = 0;
    for (let k = Math.max(0, a); k <= Math.min(fc.n - 1, b); k++) s += fc.precip[k] || 0;
    return s;
  };
  const r = {
    t: fc.t0 + i * 3600, precip: fc.precip[i] ?? 0, wind: fc.wind[i], dir: fc.dir[i], gust: fc.gust[i],
    code: fc.code[i], vis: at(fc.vis, i), appT: at(fc.appT, i), temp: at(fc.temp, i), prob: at(fc.prob, i),
    cape: at(fc.cape, i), soil: at(fc.soil, i), rain24: sum(i - 18, i + 6), rain72: sum(i - 48, i + 24), elev: fc.elev,
  };
  if (mr && mr.hasData) {
    const j = Math.round((r.t - mr.t0) / 3600);
    if (j >= 0 && j < mr.n && mr.wave[j] != null) {
      Object.assign(r, {
        wave: mr.wave[j], wdir: at(mr.wdir, j), period: at(mr.period, j), swell: at(mr.swell, j),
        sdir: at(mr.sdir, j), speriod: at(mr.speriod, j), cur: at(mr.cur, j), curdir: at(mr.curdir, j),
      });
    }
  }
  return r;
}

/** Contiguous runs of hours scoring below `thr`; marks the most useful one as `best`. */
export function findWindows(tl, thr = 25) {
  const runs = [];
  let cur = null;
  for (const p of tl) {
    if (p.score < thr) {
      if (!cur) cur = { start: p.t, end: p.t, sum: 0, n: 0, max: 0 };
      cur.end = p.t + 3600;
      cur.sum += p.score;
      cur.n++;
      cur.max = Math.max(cur.max, p.score);
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  const out = runs.map((r) => ({ start: r.start, end: r.end, hours: r.n, avg: Math.round(r.sum / r.n), max: r.max }));
  let best = null;
  for (const r of out) {
    const v = r.hours - r.avg / 10;
    if (!best || v > best.v) best = { v, r };
  }
  if (best) best.r.best = true;
  return out;
}
