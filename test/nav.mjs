// Turn-by-turn engine tests: simulated drives along a real-shaped route (no GPS or network needed).
import assert from 'node:assert/strict';
import { Nav, cumulative, snap, positionAt, describe, distWords, hazardText, hav } from '../public/js/navcore.js';
import { stepsFromGeometry, mapOsrmSteps, zonesAlong } from '../server/lib/nav.js';

// A route with two corners: ~1.2 km north, ~1.2 km east, ~0.8 km north (14.60,121.00 start)
const pts = [];
const seg = (a, b, n) => { for (let i = pts.length ? 1 : 0; i <= n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]); };
const P0 = [14.6, 121.0], P1 = [14.6108, 121.0], P2 = [14.6108, 121.0111], P3 = [14.618, 121.0111];
seg(P0, P1, 60); seg(P1, P2, 60); seg(P2, P3, 40);

/* ---- server: corner detection from geometry ---- */
const st = stepsFromGeometry(pts);
assert.deepEqual(st.map((s) => s.ty), ['depart', 'turn', 'turn', 'arrive']);
assert.equal(st[1].mo, 'right', 'north -> east is a right turn');
assert.equal(st[2].mo, 'left', 'east -> north is a left turn');
assert.ok(Math.abs(st[1].i - 60) <= 2 && Math.abs(st[2].i - 120) <= 2);
assert.equal(stepsFromGeometry([[14, 121], [14.01, 121], [14.02, 121]]).length, 2, 'straight road = depart + arrive only');

// OSRM steps mapping: skips noise, maps maneuver locations to geometry indexes
const osrmLegs = [{ steps: [
  { maneuver: { type: 'depart', location: [121.0, 14.6] }, name: 'Rizal Ave' },
  { maneuver: { type: 'new name', location: [121.0, 14.603] }, name: 'X' },
  { maneuver: { type: 'turn', modifier: 'right', location: [121.0, 14.6108] }, name: 'Mabini St' },
  { maneuver: { type: 'continue', modifier: 'straight', location: [121.005, 14.6108] }, name: 'Mabini St' },
  { maneuver: { type: 'roundabout', exit: 2, location: [121.0111, 14.6108] }, name: 'Plaza' },
  { maneuver: { type: 'arrive', location: [121.0111, 14.618] }, name: '' },
] }];
const ms = mapOsrmSteps(osrmLegs, pts);
assert.deepEqual(ms.map((s) => s.ty), ['depart', 'turn', 'roundabout', 'arrive']);
assert.ok(Math.abs(ms[1].i - 60) <= 1 && ms[2].ex === 2 && ms[1].nm === 'Mabini St');

/* ---- words ---- */
assert.equal(describe({ ty: 'turn', mo: 'right', nm: 'Mabini St' }, 'fil'), 'Lumiko pakanan papuntang Mabini St');
assert.equal(describe({ ty: 'turn', mo: 'left' }, 'en'), 'Turn left');
assert.match(describe({ ty: 'roundabout', ex: 3 }, 'fil'), /ika-3 labasan/);
assert.match(describe({ ty: 'roundabout', ex: 2 }, 'en'), /2nd exit/);
assert.equal(distWords(212, 'fil'), '210 metro');
assert.equal(distWords(1480, 'en'), '1.5 kilometres');
assert.match(hazardText({ kind: 'flood' }, 900, 'fil'), /baha sa kalsada.*900 metro/);

