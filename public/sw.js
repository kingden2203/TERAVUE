// TERRAVUE service worker: offline shell, offline map tiles, last-known API answers, and push notifications.
const V = 'v3';
const SHELL = `terravue-shell-${V}`;
const LIB = `terravue-lib-${V}`;
const TILES = 'terravue-tiles'; // tiles seen while browsing (capped)
const API = 'terravue-api'; // last good answer of each API call (capped)
// caches named terravue-area-* hold the map areas the user saved on purpose; they are never evicted here.

const SHELL_FILES = [
  './', 'css/app.css', 'icon.svg', 'icon-192.png',
  ...['main', 'panels', 'i18n', 'i18n-extra', 'field', 'wind', 'hydro', 'trails', 'reports', 'offline', 'push', 'nav', 'navcore'].map((n) => `js/${n}.js`),
];
const API_CACHEABLE = /^\/api\/(point|alerts|storms|rivers|dams|zones|trails|reports|geocode)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => /^terravue-(shell|lib)-/.test(k) && k !== SHELL && k !== LIB).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const withHeader = (headers, k, v) => {
  const h = new Headers(headers);
  h.set(k, v);
  return h;
};
async function trim(cache, max) {
  const ks = await cache.keys();
  for (let i = 0; i < ks.length - max; i++) await cache.delete(ks[i]);
}
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function apiFirst(req) {
  const cache = await caches.open(API);
  try {
    const res = await timeout(fetch(req), 9000);
    if (res.ok) {
      const body = await res.clone().blob();
      await cache.put(req.url, new Response(body, { status: 200, headers: withHeader(res.headers, 'x-terravue-saved', String(Date.now())) }));
      trim(cache, 150);
    }
    return res;
  } catch {
    const hit = await cache.match(req.url);
    if (hit) return new Response(await hit.blob(), { status: 200, headers: withHeader(hit.headers, 'x-terravue-stale', '1') });
    return new Response(JSON.stringify({ error: 'Offline' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
}

async function shellFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
    return res;
  } catch {
    return (await caches.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function swr(req) {
  const cache = await caches.open(LIB);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

// Leaflet picks a random a-d subdomain; store/look up every tile under "a" (offline.js uses the same rule).
const normTile = (u) => u.replace(/^https:\/\/[b-d]\.basemaps\.cartocdn\.com/, 'https://a.basemaps.cartocdn.com');
async function tile(req) {
  const key = normTile(req.url);
  const hit = await caches.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      const c = await caches.open(TILES);
      c.put(key, res.clone());
      if (Math.random() < 0.05) trim(c, 1200);
    }
    return res;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/')) {
      if (API_CACHEABLE.test(u.pathname)) e.respondWith(apiFirst(req));
      return;
    }
    e.respondWith(shellFirst(req));
  } else if (/(^|\.)basemaps\.cartocdn\.com$/.test(u.hostname)) {
    e.respondWith(tile(req));
  } else if (/^(unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname)) {
    e.respondWith(swr(req));
  }
  // radar frames, satellite tiles etc. always go to the network: an old radar picture is worse than none
});

/* ------------------------------------------------------------- push alerts */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'TERRAVUE', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(
    self.registration.showNotification(d.title || 'TERRAVUE', {
      body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || 'terravue', renotify: true, data: { url: d.url || './' },
    }),
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) { c.navigate?.(url); return c.focus(); }
      }
      return clients.openWindow(url);
    }),
  );
});
