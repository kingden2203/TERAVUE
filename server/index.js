import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { pointReport, gridReport, routeReport, alertsReport, stormsReport, geocode, hazardZones } from './lib/service.js';
import { isDemo, status } from './lib/openmeteo.js';
import { riversReport, damsReport } from './lib/hydro.js';
import { trailsReport, profileReport } from './lib/trails.js';
import { addReport, vote, listReports, hashIp } from './lib/reports.js';
import * as push from './lib/push.js';
import { HttpError } from './lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/* ---- very small per-IP rate limiter for /api (no accounts, so protect the free upstreams) ---- */
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.reset) h = { n: 0, reset: now + 60_000 };
  h.n++;
  hits.set(ip, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  return h.n > 150;
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(body);
}
const json = (res, code, obj, maxAge = 0) =>
  send(res, code, JSON.stringify(obj), {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
  });

const num = (v, name, lo, hi) => {
  const x = Number(v);
  if (v == null || v === '' || !Number.isFinite(x) || x < lo || x > hi) throw new HttpError(400, `Invalid ${name}`);
  return x;
};
// TERRAVUE covers the Philippines and its seas (with a margin)
const lat = (v) => num(v, 'lat', 1, 26);
const lon = (v) => num(v, 'lon', 112, 134);

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 24_000) throw new HttpError(413, 'Body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const clientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
const bbox = (q, span = 90) => ({ s: lat(q.get('s')), n: lat(q.get('n')), w: lon(q.get('w')), e: lon(q.get('e')), span });
const needPost = (req) => { if (req.method !== 'POST') throw new HttpError(405, 'POST only'); };

async function api(req, res, url) {
  const q = url.searchParams;
  switch (url.pathname) {
    case '/api/health':
      return json(res, 200, { ok: true, demo: isDemo(), lastError: status.lastError, uptime: Math.round(process.uptime()) });
    case '/api/point':
      return json(res, 200, await pointReport({ lat: lat(q.get('lat')), lon: lon(q.get('lon')), mode: q.get('mode') }));
    case '/api/grid':
      return json(res, 200, await gridReport({
        s: lat(q.get('s')), n: lat(q.get('n')), w: lon(q.get('w')), e: lon(q.get('e')),
        mode: q.get('mode'), withMarine: q.get('m') === '1',
      }));
    case '/api/route': {
      if (req.method !== 'POST') throw new HttpError(405, 'POST only');
      const b = await readBody(req);
      (b.points || []).forEach((p) => { lat(p.lat); lon(p.lon); });
      return json(res, 200, await routeReport({ mode: b.mode, points: b.points, speedKn: b.speedKn, nav: b.nav === true }));
    }
    case '/api/alerts':
      return json(res, 200, await alertsReport(), 120);
    case '/api/storms':
      return json(res, 200, await stormsReport(), 300);
    case '/api/zones':
      return json(res, 200, { zones: hazardZones() }, 3600);
    case '/api/rivers':
      return json(res, 200, await riversReport(), 600);
    case '/api/dams':
      return json(res, 200, await damsReport(), 600);
    case '/api/trails': {
      const b = bbox(q);
      if (!(b.n > b.s && b.e > b.w)) throw new HttpError(400, 'Invalid bbox');
      return json(res, 200, await trailsReport(b), 3600);
    }
    case '/api/profile': {
      needPost(req);
      return json(res, 200, await profileReport(await readBody(req)));
    }
    case '/api/reports': {
      if (req.method === 'POST') return json(res, 200, addReport(await readBody(req), hashIp(clientIp(req))));
      const b = q.has('s') ? bbox(q) : null;
      return json(res, 200, { reports: listReports(b) });
    }
    case '/api/reports/vote': {
      needPost(req);
      const b = await readBody(req);
      return json(res, 200, vote(String(b.id || ''), b.v, hashIp(clientIp(req))));
    }
    case '/api/push/key':
      return json(res, 200, { publicKey: push.publicKey }, 3600);
    case '/api/push/subscribe':
      needPost(req);
      return json(res, 200, push.subscribe(await readBody(req)));
    case '/api/push/unsubscribe':
      needPost(req);
      return json(res, 200, push.unsubscribe((await readBody(req)).endpoint));
    case '/api/push/test':
      needPost(req);
      return json(res, 200, await push.sendTest((await readBody(req)).endpoint));
    case '/api/geocode':
      return json(res, 200, await geocode(q.get('q')), 600);
    default:
      throw new HttpError(404, 'Not found');
  }
}

const gz = new Map();
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return send(res, 403, 'Forbidden');
  let st;
  try {
    st = await stat(file);
    if (!st.isFile()) throw new Error('nf');
  } catch {
    return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
  }
  const ext = path.extname(file);
  const type = MIME[ext] || 'application/octet-stream';
  const headers = {
    'content-type': type,
    'cache-control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600',
  };
  let body = await readFile(file);
  if (/\b(gzip)\b/.test(req.headers['accept-encoding'] || '') && /^(text|application\/(json|manifest)|image\/svg)/.test(type) && body.length > 1024) {
    const k = file + st.mtimeMs;
    if (!gz.has(k)) gz.set(k, zlib.gzipSync(body));
    body = gz.get(k);
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
  }
  send(res, 200, body, headers);
}

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      if (limited(ip)) return json(res, 429, { error: 'Too many requests. Subukan ulit mamaya.' });
      return await api(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url);
  } catch (err) {
    const code = err instanceof HttpError ? err.status : 500;
    if (code === 500) console.error('[terravue]', err);
    if (!res.headersSent) json(res, code, { error: code === 500 ? 'Server error' : err.message });
  }
};

// HTTPS straight from Node (needed for GPS + push on a phone): TLS_CERT=cert.pem TLS_KEY=key.pem  (mkcert works well on a LAN)
const TLS = process.env.TLS_CERT && process.env.TLS_KEY ? { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) } : null;
export const server = TLS ? https.createServer(TLS, handler) : http.createServer(handler);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    push.startPushJob();
    const proto = TLS ? 'https' : 'http';
    console.log(`TERRAVUE running on ${proto}://localhost:${PORT}${status.demoForced ? '  (DEMO DATA mode)' : ''}`);
    for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  on your phone (same WiFi): ${proto}://${n.address}:${PORT}${TLS ? '' : '   (GPS/push need HTTPS: see DEPLOY.md)'}`);
  });

}
