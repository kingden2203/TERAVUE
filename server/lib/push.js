/**
 * Web Push with zero dependencies: VAPID (RFC 8292, ES256 JWT) + message encryption (RFC 8291, aes128gcm).
 * No accounts: a subscription is just the browser's push endpoint + a rounded location + mode + threshold.
 * A background job checks each distinct location every 15 min and notifies when risk rises.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './reports.js';
import { forecast, marine, status } from './openmeteo.js';
import { assess, recordAt, normMode } from './risk.js';
import { zonesAt, nearestCity } from './places.js';
import { HttpError, snap } from './util.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

/* ---------------------------------------------------------------- VAPID keys */
const KEY_FILE = path.join(DATA_DIR, 'vapid.json');
function loadKeys() {
  try {
    const j = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    if (j.publicKey && j.privateJwk) return j;
  } catch { /* generate below */ }
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const keys = { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])), privateJwk: jwk };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, JSON.stringify(keys), { mode: 0o600 });
  } catch (err) {
    console.error('[terravue] could not persist VAPID keys (push subscriptions will break on restart):', err.message);
  }
  return keys;
}
const KEYS = loadKeys();
const PRIVATE = crypto.createPrivateKey({ key: KEYS.privateJwk, format: 'jwk' });
export const publicKey = KEYS.publicKey;
const SUBJECT = () => process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

export function vapidJWT(audience, now = Math.floor(Date.now() / 1000)) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: SUBJECT() }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: PRIVATE, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

/* ----------------------------------------------------------- RFC 8291 encrypt */
const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

export function encryptPayload(payload, uaPublic, authSecret) {
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);
  const ikm = hkdf(shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, data]);
}

/** Inverse of encryptPayload, used by the tests (and handy for debugging). */
export function decryptPayload(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const uaPublic = uaEcdh.getPublicKey();
  const shared = uaEcdh.computeSecret(asPublic);
  const ikm = hkdf(shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

/* ------------------------------------------------------------------- sending */
// Only real push services: the server POSTs to this URL, so never accept arbitrary hosts (SSRF).
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.microsoft\.com$/];
export function validEndpoint(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !x.port && PUSH_HOSTS.some((re) => re.test(x.hostname));
  } catch {
    return false;
  }
}

