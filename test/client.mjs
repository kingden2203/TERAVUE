// Client-side logic that can run in Node: trail chaining, offline tile planning, escaping, i18n completeness.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/js');
const { chain } = await import(path.join(root, 'trails.js'));
const { planTiles, normTile } = await import(path.join(root, 'offline.js'));
const { esc, reportCard } = await import(path.join(root, 'panels.js'));
const i18n = await import(path.join(root, 'i18n.js'));
const { EXTRA } = await import(path.join(root, 'i18n-extra.js'));

// chain(): joins ways end to end, flipping them when needed
const A = [[14, 121], [14.01, 121.01]], B = [[14.02, 121.02], [14.01, 121.01]], C = [[14.02, 121.02], [14.03, 121.03]];
const c = chain([A, B, C]);
assert.equal(c.length, 4);
assert.deepEqual([c[0], c[3]].sort(), [[14, 121], [14.03, 121.03]].sort());
assert.equal(chain([A, [[15, 122], [15.1, 122.1]]]).length, 2, 'unconnected pieces are not glued together');

// planTiles(): stays under the cap and covers the base zoom first
const b = { getWest: () => 120.9, getEast: () => 121.1, getNorth: () => 14.7, getSouth: () => 14.5 };
const urls = planTiles(b, 11, (z, x, y) => `t/${z}/${x}/${y}`);
assert.ok(urls.length > 0 && urls.length <= 350, `tiles ${urls.length}`);
assert.ok(urls.some((u) => u.startsWith('t/11/')));
assert.ok(planTiles({ getWest: () => 116, getEast: () => 127, getNorth: () => 21, getSouth: () => 5 }, 12, () => 'x').length <= 350, 'huge view cannot blow the cap');
assert.equal(normTile('https://c.basemaps.cartocdn.com/dark_all/5/1/2.png'), 'https://a.basemaps.cartocdn.com/dark_all/5/1/2.png');

// user text is escaped
const html = reportCard({ id: 'x"><img src=x onerror=alert(1)>', type: 'flood', note: '<script>alert(1)</script>', age: 5, confirms: 1 });
assert.ok(!/<script|<img/i.test(html), 'no raw tags from user input');
assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');

// i18n: both languages have the same keys, and every literal t('key') used in the code exists
for (const k of Object.keys(EXTRA.fil)) assert.ok(k in EXTRA.en, `missing EN: ${k}`);
for (const k of Object.keys(EXTRA.en)) assert.ok(k in EXTRA.fil, `missing FIL: ${k}`);
const src = fs.readdirSync(root).filter((f) => f.endsWith('.js') && !f.startsWith('i18n')).map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const html0 = fs.readFileSync(path.join(root, '../index.html'), 'utf8');
const used = new Set([...src.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)].map((m) => m[1]));
for (const m of html0.matchAll(/data-i18n(?:-ph|-title)?="([^"]+)"/g)) used.add(m[1]);
const dict = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8') + fs.readFileSync(path.join(root, 'i18n-extra.js'), 'utf8');
// keys built at run time ('rv.' + level ...): check every variant
const families = { 'rv.': [0, 1, 2, 3], 'dm.': [0, 1, 2, 3], 'lv.': [0, 1, 2, 3], 'verdict.': [0, 1, 2, 3], 'sac.': [0, 1, 2, 3, 4], 'rp.': ['flood', 'closed', 'landslide', 'fallen', 'damaged'], 'mode.': ['general', 'motorcycle', 'hiker', 'fisher'], 'r.': ['rain', 'gust', 'thunder', 'vis', 'flood', 'floodriver', 'landslide', 'heat', 'wave', 'wind'] };
for (const k of [...used].filter((k) => k.endsWith('.'))) {
  used.delete(k);
  assert.ok(families[k], `unknown dynamic key family ${k}`);
  for (const v of families[k]) used.add(k + v);
}
const missing = [...used].filter((k) => !dict.includes(`'${k}'`) && !dict.includes(`\n    ${k}:`) && !new RegExp(`[\\s{,]${k.replace('.', '\\.')}:`).test(dict));
assert.deepEqual(missing, [], `i18n keys used but not defined: ${missing.join(', ')}`);
console.log('client test passed (' + used.size + ' i18n keys checked)');
