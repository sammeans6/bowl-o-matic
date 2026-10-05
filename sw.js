// Network-first service worker: always tries for the latest version, falls
// back to the cached copy when offline (e.g. at a party with bad Wi-Fi).
const CACHE = 'bowlomatic-v13';
// The app itself is app.bin (encrypted); lock.js opens it with the owner's code.
const SHELL = ['./', 'index.html', 'lock.js', 'app.bin', 'manifest.webmanifest', 'icons/icon-180.png'];
// 18+ clips (clips/*.bin, encrypted). Their names change whenever a clip changes,
// so they're served from this cache first and kept across app updates.
const CLIPS = 'bowlomatic-clips';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CLIPS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin && /\/clips\/c\d+-[0-9a-f]+\.bin$/.test(url.pathname)) {
    e.respondWith(
      caches.open(CLIPS).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }))),
    );
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes('fonts.g'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
