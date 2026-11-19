/**
 * Rivers + dams.
 *
 * RIVERS: PAGASA has no public river-gauge API, so "River Flow Alerts" use the GloFAS river-discharge
 *   forecast (via Open-Meteo): how much bigger is the coming 4-day peak than the last 3 days' average.
 *   This is a MODEL, not a gauge reading, and the UI says so.
 * DAMS: PAGASA publishes dam water levels only as an HTML table on bagong.pagasa.dost.gov.ph/flood.
 *   We read that page at most once per 30 min (identify ourselves, cache, give credit) and sanity-check
 *   every number. Disable with TERRAVUE_PAGASA_DAMS=0. If the page layout changes, parsing fails safe
 *   (dam shown without a live reading) instead of showing a wrong number.
 */
import { river, riverSignal, status, isDemo } from './openmeteo.js';
import * as demo from './demo.js';
import { fetchText } from './upstream.js';
import { TTLCache } from './cache.js';

export const PAGASA_FLOOD = 'https://bagong.pagasa.dost.gov.ph/flood';

/** Approximate points on major rivers (GloFAS cells are ~5 km, so this is the nearest big channel). */
export const RIVERS = [
  { id: 'marikina', n: 'Marikina River', basin: 'Pasig–Marikina', lat: 14.63, lon: 121.09 },
  { id: 'pasig', n: 'Pasig River', basin: 'Pasig–Marikina', lat: 14.585, lon: 121.0 },
  { id: 'pampanga', n: 'Pampanga River', basin: 'Pampanga', lat: 15.18, lon: 120.76 },
  { id: 'agno', n: 'Agno River', basin: 'Agno', lat: 15.9, lon: 120.6 },
  { id: 'cagayan', n: 'Cagayan River', basin: 'Cagayan', lat: 17.62, lon: 121.72 },
  { id: 'abra', n: 'Abra River', basin: 'Abra', lat: 17.58, lon: 120.4 },
  { id: 'bicol', n: 'Bicol River', basin: 'Bicol', lat: 13.62, lon: 123.19 },
  { id: 'agusan', n: 'Agusan River', basin: 'Agusan', lat: 8.95, lon: 125.54 },
  { id: 'rgm', n: 'Rio Grande de Mindanao', basin: 'Mindanao', lat: 7.2, lon: 124.25 },
  { id: 'tagum', n: 'Tagum–Libuganon River', basin: 'Tagum–Libuganon', lat: 7.45, lon: 125.8 },
  { id: 'panay', n: 'Panay River', basin: 'Panay', lat: 11.58, lon: 122.75 },
  { id: 'jalaur', n: 'Jalaur River', basin: 'Jalaur', lat: 10.9, lon: 122.6 },
  { id: 'cagayandeoro', n: 'Cagayan de Oro River', basin: 'Cagayan de Oro', lat: 8.47, lon: 124.65 },
  { id: 'abulug', n: 'Abulug River', basin: 'Abulug', lat: 18.44, lon: 121.45 },
];

const RIVER_CACHE = new TTLCache(60 * 60e3, 2);

/** ratio = coming 4-day peak / last 3-day mean discharge. */
export const riverLevel = (ratio) => (ratio >= 4 ? 3 : ratio >= 2.5 ? 2 : ratio >= 1.5 ? 1 : 0);

export function riversReport() {
  return RIVER_CACHE.wrap('r', async () => {
    const now = Math.floor(Date.now() / 1000);
    const rivers = [];
    for (let i = 0; i < RIVERS.length; i += 4) {
      const part = await Promise.all(
        RIVERS.slice(i, i + 4).map(async (r) => {
          const rv = status.demoForced ? demo.riverSeries(r.lat, r.lon) : await river(r.lat, r.lon);
          const sig = riverSignal(rv, now);
          if (!sig) return { ...r, ok: false };
          return {
            ...r, ok: true, level: riverLevel(sig.ratio), q: sig.q, peak: sig.peak, ratio: sig.ratio,
            t0: rv.t[0], series: rv.q.map((v) => (v == null ? null : +v.toFixed(1))),
          };
        }),
      );
      rivers.push(...part);
    }
    rivers.sort((a, b) => (b.ok - a.ok) || (b.level ?? 0) - (a.level ?? 0) || (b.ratio ?? 0) - (a.ratio ?? 0));
    return { demo: isDemo(), t: Date.now(), model: 'GloFAS', rivers };
  });
}

