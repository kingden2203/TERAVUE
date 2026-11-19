// Tests for rivers/dams, trails/profile, community reports and Web Push (all offline, demo data).
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

process.env.TERRAVUE_DEMO = '1';
process.env.TERRAVUE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-'));

const { parseDamTable, riverLevel, damLevel } = await import('../server/lib/hydro.js');
const { groupTrails, gainLoss } = await import('../server/lib/trails.js');
const reports = await import('../server/lib/reports.js');
const push = await import('../server/lib/push.js');
const { server } = await import('../server/index.js');

/* ---- dam table parser: header mapping, shifted columns, garbage rejected ---- */
const row = (...c) => `<tr>${c.map((x) => `<td>${x}</td>`).join('')}</tr>`;
const hdr = `<tr><th>Dam Name</th><th>Observation Time &amp; Date</th><th>Reservoir Water Level (RWL) (m)</th><th>Deviation from Previous (m)</th><th>Normal High Water Level (NHWL) (m)</th><th>Deviation from NHWL (m)</th></tr>`;
let out = parseDamTable(`<table>${hdr}${row('Angat', '08:00 AM 11/12', '209.31', '-0.02', '210.00', '-0.69')}${row('<b>La Mesa</b>', '08:00 AM', '79.62', '0.01', '80.15', '-0.53')}${row('Magat', '08:00 AM', 'N/A', '', '190.00', '')}${row('Binga', '08:00', '12.5', '', '575.00', '')}</table>`);
assert.equal(out.angat.rwl, 209.31);
assert.equal(out.angat.nhwl, 210);
assert.match(out.angat.obs, /08:00/);
assert.equal(out.lamesa.rwl, 79.62);
assert.equal(out.magat, undefined, 'non-numeric reading is skipped, not guessed');
assert.equal(out.binga, undefined, 'implausible reading (12.5 m for a 575 m dam) is rejected');
// header we cannot map -> fall back to first plausible number
out = parseDamTable(`<table><tr><th>x</th><th>y</th><th>z</th></tr>${row('Ipo Dam', '08:00', '100.12', '101.00')}</table>`);
assert.equal(out.ipo.rwl, 100.12);
assert.deepEqual(parseDamTable('<html>nothing here</html>'), {});
assert.equal(riverLevel(1.2), 0); assert.equal(riverLevel(2), 1); assert.equal(riverLevel(3), 2); assert.equal(riverLevel(5), 3);
assert.equal(damLevel(2), 1); assert.equal(damLevel(0.4), 2); assert.equal(damLevel(-0.1), 3); assert.equal(damLevel(6), 0);

/* ---- trails ---- */
const way = (id, name, pts, tags = {}) => ({ type: 'way', id, tags: { highway: 'path', name, ...tags }, geometry: pts.map(([lat, lon]) => ({ lat, lon })) });
const g = groupTrails([
  way(1, 'Mt. Test Trail', [[14.0, 121.0], [14.01, 121.01]], { sac_scale: 'mountain_hiking' }),
  way(2, 'Mt. Test Trail', [[14.01, 121.01], [14.02, 121.02]], { sac_scale: 'demanding_mountain_hiking' }),
  way(3, 'Tiny', [[14.0, 121.0], [14.0001, 121.0001]]),
]);
assert.equal(g.length, 1, 'pieces with the same name are grouped, tiny bits dropped');
assert.equal(g[0].lines.length, 2);
assert.equal(g[0].sac, 3);
assert.ok(g[0].km > 3 && g[0].km < 4);
const gl = gainLoss([100, 101, 100, 102, 150, 200, 260, 255, 200, 150, 120]);
assert.ok(gl.gain >= 140 && gl.gain <= 165, `gain ${gl.gain}`);
assert.ok(gl.loss >= 110 && gl.loss <= 145, `loss ${gl.loss}`);
assert.equal(gainLoss([100, 102, 99, 101, 100]).gain, 0, 'noise below 3 m is ignored');

