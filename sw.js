// Offline-first service worker.
// - App files: served from the cache at once (works with no internet) and refreshed in the background.
// - Label reader (≈7MB): saved in the background after install, so it also works offline.
// - Google Fonts: cached the first time they load.
// - Product database / AI requests are never cached (they need the internet).
const VERSION = 'kalori-v14';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'scan.js', 'manifest.json',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'vendor/barcode.js', 'vendor/zxing_reader.wasm'];
const OCR = ['vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tesseract/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/lang/heb.traineddata.gz', 'vendor/tesseract/lang/eng.traineddata.gz'];
const STATIC = 'kalori-static-v1'; // big files that never change; kept across app updates
const FONTS = 'kalori-fonts-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [VERSION, STATIC, FONTS];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
    // fetch the label reader in the background; a failure here is fine, it is retried on next start
    const c = await caches.open(STATIC);
    for (const u of OCR) { if (!(await c.match(u))) { try { await c.add(u); } catch (err) { /* offline now */ } } }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONTS));
    return;
  }
  if (url.origin !== location.origin) return; // product database, AI: network only
  if (url.searchParams.has('__probe')) return;   // connectivity check: always the real network

  if (url.pathname.includes('/vendor/tesseract/')) {
    e.respondWith(cacheFirst(req, STATIC));
    return;
  }
  // app files: cache first, refresh in background (stale-while-revalidate)
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('', { status: 504 });
  })());
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
