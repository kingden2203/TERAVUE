// Smoke test: boots the server in demo mode and checks every endpoint's shape.
process.env.TERRAVUE_DEMO = '1';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
process.env.TERRAVUE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-smoke-'));
const { server } = await import('../server/index.js');
import assert from 'node:assert/strict';

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const get = async (p) => (await fetch(base + p)).json();
const post = async (p, b) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();

try {
  const h = await get('/api/health');
  assert.equal(h.ok, true);

  const p = await get('/api/point?lat=14.6&lon=121&mode=motorcycle');
  assert.ok(p.now && p.modes.fisher && p.timeline.length >= 24, 'point shape');
  assert.ok(p.timeline.every((x) => x.score >= 0 && x.score <= 100));

  const sea = await get('/api/point?lat=12.5&lon=120.4&mode=fisher');
  assert.equal(sea.isSea, true, 'sea point detected');
  assert.ok(sea.now.wave > 0);

  const g = await get('/api/grid?s=8&n=16&w=118&e=126&m=1&mode=general');
  assert.equal(g.fields.risk.length, g.nx * g.ny);
  assert.ok(g.fields.wave.some((v) => v != null) && g.fields.wave.some((v) => v == null), 'wave has sea + land');

  const r = await post('/api/route', { mode: 'motorcycle', points: [{ lat: 14.6, lon: 121 }, { lat: 14.1, lon: 120.96 }] });
  assert.ok(r.routes.length >= 1 && r.routes[0].departures.length === 13 && r.routes[0].samples.length >= 4, 'route shape');
  assert.ok(['go', 'wait', 'caution', 'avoid'].includes(r.advice.action));

  const f = await post('/api/route', { mode: 'fisher', points: [{ lat: 12.5, lon: 120.4 }, { lat: 11.5, lon: 121.5 }], speedKn: 8 });
  assert.equal(f.routes[0].sea, true);

  const a = await get('/api/alerts');
  assert.ok(Array.isArray(a.alerts));
  assert.equal((await get('/api/point?lat=abc&lon=1')).error, 'Invalid lat');
  assert.equal((await get('/api/point?lat=40&lon=1')).error, 'Invalid lat', 'outside coverage rejected');
  const html = await (await fetch(base + '/')).text();
  assert.ok(html.includes('TERRAVUE'));
  assert.equal((await fetch(base + '/%2e%2e/server/index.js')).status === 200, false, 'no path traversal');
  console.log('smoke test passed');
} finally {
  server.close();
}