/* ---- community reports ---- */
reports._reset();
const a = reports.addReport({ type: 'flood', lat: 14.6, lon: 121.0, note: '<b>Baha</b>\n hanggang tuhod' }, 'aaaa1111');
assert.equal(a.merged, false);
assert.ok(!/[<>]/.test(a.report.note), 'markup stripped from note');
const b = reports.addReport({ type: 'flood', lat: 14.6003, lon: 121.0003, note: '' }, 'bbbb2222');
assert.equal(b.merged, true, 'nearby same-type report is merged into a confirmation');
assert.equal(reports.listReports()[0].confirms, 2);
assert.throws(() => reports.addReport({ type: 'ufo', lat: 14, lon: 121 }, 'x'), /Invalid type/);
assert.throws(() => reports.addReport({ type: 'flood', lat: 50, lon: 121 }, 'x'), /Invalid location/);
const near = reports.reportsNear([[14.59, 120.99], [14.61, 121.01]], 0.5);
assert.equal(near.length, 1);
assert.equal(reports.reportsNear([[14.7, 121.2], [14.8, 121.3]], 0.5).length, 0);
assert.equal(reports.vote(a.id, 'gone', 'bbbb2222').removed, false, 'one stranger is not enough');
assert.equal(reports.vote(a.id, 'gone', 'cccc3333').removed, true, 'two independent "wala na" votes remove it');
reports._reset();
for (let i = 0; i < 6; i++) reports.addReport({ type: 'closed', lat: 10 + i * 0.1, lon: 123, note: '' }, 'spam0001');
assert.throws(() => reports.addReport({ type: 'closed', lat: 12, lon: 123, note: '' }, 'spam0001'), /Too many/);
reports._reset();