/* ---- a full simulated drive ---- */
const route = {
  full: pts, steps: st, durationMin: 6, sea: false,
  closures: [{ id: 'abc', type: 'flood', lat: 14.6108, lon: 121.0075 }],
  hazards: [{ lat: 14.6165, lon: 121.0111, level: 2, reasons: [{ k: 'rain' }] }],
};
function drive(nav, kmh = 40, dt = 1, jitter = 0, from = 0) {
  const cum = nav.cum;
  const said = [];
  let along = from, t = 1_700_000_000_000, last;
  for (let i = 0; i < 4000 && along < cum[cum.length - 1] + 5; i++) {
    const p = positionAt(pts, cum, along);
    const j = jitter ? (Math.sin(i * 12.9898) * 43758.5453 % 1) * jitter : 0;
    last = nav.update({ lat: p.lat + j / 111000, lon: p.lon + j / 111000, acc: 8, speed: kmh / 3.6, t });
    said.push(...last.speak.map((s) => s.text));
    along += (kmh / 3.6) * dt;
    t += dt * 1000;
    if (last.arrived) break;
  }
  return { said, last };
}
let nav = new Nav(route, { mode: 'motorcycle', lang: 'fil' });
let { said, last } = drive(nav);
assert.equal(said[0], 'Simulan ang biyahe', 'starts with depart');
const iR = said.findIndex((s) => /pakanan/.test(s) && /^Sa \d+ metro,/.test(s));
const iL = said.findIndex((s) => /pakaliwa/.test(s) && /^Sa \d+ metro,/.test(s));
assert.ok(iR > 0 && iL > iR, 'right-turn advance notice comes before the left-turn one');
assert.ok(said.some((s) => s === 'Lumiko pakanan.'), 'and an "now" call at the corner');
assert.ok(said.some((s) => s === 'Lumiko pakaliwa.'));
assert.ok(said.some((s) => /^Babala: baha sa kalsada/.test(s)), 'flooded-road report is announced ahead');
assert.ok(said.some((s) => /^Babala: malakas na ulan/.test(s)), 'weather hazard is announced ahead too');
assert.ok(said.indexOf(said.find((s) => /^Babala: baha/.test(s))) < said.indexOf('Lumiko pakaliwa.'), 'flood warning arrives before the second corner');
assert.equal(said.filter((s) => s === 'Lumiko pakanan.').length, 1, 'each call is spoken once');
assert.ok(last.arrived && /Nakarating/.test(said[said.length - 1]));
assert.ok(Math.abs(last.total - cumulative(pts)[pts.length - 1]) < 1);

// English
nav = new Nav(route, { mode: 'general', lang: 'en' });
said = drive(nav).said;
assert.ok(said.some((s) => /^In \d+ metres, Turn right\.$/.test(s)), said.join(' | '));
assert.ok(said.at(-1) === 'You have arrived');

// noisy GPS (±6 m) neither skips nor repeats instructions and never reports "off route"
nav = new Nav(route, { mode: 'motorcycle', lang: 'fil' });
let anyOff = false;
const orig = nav.update.bind(nav);
nav.update = (f) => { const r = orig(f); anyOff ||= r.offRoute; return r; };
said = drive(nav, 35, 1, 6).said;
assert.equal(anyOff, false, 'GPS jitter alone is not "off route"');
assert.equal(said.filter((s) => s === 'Lumiko pakanan.').length, 1);
assert.ok(said.at(-1).includes('Nakarating'));

// walking profile announces much closer to the turn
nav = new Nav(route, { mode: 'hiker', lang: 'en' });
said = drive(nav, 5, 1).said;
const adv = said.find((s) => /Turn right/.test(s) && /^In/.test(s));
assert.ok(adv && parseInt(adv.match(/\d+/)[0], 10) <= 100, adv);

