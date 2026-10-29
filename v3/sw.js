// Пробный путь /lofiatcradio/v3/ закрыт: v3 переехала в корень сайта.
// Этот воркер — обновление пробного: он удаляет кеши пробного этапа, снимает свою регистрацию
// и отправляет открытые вкладки в корень. Кеши пробного этапа — lofiatc-v3-1…lofiatc-v3-8;
// с lofiatc-v3-9 начинаются кеши воркера в корне, их не трогаем.
const LAST_TRIAL_CACHE = 8;

function isTrialCache(key) {
  const m = /^lofiatc-v3-(\d+)$/.exec(key);
  return m !== null && Number(m[1]) <= LAST_TRIAL_CACHE;
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(isTrialCache).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map((client) => client.navigate(new URL('../', self.registration.scope).href).catch(() => {})));
  })());
});