export async function sendPush(sub, payload, { ttl = 3600 } = {}) {
  const url = new URL(sub.endpoint);
  const body = encryptPayload(JSON.stringify(payload), unb64u(sub.keys.p256dh), unb64u(sub.keys.auth));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${vapidJWT(url.origin)}, k=${publicKey}`,
      'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(ttl), urgency: 'high',
    },
    body,
    signal: AbortSignal.timeout(12000),
  });
  return res.status;
}

/* --------------------------------------------------------------- subscriptions */
const FILE = path.join(DATA_DIR, 'subs.json');
let subs = new Map();
try { for (const s of JSON.parse(fs.readFileSync(FILE, 'utf8'))) subs.set(s.id, s); } catch { /* none yet */ }
let timer;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify([...subs.values()]), { mode: 0o600 });
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (err) {
      console.error('[terravue] could not save subscriptions:', err.message);
    }
  }, 800);
  timer.unref?.();
}
const idOf = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
const MAX_SUBS = 20000;

export function subscribe({ subscription, lat, lon, mode, minLevel, lang }) {
  const sb = subscription || {};
  if (!validEndpoint(sb.endpoint)) throw new HttpError(400, 'Unsupported push service');
  const p256dh = unb64u(sb.keys?.p256dh || ''), auth = unb64u(sb.keys?.auth || '');
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length < 16) throw new HttpError(400, 'Invalid subscription keys');
  lat = Number(lat); lon = Number(lon);
  if (!(lat >= 1 && lat <= 26 && lon >= 112 && lon <= 134)) throw new HttpError(400, 'Invalid location');
  const id = idOf(sb.endpoint);
  if (!subs.has(id) && subs.size >= MAX_SUBS) throw new HttpError(503, 'Subscription list is full');
  const prev = subs.get(id);
  subs.set(id, {
    id, endpoint: sb.endpoint, keys: { p256dh: sb.keys.p256dh, auth: sb.keys.auth },
    lat: snap(lat, 0.01), lon: snap(lon, 0.01), mode: normMode(mode), minLevel: [1, 2, 3].includes(+minLevel) ? +minLevel : 2,
    lang: lang === 'en' ? 'en' : 'fil', created: prev?.created || Date.now(), lastLevel: prev?.lastLevel ?? -1, lastSent: prev?.lastSent || 0,
  });
  save();
  return { id };
}

export function unsubscribe(endpoint) {
  const ok = subs.delete(idOf(String(endpoint || '')));
  if (ok) save();
  return { ok };
}

export const subCount = () => subs.size;

/* ----------------------------------------------------------------- the job */
const TXT = {
  fil: {
    lv: ['', 'Katamtamang panganib', 'Mataas na panganib', 'MATINDING panganib'],
    mode: { general: 'sa inyong lugar', motorcycle: 'para sa nagmomotor', hiker: 'para sa hiking', fisher: 'sa dagat' },
    why: { rain: 'malakas na ulan', gust: 'malakas na bugso ng hangin', thunder: 'thunderstorm', vis: 'malabong paningin', flood: 'banta ng baha', landslide: 'banta ng landslide', heat: 'matinding init', wave: 'malalaking alon', wind: 'malakas na hangin sa dagat' },
    soon: 'sa susunod na oras', test: 'Gumagana ang abiso. Makakatanggap ka ng alerto kapag tumaas ang panganib.',
  },
  en: {
    lv: ['', 'Moderate risk', 'High risk', 'SEVERE risk'],
    mode: { general: 'in your area', motorcycle: 'for riders', hiker: 'for hikers', fisher: 'at sea' },
    why: { rain: 'heavy rain', gust: 'strong gusts', thunder: 'thunderstorms', vis: 'poor visibility', flood: 'flood risk', landslide: 'landslide risk', heat: 'extreme heat', wave: 'high waves', wind: 'strong wind at sea' },
    soon: 'in the next hours', test: 'Alerts are working. You will be notified when risk rises.',
  },
};

export function buildMessage(sub, peak, place) {
  const T = TXT[sub.lang] || TXT.fil;
  const why = peak.a.reasons.slice(0, 2).map((r) => T.why[r.k] || r.k).join(', ');
  return {
    title: `${T.lv[peak.a.level]} ${T.mode[sub.mode]} · ${place}`,
    body: `${why || '—'} ${T.soon} (${peak.a.score}/100)`,
    tag: `tv-${sub.id}`, url: `./?lat=${sub.lat}&lon=${sub.lon}`,
  };
}
export const testMessage = (sub) => ({ title: 'TERRAVUE', body: (TXT[sub.lang] || TXT.fil).test, tag: 'tv-test', url: `./?lat=${sub.lat}&lon=${sub.lon}` });

export async function sendTest(endpoint) {
  const sub = subs.get(idOf(String(endpoint || '')));
  if (!sub) throw new HttpError(404, 'Not subscribed');
  const code = await sendPush(sub, testMessage(sub));
  if (code === 404 || code === 410) { subs.delete(sub.id); save(); throw new HttpError(410, 'Subscription expired. Enable alerts again.'); }
  return { status: code };
}

async function peakFor(lat, lon, mode, hours = 6) {
  const pt = [{ lat, lon }];
  const [fc, mr] = await Promise.all([forecast(pt, { full: false }), mode === 'fisher' ? marine(pt) : null]);
  const z = zonesAt(lat, lon);
  const ctx = { floodZone: z.some((x) => x.type === 'flood'), landslideZone: z.some((x) => x.type === 'landslide') };
  const t0 = Math.floor(Date.now() / 3600e3) * 3600;
  let peak = null;
  for (let h = 0; h < hours; h++) {
    const rec = recordAt(fc[0], mr ? mr[0] : null, t0 + h * 3600);
    const a = rec && assess(rec, mode, ctx);
    if (a && (!peak || a.score > peak.a.score)) peak = { a, t: rec.t };
  }
  return peak;
}

export async function runPushJob() {
  if (!subs.size || status.demoForced) return { checked: 0, sent: 0 };
  let sent = 0, checked = 0;
  const cache = new Map();
  for (const sub of [...subs.values()]) {
    try {
      const k = `${sub.lat},${sub.lon},${sub.mode}`;
      if (!cache.has(k)) cache.set(k, await peakFor(sub.lat, sub.lon, sub.mode));
      const peak = cache.get(k);
      checked++;
      if (!peak) continue;
      const lvl = peak.a.level;
      const due = lvl >= sub.minLevel && (lvl > sub.lastLevel || Date.now() - sub.lastSent > 6 * 3600e3);
      if (lvl < sub.minLevel) { if (sub.lastLevel !== -1) { sub.lastLevel = -1; save(); } continue; }
      if (!due) continue;
      const code = await sendPush(sub, buildMessage(sub, peak, nearestCity(sub.lat, sub.lon)?.name || ''));
      if (code === 404 || code === 410) { subs.delete(sub.id); save(); continue; }
      if (code >= 200 && code < 300) { sub.lastLevel = lvl; sub.lastSent = Date.now(); sent++; save(); }
    } catch (err) {
      console.error('[terravue] push job:', err.message);
    }
  }
  return { checked, sent };
}

export function startPushJob() {
  if (process.env.TERRAVUE_PUSH === '0') return;
  const t = setInterval(() => runPushJob().catch((e) => console.error('[terravue] push job:', e.message)), 15 * 60e3);
  t.unref?.();
}
