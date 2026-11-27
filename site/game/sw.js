// Strait Shadow offline cache. The game page is fetched fresh whenever there is a connection (so a new version arrives on the next
// online launch) and comes from the cache when there is none. The 3D library and the fonts come from the cache first: they never change.
const CACHE = 'strait-shadow-v1';
const CORE = ['./', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    // the page: network first, saved under './' so it opens offline from any address in this folder
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./', copy)); }
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  const fixed = url.origin === self.location.origin || url.hostname === 'cdnjs.cloudflare.com'
    || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!fixed) return;
  // everything else the game uses: cache first, saved on first use (the font files are only known once the font list has loaded)
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
