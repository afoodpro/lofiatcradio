// Service worker ATC Live Radio v3. Лежит в v3/, поэтому его scope — эта папка
// (на пробном этапе /lofiatcradio/v3/); сервис-воркер v2 в родительской папке не затрагивается.
// CACHE нужно поднимать при каждом изменении списка SHELL.
const CACHE = 'lofiatc-v3-7';

const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/device.css',
  'fonts/teko-latin-400-normal.woff2',
  'fonts/teko-latin-500-normal.woff2',
  'fonts/teko-latin-600-normal.woff2',
  'fonts/oswald-cyrillic-400-normal.woff2',
  'fonts/oswald-cyrillic-500-normal.woff2',
  'fonts/oswald-latin-400-normal.woff2',
  'fonts/oswald-latin-500-normal.woff2',
  'js/app.js',
  'js/audio-logic.js',
  'js/audio.js',
  'js/board.js',
  'js/flap.js',
  'js/knob-math.js',
  'js/knob.js',
  'js/motion.js',
  'js/passport.js',
  'js/radar-data.js',
  'js/reel-math.js',
  'js/reel.js',
  'js/state.js',
  'js/stations.js',
  'js/switcher.js',
  'js/ui-sounds.js',
  'sounds/knob-tick.mp3',
  'sounds/flap-1.mp3',
  'sounds/flap-2.mp3',
  'sounds/flap-3.mp3',
  'sounds/flap-4.mp3',
  'sounds/flap-5.mp3',
  'sounds/key-down.mp3',
  'sounds/key-up.mp3',
  'stations.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

// Эфир, лофи-поток и радар — всегда напрямую, мимо кеша.
const BYPASS_HOSTS = ['liveatc.net', 'laut.fm', 'radar.afood.pro'];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' — мимо HTTP-кеша Pages (max-age=600), иначе после выката версии модулей смешаются
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Origin общий с другими сайтами Pages и v2 (lofiatc-v13): трогаем только свои старые кеши.
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lofiatc-v3-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Всё своё — сначала сеть (чтобы после выката файлы не смешивались по версиям),
// при сбое или через 4 с — кеш. Обновление кеша живёт до конца через waitUntil.
async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS));
  try {
    const response = await Promise.race([fetch(request, { cache: 'no-cache' }), timeout]);
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return;
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event));
});
