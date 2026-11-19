/**
 * Synthetic weather used ONLY when the real data providers cannot be reached
 * (offline development, tests, or TERRAVUE_DEMO=1). Every response that used it
 * is flagged `demo: true` and the UI shows a banner.
 */
import { CITIES } from './places.js';
import { haversineKm, clamp } from './util.js';

const MANILA = 8 * 3600;

export function isSeaDemo(lat, lon) {
  let m = Infinity;
  for (const c of CITIES) m = Math.min(m, haversineKm({ lat, lon }, c));
  return m > 35;
}

function field(lat, lon, t) {
  const h = (t - 1.7e9) / 3600;
  const cells = [
    { lat: 13 + 3 * Math.sin(h / 40), lon: 130 - ((h * 0.22) % 18), s: 1.5, a: 16 },
    { lat: 9 + 2 * Math.cos(h / 33), lon: 128 - ((h * 0.18 + 7) % 18), s: 1.1, a: 10 },
  ];
  let p = 0;
  let w = 9;
  for (const c of cells) {
    const d2 = ((lat - c.lat) ** 2 + (lon - c.lon) ** 2) / c.s ** 2;
    p += c.a * Math.exp(-d2);
    w += 20 * Math.exp(-d2 / 1.7);
  }
  p = Math.max(0, p * (0.75 + 0.25 * Math.sin(lat * 37 + lon * 29 + h / 2)) - 0.3);
  return { p, w };
}

export function forecastSeries(lat, lon, full) {
  const past = full ? 3 : 2;
  const days = past + (full ? 4 : 2);
  const now = Math.floor(Date.now() / 1000);
  const t0 = Math.floor((now + MANILA) / 86400) * 86400 - MANILA - past * 86400;
  const n = days * 24;
  const s = {
    demo: true, lat, lon, t0, n, elev: Math.max(0, Math.round(Math.abs(Math.sin(lat * 9 + lon * 7)) * 600)),
    precip: [], wind: [], dir: [], gust: [], code: [], soil: [], cape: [],
    temp: [], appT: [], prob: [], vis: [],
  };
  for (let i = 0; i < n; i++) {
    const t = t0 + i * 3600;
    const { p, w } = field(lat, lon, t);
    const hour = ((t + MANILA) % 86400) / 3600;
    const temp = 27 + 4 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
    s.precip.push(+p.toFixed(2));
    s.wind.push(+w.toFixed(1));
    s.dir.push(Math.round((60 + 40 * Math.sin(i / 20) + (lat - 12) * 4 + 360) % 360));
    s.gust.push(+(w * 1.6).toFixed(1));
    s.code.push(p > 12 ? 95 : p > 5 ? 65 : p > 0.5 ? 61 : 2);
    s.soil.push(+(0.3 + Math.min(0.2, p / 60)).toFixed(3));
    s.cape.push(p > 8 ? 1800 : 300);
    s.temp.push(+temp.toFixed(1));
    s.appT.push(+(temp + 5 + p * 0.1).toFixed(1));
    s.prob.push(Math.min(100, Math.round(p * 15)));
    s.vis.push(p > 5 ? 3000 : 20000);
  }
  return s;
}

export function marineSeries(lat, lon) {
  const fc = forecastSeries(lat, lon, false);
  const sea = isSeaDemo(lat, lon);
  const mk = (fn) => fc.wind.map((w, i) => (sea ? fn(w, i) : null));
  return {
    demo: true, t0: fc.t0, n: fc.n, hasData: sea,
    wave: mk((w) => +clamp(0.3 + (w / 1.852) / 11, 0.2, 6).toFixed(2)),
    wdir: mk((w, i) => fc.dir[i]),
    period: mk((w) => +(5 + w / 6).toFixed(1)),
    swell: mk((w) => +clamp(0.2 + w / 40, 0.1, 4).toFixed(2)),
    sdir: mk((w, i) => (fc.dir[i] + 20) % 360),
    speriod: mk(() => 9),
    wwave: mk((w) => +clamp(0.2 + w / 25, 0.1, 5).toFixed(2)),
    cur: mk(() => 0.4),
    curdir: mk((w, i) => (fc.dir[i] + 90) % 360),
  };
}

/** Fake daily river discharge (m3/s): past 3 days + next 7. Some rivers surge, to exercise the alert UI. */
export function riverSeries(lat, lon) {
  const now = Math.floor(Date.now() / 1000);
  const d0 = Math.floor(now / 86400) * 86400 - 3 * 86400;
  const seed = Math.abs(Math.sin(lat * 91 + lon * 37));
  const base = 60 + seed * 400;
  const t = [];
  const q = [];
  for (let i = 0; i < 10; i++) {
    t.push(d0 + i * 86400);
    const surge = seed > 0.62 ? 1 + 3.4 * Math.exp(-((i - 5) ** 2) / 3) : seed > 0.4 ? 1 + 1.1 * Math.exp(-((i - 6) ** 2) / 4) : 1 + 0.15 * Math.sin(i);
    q.push(+(base * surge).toFixed(1));
  }
  return { t, q };
}

/** Smooth fake terrain so elevation-profile code can be exercised offline. */
export function elevationAt(lat, lon) {
  return Math.round(350 + 300 * Math.sin(lat * 60) * Math.cos(lon * 55) + 120 * Math.sin(lat * 210 + lon * 190));
}
