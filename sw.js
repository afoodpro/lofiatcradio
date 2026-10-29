// Service worker ATC Live Radio v3. Лежит в корне сайта, scope — /lofiatcradio/ (тот же, что был у v2):
// браузер находит его как обновление воркера v2 и при первом открытии переводит устройство на v3.
// CACHE нужно поднимать при каждом изменении списка SHELL.
const CACHE = 'lofiatc-v3-12';

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
const BYPASS_HOSTS = ['liveatc.net', 'hostingradio.ru', 'radar.afood.pro'];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' — мимо HTTP-кеша Pages (max-age=600), иначе после выката версии модулей смешаются
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()),
  );
});

// Origin общий с другими сайтами Pages: трогаем только свои кеши (lofiatc-v13 от v2, старые lofiatc-v3-*).
// Если старый кеш нашёлся, это первая активация после v2 или прошлой версии v3: открытые вкладки
// и приложение с домашнего экрана один раз перезагружаются в текущую версию. Повторная загрузка
// новой активации не вызывает, поэтому зацикливания нет; на чистом устройстве перезагрузки нет.
async function activate() {
  const keys = await caches.keys();
  const stale = keys.filter((k) => k.startsWith('lofiatc-') && k !== CACHE);
  await Promise.all(stale.map((k) => caches.delete(k)));
  await self.clients.claim();
  if (stale.length === 0) return;
  const scope = self.registration.scope;
  const windows = await self.clients.matchAll({ type: 'window' });
  // navigate() не ждём: перезагрузка идёт через fetch этого же воркера, а fetch-события браузер
  // придерживает до конца активации. С await активация и перезагрузка ждали бы друг друга
  // до таймаута события (5 минут в Chrome).
  for (const client of windows) {
    if (client.url.startsWith(scope)) client.navigate(client.url).catch(() => {});
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(activate());
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