/* ------------------------------------------------------------------- dams */
/** nhwl = Normal High Water Level (m). Static reference values; the live table's own NHWL wins when present. */
export const DAMS = [
  { id: 'angat', n: 'Angat', re: /\bangat\b/i, lat: 14.9, lon: 121.15, nhwl: 210, use: 'Metro Manila water supply' },
  { id: 'ipo', n: 'Ipo', re: /\bipo\b/i, lat: 14.85, lon: 121.13, nhwl: 101, use: 'Metro Manila water supply' },
  { id: 'lamesa', n: 'La Mesa', re: /la\s*mesa/i, lat: 14.7, lon: 121.08, nhwl: 80.15, use: 'Metro Manila water supply' },
  { id: 'ambuklao', n: 'Ambuklao', re: /ambuklao/i, lat: 16.48, lon: 120.69, nhwl: 752, use: 'Benguet / Agno' },
  { id: 'binga', n: 'Binga', re: /\bbinga\b/i, lat: 16.4, lon: 120.66, nhwl: 575, use: 'Benguet / Agno' },
  { id: 'sanroque', n: 'San Roque', re: /san\s*roque/i, lat: 16.13, lon: 120.72, nhwl: 280, use: 'Pangasinan / Agno' },
  { id: 'pantabangan', n: 'Pantabangan', re: /pantabangan/i, lat: 15.82, lon: 121.12, nhwl: 221, use: 'Nueva Ecija / Pampanga' },
  { id: 'magat', n: 'Magat', re: /\bmagat\b/i, lat: 16.83, lon: 121.48, nhwl: 190, use: 'Isabela / Cagayan' },
  { id: 'caliraya', n: 'Caliraya', re: /caliraya/i, lat: 14.31, lon: 121.52, nhwl: 288, use: 'Laguna' },
];

const strip = (s) =>
  s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toNum = (c) => {
  const m = String(c).replace(/,/g, '').match(/^-?\d+(\.\d+)?$/);
  return m ? parseFloat(m[0]) : null;
};
const plausible = (v, nhwl) => v != null && v > nhwl * 0.5 && v < nhwl * 1.12 + 5;

/** Pure function (unit-tested): HTML table text -> { damId: { rwl, nhwl, obs, inflow, outflow } } */
export function parseDamTable(html) {
  const rows = [];
  for (const m of String(html).matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells = [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]));
    if (cells.length >= 3) rows.push(cells);
  }
  const col = {};
  const hdr = rows.find((r) => r.some((c) => /reservoir water level|\brwl\b/i.test(c)));
  if (hdr) {
    const find = (re, not) => { const i = hdr.findIndex((c) => re.test(c) && !(not && not.test(c))); return i < 0 ? null : i; };
    col.rwl = find(/reservoir water level|\brwl\b/i, /deviation|change|previous/i);
    col.nhwl = find(/normal high|\bnhwl\b/i, /deviation/i);
    col.obs = find(/observ|date|time/i);
    col.inflow = find(/inflow/i);
    col.outflow = find(/outflow/i);
  }
  const out = {};
  for (const cells of rows) {
    const dam = DAMS.find((d) => !out[d.id] && d.re.test(cells[0]));
    if (!dam) continue;
    let rwl;
    if (col.rwl != null) {
      // header told us which column is the reservoir level: trust it or skip the dam (never guess from other columns,
      // or an "N/A" reading could be replaced by the NHWL column and fake an "at spilling level" alert)
      rwl = toNum(cells[col.rwl]);
      if (!plausible(rwl, dam.nhwl)) continue;
    } else {
      // no usable header: first plausible number after the name, but never the NHWL value itself
      rwl = cells.slice(1).map(toNum).find((v) => plausible(v, dam.nhwl) && Math.abs(v - dam.nhwl) > 0.005) ?? null;
      if (rwl == null) continue;
    }
    const nh = col.nhwl != null ? toNum(cells[col.nhwl]) : null;
    out[dam.id] = {
      rwl,
      nhwl: plausible(nh, dam.nhwl) && Math.abs(nh - dam.nhwl) < dam.nhwl * 0.05 + 2 ? nh : dam.nhwl,
      obs: col.obs != null ? cells[col.obs] || null : null,
      inflow: col.inflow != null ? toNum(cells[col.inflow]) : null,
      outflow: col.outflow != null ? toNum(cells[col.outflow]) : null,
    };
  }
  return out;
}

/** margin = metres below NHWL. */
export const damLevel = (margin) => (margin <= 0 ? 3 : margin <= 1 ? 2 : margin <= 3 ? 1 : 0);

const demoDams = () =>
  Object.fromEntries(DAMS.map((d, i) => [d.id, {
    rwl: +(d.nhwl - (i % 3 === 0 ? 0.6 : 1.5 + ((i * 2.7) % 9))).toFixed(2), nhwl: d.nhwl,
    obs: 'DEMO', inflow: null, outflow: null,
  }]));

const DAM_CACHE = new TTLCache(30 * 60e3, 2);

export function damsReport() {
  return DAM_CACHE.wrap('d', async () => {
    let live = {};
    let error = null;
    if (status.demoForced) live = demoDams();
    else if (process.env.TERRAVUE_PAGASA_DAMS !== '0') {
      try {
        live = parseDamTable(await fetchText(PAGASA_FLOOD, { timeout: 15000, retries: 0 }));
        if (!Object.keys(live).length) error = 'parse';
      } catch {
        error = 'unreachable';
      }
    } else error = 'disabled';
    const dams = DAMS.map(({ re, ...d }) => {
      const r = live[d.id];
      if (!r) return { ...d, live: false };
      const margin = +(r.nhwl - r.rwl).toFixed(2);
      return { ...d, live: true, rwl: r.rwl, nhwl: r.nhwl, margin, level: damLevel(margin), obs: r.obs, inflow: r.inflow, outflow: r.outflow };
    });
    dams.sort((a, b) => (b.live - a.live) || (b.level ?? -1) - (a.level ?? -1));
    return { demo: status.demoForced, t: Date.now(), error, source: PAGASA_FLOOD, dams };
  });
}
