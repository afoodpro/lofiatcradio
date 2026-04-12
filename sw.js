const CACHE = 'lofiatc-v3';

const SHELL = [
  '/lofiatcradio/',
  '/lofiatcradio/index.html',
  '/lofiatcradio/app.js',
  '/lofiatcradio/style.css',
  '/lofiatcradio/assets/font/Teko-Regular.ttf',
  '/lofiatcradio/manifest.json',
  '/lofiatcradio/icon.svg',
  '/lofiatcradio/og-image.svg',
];

// Audio stream hostnames — never cache these
const STREAM_HOSTS = ['liveatc.net', 'laut.fm'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept audio streams — must go to network
  if (STREAM_HOSTS.some(h => url.hostname.includes(h))) return;

  // Cache-first for everything else (app shell)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