/* ---- web push: encryption round trip + VAPID signature + SSRF guard ---- */
const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const auth = crypto.randomBytes(16);
const msg = JSON.stringify({ title: 'Mataas na panganib · Maynila', body: 'banta ng baha ≈ 87/100', n: 'ñ😀' });
const body = push.encryptPayload(msg, ua.getPublicKey(), auth);
assert.equal(push.decryptPayload(body, ua, auth), msg);
assert.equal(body.readUInt32BE(16), 4096);
assert.equal(body[20], 65);
assert.throws(() => push.decryptPayload(Buffer.concat([body.subarray(0, body.length - 1), Buffer.from([0])]), ua, auth), 'tampering is detected');
const jwt = push.vapidJWT('https://fcm.googleapis.com', 1_800_000_000).split('.');
const pub = Buffer.from(push.publicKey, 'base64url');
assert.equal(pub.length, 65);
const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
assert.ok(crypto.verify('sha256', Buffer.from(`${jwt[0]}.${jwt[1]}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2], 'base64url')), 'VAPID JWT verifies with the public key');
assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).aud, 'https://fcm.googleapis.com');
assert.ok(push.validEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
assert.ok(push.validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
assert.ok(push.validEndpoint('https://web.push.apple.com/abc'));
for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com:8443/x', 'nonsense']) assert.equal(push.validEndpoint(bad), false, bad);

/* ---- HTTP level ---- */
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const get = async (p) => (await fetch(base + p)).json();
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; };
try {
  const rv = await get('/api/rivers');
  assert.ok(rv.rivers.length >= 10 && rv.rivers.some((r) => r.ok && r.level >= 2), 'demo rivers include a rising one');
  assert.ok(rv.rivers[0].level >= rv.rivers[rv.rivers.length - 1].level, 'sorted by level');
  const dm = await get('/api/dams');
  assert.equal(dm.dams.length, 9);
  assert.ok(dm.dams.every((d) => d.live && typeof d.margin === 'number'));

  const tr = await get('/api/trails?s=14.1&w=121.0&n=14.2&e=121.1');
  assert.ok(tr.trails.length >= 1 && tr.trails[0].lines[0].length > 5);
  assert.equal((await fetch(base + '/api/trails?s=10&w=120&n=14&e=124')).status, 400, 'huge bbox refused');
  const line = tr.trails[0].lines[0].map(([lat, lon]) => ({ lat, lon }));
  const pf = (await post('/api/profile', { points: line })).json;
  assert.ok(pf.profile.length >= 12 && pf.gain >= 0 && pf.max >= pf.min && pf.hours > 0 && pf.summit.risk, 'profile shape');
  assert.equal((await post('/api/profile', { points: [{ lat: 1, lon: 1 }] })).status, 400);

  const r1 = (await post('/api/reports', { type: 'closed', lat: 14.4, lon: 120.984, note: 'Sarado ang tulay' })).json;
  assert.ok(r1.id);
  assert.equal((await get('/api/reports?s=14&n=15&w=120.5&e=121.5')).reports.length, 1);
  assert.equal((await get('/api/point?lat=14.401&lon=120.984')).reports.length, 1, 'point report lists nearby road reports');
  const rt = (await post('/api/route', { mode: 'motorcycle', points: [{ lat: 14.6, lon: 121.0 }, { lat: 14.1, lon: 120.96 }] })).json;
  assert.ok(rt.routes.some((r) => r.closures.length), 'route sees the closure');
  assert.ok(rt.routes.every((r) => r.scoreNow <= 100));
  assert.equal((await post('/api/reports/vote', { id: r1.id, v: 'still' })).status, 200);
  assert.equal((await post('/api/reports/vote', { id: 'nope', v: 'still' })).status, 404);

  assert.equal((await get('/api/push/key')).publicKey, push.publicKey);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test123', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  assert.equal((await post('/api/push/subscribe', { subscription: sub, lat: 14.6, lon: 121.0, mode: 'motorcycle', minLevel: 2, lang: 'fil' })).status, 200);
  assert.equal(push.subCount(), 1);
  assert.equal((await post('/api/push/subscribe', { subscription: { ...sub, endpoint: 'https://evil.example.com/x' }, lat: 14.6, lon: 121 })).status, 400, 'SSRF guard');
  assert.equal((await post('/api/push/subscribe', { subscription: { ...sub, keys: { p256dh: 'AAAA', auth: 'AAAA' } }, lat: 14.6, lon: 121 })).status, 400, 'bad keys refused');
  const m = push.buildMessage({ id: 'x', lat: 14.6, lon: 121, mode: 'motorcycle', lang: 'fil' }, { a: { level: 2, score: 62, reasons: [{ k: 'flood' }, { k: 'rain' }] } }, 'Manila');
  assert.match(m.title, /Mataas na panganib/);
  assert.match(m.body, /banta ng baha/);
  assert.equal((await post('/api/push/unsubscribe', { endpoint: sub.endpoint })).json.ok, true);
  assert.equal(push.subCount(), 0);
  console.log('features test passed');
} finally {
  server.close();
}

// ---- v0.3: nav payload from /api/route (demo mode)
{
  const { server } = await import('../server/index.js');
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'motorcycle', points: [{ lat: 14.5995, lon: 120.9842 }, { lat: 14.1, lon: 121.3 }], nav: true }) });
  const j = await res.json();
  const r0 = j.routes[0];
  console.log(res.status === 200 && r0.full?.length > 2 && r0.steps?.length >= 2 && r0.steps[0].ty === 'depart' && r0.steps.at(-1).ty === 'arrive' && (j.routes.length < 2 || j.routes.slice(1).some((r) => r.steps.length >= 3)) && Array.isArray(r0.zones) ? 'ok   nav route payload (full/steps/zones)' : 'FAIL nav route payload ' + JSON.stringify(r0.steps?.slice(0, 2)));
  const plain = await (await fetch(`${base}/api/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'motorcycle', points: [{ lat: 14.5995, lon: 120.9842 }, { lat: 14.1, lon: 121.3 }] }) })).json();
  console.log(!plain.routes[0].steps && !plain.routes[0].full ? 'ok   plain route has no nav payload' : 'FAIL plain route leaks nav');
  server.close();
}
