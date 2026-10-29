// Service worker ATC Live Radio v3. Лежит в v3/, поэтому его scope — эта папка
// (на пробном этапе /lofiatcradio/v3/); сервис-воркер v2 в родительской папке не затрагивается.
const CACHE = 'lofiatc-v3-1';

const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/device.css',
  'fonts/teko-latin-400-normal.woff2',
  'fonts/teko-latin-500-normal.woff2',
  'fonts/teko-latin-600-normal.woff2',
  'js/app.js',
  'js/audio-logic.js',
  'js/audio.js',
  'js/board.js',
  'js/flap.js',
  'js/knob-math.js',
  'js/knob-sounds.js',
  'js/knob.js',
  'js/radar-data.js',
  'js/reel-math.js',
  'js/reel.js',
  'js/state.js',
  'js/stations.js',
  'js/switcher.js',
  'sounds/knob-click-1.mp3',
  'sounds/knob-click-2.mp3',
  'sounds/knob-click-3.mp3',
  'sounds/knob-press.mp3',
  'stations.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

// Эфир, лофи-поток и радар — всегда напрямую, мимо кеша.
const BYPASS_HOSTS = ['liveatc.net', 'laut.fm', 'radar.afood.pro'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await refresh;
  return response || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return;
  if (url.origin !== self.location.origin) return;

  const isHtml = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
  event.respondWith(isHtml ? networkFirst(request) : staleWhileRevalidate(request));
});