/* ---- going off route, and a ride where GPS starts mid-route ---- */
nav = new Nav(route, { mode: 'motorcycle', lang: 'fil' });
const cum = nav.cum;
let flagged = null;
for (let i = 0; i < 12; i++) {
  const p = positionAt(pts, cum, 300 + i * 11);
  const r = nav.update({ lat: p.lat, lon: p.lon + 0.0009, acc: 8, speed: 11, t: 1e12 + i * 1000 }); // ~100 m east of the road
  if (r.offRoute && flagged == null) flagged = i;
}
assert.ok(flagged != null && flagged >= 4, `off-route needs a few consecutive bad fixes (flagged at ${flagged})`);
assert.ok(hav([14.6, 121.0], [14.6, 121.0009]) > 90);
// one stray fix does not trigger it
nav = new Nav(route, { mode: 'motorcycle', lang: 'fil' });
const q = positionAt(pts, cum, 200);
assert.equal(nav.update({ lat: q.lat, lon: q.lon + 0.0009, acc: 8, speed: 10, t: 1e12 }).offRoute, false);
assert.equal(nav.update({ lat: q.lat, lon: q.lon, acc: 8, speed: 10, t: 1e12 + 1000 }).offRoute, false);
// rerouted route says "Bagong ruta"
nav = new Nav(route, { mode: 'motorcycle', lang: 'fil', rerouted: true });
assert.equal(nav.update({ lat: 14.6, lon: 121.0, acc: 5, speed: 5, t: 1 }).speak[0].text, 'Bagong ruta.');
// poor accuracy loosens the off-route limit
nav = new Nav(route, { mode: 'motorcycle', lang: 'fil' });
for (let i = 0; i < 6; i++) { const p = positionAt(pts, cum, 300); assert.equal(nav.update({ lat: p.lat, lon: p.lon + 0.0004, acc: 60, speed: 8, t: 1e12 + i * 2000 }).offRoute, false); }

// snap sanity
const s = snap(pts, cum, [14.605, 121.0003], 0);
assert.ok(s.dist < 40 && Math.abs(s.along - 555) < 15, `${s.dist} ${s.along}`);
// route that crosses itself: the hint keeps us on the right pass
const loop = [[14, 121], [14.002, 121], [14.002, 121.002], [14.001, 121.002], [14.001, 120.999], [14.0015, 120.999], [14.0015, 121.001], [14.0015, 121.0035]];
const lc = cumulative(loop);
const onSecond = snap(loop, lc, [14.0015, 121.0], 4);
assert.ok(onSecond.idx >= 4, `wrong pass picked: idx ${onSecond.idx}`);

/* ---- sea navigation: heading to the destination, hazards, no reroute ---- */
const sea = { full: [[12.5, 120.4], [12.0, 120.9], [11.5, 121.5]], steps: [{ i: 0, ll: [12.5, 120.4], ty: 'depart', nm: '' }, { i: 2, ll: [11.5, 121.5], ty: 'arrive', nm: '' }], durationMin: 200, sea: true, closures: [], hazards: [{ lat: 12.0, lon: 120.9, level: 3, reasons: [{ k: 'wave' }] }] };
nav = new Nav(sea, { mode: 'fisher', lang: 'fil' });
let r = nav.update({ lat: 12.45, lon: 120.45, acc: 10, speed: 3, t: 1 });
assert.ok(r.toDest && r.toDest.bearing > 100 && r.toDest.bearing < 160 && r.toDest.dist > 100000);
assert.equal(nav.update({ lat: 12.3, lon: 121.4, acc: 10, speed: 3, t: 5000 }).offRoute, false, 'a boat is never "re-routed" over land');
assert.ok(zonesAlong([[14.64, 121.1], [14.65, 121.11]]).some((z) => z.id === 'marikina'));

// a hazard reported while driving is added once, only if it is on the route
nav = new Nav(route, { mode: 'motorcycle', lang: 'fil' });
assert.ok(nav.addEvent({ id: 'cNEW', kind: 'closed', lat: 14.6108, lon: 121.0095, severe: true }));
assert.equal(nav.addEvent({ id: 'cNEW', kind: 'closed', lat: 14.6108, lon: 121.0095, severe: true }), null, 'no duplicates');
assert.equal(nav.addEvent({ id: 'cFAR', kind: 'closed', lat: 14.7, lon: 121.2, severe: true }), null, 'off-route reports are ignored');
const w = nav.update({ lat: 14.6108, lon: 121.0011, acc: 8, speed: 11, t: 1 });
assert.ok(w.speak.some((x) => /sarado ang daan/.test(x.text)));
console.log('nav test passed');
