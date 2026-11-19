/**
 * Turn-by-turn helpers (server side).
 * - mapOsrmSteps: OSRM steps -> compact maneuvers pointing into the full route geometry.
 * - stepsFromGeometry: fallback that finds turns from the shape of the line (demo mode, or if OSRM sends no steps).
 * A maneuver is { i: index into geometry, ll: [lat, lon], ty: type, mo: modifier|null, ex: roundabout exit|null, nm: street name }.
 */
import { zonesAt } from './places.js';
import { haversineKm } from './util.js';

const SKIP = new Set(['new name', 'notification', 'exit roundabout', 'exit rotary', 'exit roundabout turn']);

export function mapOsrmSteps(legs, coords) {
  const out = [];
  let from = 0;
  for (const leg of legs || []) {
    for (const st of leg.steps || []) {
      const m = st.maneuver;
      if (!m?.location) continue;
      const ll = [m.location[1], m.location[0]];
      let best = from, bd = Infinity;
      const end = Math.min(coords.length, from + 4000);
      for (let i = from; i < end; i++) {
        const d = (coords[i][0] - ll[0]) ** 2 + (coords[i][1] - ll[1]) ** 2;
        if (d < bd) { bd = d; best = i; }
        if (d === 0) break;
      }
      from = best;
      const keep = m.type === 'depart' || m.type === 'arrive' || !(SKIP.has(m.type) || (m.type === 'continue' && (!m.modifier || m.modifier === 'straight')));
      if (keep) out.push({ i: best, ll, ty: m.type, mo: m.modifier || null, ex: m.exit || null, nm: st.name || '' });
    }
  }
  return normalize(out, coords);
}

/** Make sure there is exactly one depart at the start and one arrive at the end. */
function normalize(steps, coords) {
  const last = coords.length - 1;
  if (!steps.length || steps[0].ty !== 'depart') steps.unshift({ i: 0, ll: coords[0], ty: 'depart', mo: null, ex: null, nm: '' });
  const tail = steps[steps.length - 1];
  if (tail.ty !== 'arrive') steps.push({ i: last, ll: coords[last], ty: 'arrive', mo: null, ex: null, nm: '' });
  return steps;
}

export const bearing = (a, b) => {
  const r = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
};
const dm = (a, b) => haversineKm({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }) * 1000;
const delta = (a, b) => ((b - a + 540) % 360) - 180;

export function stepsFromGeometry(coords) {
  const steps = [];
  let lastI = 0, lastMeters = 0, meters = 0;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push((meters += dm(coords[i - 1], coords[i])));
  const back = (i) => { let k = i; while (k > 0 && cum[i] - cum[k] < 25) k--; return k; };
  const fwd = (i) => { let k = i; while (k < coords.length - 1 && cum[k] - cum[i] < 25) k++; return k; };
  for (let i = 1; i < coords.length - 1; i++) {
    const a = back(i), b = fwd(i);
    if (a === i || b === i) continue;
    const d = delta(bearing(coords[a], coords[i]), bearing(coords[i], coords[b]));
    const ad = Math.abs(d);
    if (ad < 35 || cum[i] - lastMeters < 60) continue;
    // take the sharpest vertex in a short window so a curve produces one maneuver
    let bi = i, bd = ad;
    for (let k = i + 1; k < coords.length - 1 && cum[k] - cum[i] < 30; k++) {
      const kd = Math.abs(delta(bearing(coords[back(k)], coords[k]), bearing(coords[k], coords[fwd(k)])));
      if (kd > bd) { bd = kd; bi = k; }
    }
    const dd = delta(bearing(coords[back(bi)], coords[bi]), bearing(coords[bi], coords[fwd(bi)]));
    const mo = bd > 165 ? 'uturn' : `${bd > 120 ? 'sharp ' : bd < 60 ? 'slight ' : ''}${dd < 0 ? 'left' : 'right'}`;
    steps.push({ i: bi, ll: coords[bi], ty: 'turn', mo, ex: null, nm: '' });
    lastI = bi;
    lastMeters = cum[bi];
    i = bi;
  }
  return normalize(steps, coords);
}

/** Flood / landslide-prone areas the route passes through (checked about every 1.5 km). */
export function zonesAlong(coords) {
  const seen = new Map();
  let acc = 1e9;
  let km = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i) { const d = dm(coords[i - 1], coords[i]) / 1000; km += d; acc += d; }
    if (acc < 1.5 && i !== coords.length - 1) continue;
    acc = 0;
    for (const z of zonesAt(coords[i][0], coords[i][1])) if (!seen.has(z.id)) seen.set(z.id, { id: z.id, n: z.n, type: z.type, km: +km.toFixed(1) });
  }
  return [...seen.values()];
}
