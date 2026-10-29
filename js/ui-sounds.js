// Звуки интерфейса: тик ручек, каскад флажков табло, клавиши деки — через Web Audio.
// Почему не <audio>: на iPhone каждый короткий <audio> перехватывал «Сейчас играет» у потоков
// (шторка, экран блокировки и CarPlay управляли щелчком), а каждый его play() блокировал страницу.
// AudioBufferSourceNode не трогает «Сейчас играет» и запускается дёшево. Громкость 10% вшита в файлы.
// Ничего не создаётся при импорте; контекст и буферы — при первом звуке.
// На iPhone не подключается (app.js): работающий AudioContext прерывал поток — iOS ставила музыку
// на паузу, а play из шторки после этого не срабатывал (журнал ?debug, 29.10).

export const UI_SOUND_FILES = ['knob-tick.mp3', 'flap-cascade.mp3', 'flap-minute.mp3', 'key-down.mp3', 'key-up.mp3'];

export function createRateLimiter(minGapMs, now = () => performance.now()) {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < minGapMs) return false;
    last = t;
    return true;
  };
}

const defaultContext = () => {
  const C = globalThis.AudioContext || globalThis.webkitAudioContext;
  return C ? new C() : null;
};

export function createUiSounds({
  base = new URL('../sounds/', import.meta.url),
  createContext = defaultContext,
  fetchFn = (url) => fetch(url),
  now = () => performance.now(),
} = {}) {
  let ctx; // undefined — ещё не создавали; null — Web Audio недоступен
  const buffers = new Map();

  function decode(ab) {
    // callback-форма: работает и в старом Safari, где decodeAudioData не возвращает Promise
    return new Promise((ok, fail) => {
      try {
        const p = ctx.decodeAudioData(ab, ok, fail);
        if (p && p.catch) p.catch(fail);
      } catch (e) { fail(e); }
    });
  }

  function preload() {
    for (const file of UI_SOUND_FILES) {
      Promise.resolve()
        .then(() => fetchFn(new URL(file, base).href))
        .then((r) => r.arrayBuffer())
        .then(decode)
        .then((b) => { buffers.set(file, b); })
        .catch(() => {});
    }
  }

  // Контекст создаётся при первом звуке; звуки вызываются из нажатий, поэтому resume() здесь
  // попадает в жест (iOS будит контекст только так). Первый звук после загрузки может не
  // прозвучать — буферы ещё грузятся.
  function context() {
    if (ctx === undefined) {
      try { ctx = createContext(); } catch { ctx = null; }
      if (ctx) preload();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function play(file) {
    const c = context();
    const b = c && buffers.get(file);
    if (!b) return;
    try {
      const src = c.createBufferSource();
      src.buffer = b;
      src.connect(c.destination);
      src.start(0);
    } catch { /* контекст закрыт или занят — молчим */ }
  }

  const knobOk = createRateLimiter(28, now);
  const cascadeOk = createRateLimiter(250, now);

  return {
    knob() { if (knobOk()) play('knob-tick.mp3'); },
    // Каскад табло — один заранее сведённый файл на смену станции, не щелчок на каждый шаг флажка.
    cascade() { if (cascadeOk()) play('flap-cascade.mp3'); },
    minute() { play('flap-minute.mp3'); },
    keyDown() { play('key-down.mp3'); },
    keyUp() { play('key-up.mp3'); },
  };
}
