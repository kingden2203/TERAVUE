/**
 * Community road reports (flooded road, closed road, landslide, fallen tree/pole, damaged road/bridge).
 * No login: reports expire on their own, are rate-limited per (hashed) IP, duplicates are merged into a
 * "confirm", and two independent "wala na" votes remove a report. Stored in a small JSON file.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { haversineKm, HttpError } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.TERRAVUE_DATA || path.resolve(__dirname, '../../data');
const FILE = path.join(DATA_DIR, 'reports.json');
const H = 3600e3;
export const TYPES = { flood: 12 * H, closed: 24 * H, landslide: 24 * H, fallen: 12 * H, damaged: 48 * H };
const SALT = process.env.TERRAVUE_SALT || 'terravue';
const MAX_REPORTS = 3000;

let reports = [];
try { reports = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { reports = []; }

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(reports));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (err) {
      console.error('[terravue] could not save reports:', err.message);
    }
  }, 800);
  saveTimer.unref?.();
}

export const hashIp = (ip) => crypto.createHash('sha256').update(SALT + String(ip)).digest('hex').slice(0, 8);
const alive = (r, now = Date.now()) => now - r.u < TYPES[r.type];
function purge() {
  const n = reports.length;
  reports = reports.filter((r) => alive(r));
  if (reports.length !== n) save();
}
const view = ({ by, gb, ...r }) => ({ ...r, age: Math.max(0, Math.round((Date.now() - r.u) / 60e3)) });

const hits = new Map(); // ipHash -> timestamps
function rateOk(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < H);
  if (arr.length >= 6) return false;
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < H)) hits.delete(k);
  return true;
}

export function addReport({ type, lat, lon, note }, ip) {
  if (!TYPES[type]) throw new HttpError(400, 'Invalid type');
  lat = Number(lat); lon = Number(lon);
  if (!(lat >= 1 && lat <= 26 && lon >= 112 && lon <= 134)) throw new HttpError(400, 'Invalid location');
  note = String(note || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  purge();
  const dupe = reports.find((r) => r.type === type && haversineKm(r, { lat, lon }) <= 0.15);
  if (dupe) {
    if (!dupe.by.includes(ip)) {
      dupe.by.push(ip);
      dupe.confirms++;
    }
    dupe.u = Date.now();
    save();
    return { id: dupe.id, merged: true, report: view(dupe) };
  }
  if (!rateOk(ip)) throw new HttpError(429, 'Too many reports. Try again later.');
  const now = Date.now();
  const r = { id: crypto.randomBytes(6).toString('hex'), type, lat: +lat.toFixed(5), lon: +lon.toFixed(5), note, t: now, u: now, confirms: 1, by: [ip], gb: [] };
  reports.push(r);
  if (reports.length > MAX_REPORTS) reports.shift();
  save();
  return { id: r.id, merged: false, report: view(r) };
}

export function vote(id, v, ip) {
  purge();
  const r = reports.find((x) => x.id === id);
  if (!r) throw new HttpError(404, 'Report not found (maybe already expired)');
  if (v === 'still') {
    if (!r.by.includes(ip)) { r.by.push(ip); r.confirms++; }
    r.u = Date.now();
  } else if (v === 'gone') {
    if (!r.gb.includes(ip)) r.gb.push(ip);
    if (r.gb.length >= 2 || r.by[0] === ip) reports = reports.filter((x) => x !== r);
  } else throw new HttpError(400, 'Invalid vote');
  save();
  return { ok: true, removed: !reports.includes(r) };
}

export function listReports(bbox) {
  purge();
  let list = reports;
  if (bbox) list = list.filter((r) => r.lat >= bbox.s && r.lat <= bbox.n && r.lon >= bbox.w && r.lon <= bbox.e);
  return list.slice(-400).map(view);
}

export function reportsAround(lat, lon, km = 5) {
  purge();
  const p = { lat, lon };
  return reports.map((r) => ({ r, d: haversineKm(p, r) })).filter((x) => x.d <= km).sort((a, b) => a.d - b.d).slice(0, 8)
    .map(({ r, d }) => ({ ...view(r), km: +d.toFixed(1) }));
}

/** Distance (km) from a point to a segment, flat-earth approximation (fine for < a few km). */
function distSeg(p, a, b) {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const px = p.lon * k, py = p.lat, ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0];
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 111.2;
}

/** Active reports within `km` of a polyline [[lat,lon],...]. */
export function reportsNear(coords, km = 0.5) {
  purge();
  if (!reports.length || coords.length < 2) return [];
  let s = 90, n = -90, w = 180, e = -180;
  for (const [la, lo] of coords) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  const pad = 0.02;
  const out = [];
  for (const r of reports) {
    if (r.lat < s - pad || r.lat > n + pad || r.lon < w - pad || r.lon > e + pad) continue;
    for (let i = 1; i < coords.length; i++) {
      if (distSeg(r, coords[i - 1], coords[i]) <= km) { out.push(view(r)); break; }
    }
  }
  return out;
}

export const _reset = () => { reports = []; hits.clear(); };
