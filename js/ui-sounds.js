// Звуки интерфейса: тик ручек, каскад флажков табло, клавиши деки. Обычные <audio> (работает и на iOS,
// где громкость <audio> менять нельзя — 10% вшито в файлы, поэтому .volume не трогаем).
// Ничего не создаётся при импорте — только при вызове createUiSounds.

export function createRateLimiter(minGapMs, now = () => performance.now()) {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < minGapMs) return false;
    last = t;
    return true;
  };
}

export function pickVariant(n, prev, rand = Math.random) {
  if (n <= 1) return 0;
  const v = Math.floor(rand() * (n - 1));
  return v >= prev ? v + 1 : v;
}

function play(a) {
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* автоплей запрещён — молчим */ }
}

export function createUiSounds({
  base = new URL('../sounds/', import.meta.url),
  createAudio = (src) => new Audio(src),
  now = () => performance.now(),
} = {}) {
  const make = (file) => {
    const a = createAudio(new URL(file, base).href);
    a.preload = 'auto';
    return a;
  };
  // Пул по кругу: перекрывающиеся щелчки не обрывают друг друга.
  const pool = (files, size) => {
    const items = Array.from({ length: size }, (_, i) => make(files[i % files.length]));
    let next = 0;
    return () => items[next++ % items.length];
  };

  // Аудио создаются лениво при первом звуке: импорт и создание объекта ничего не трогают.
  const lazy = (build) => {
    let fn = null;
    return () => (fn ??= build())();
  };

  const knobPool = lazy(() => pool(['knob-tick.mp3'], 4));
  // Каскад табло — один заранее сведённый файл на смену станции, а не щелчок на каждый шаг флажка:
  // в WebKit (iPhone) каждый play() у <audio> блокирует страницу, и 30–40 запусков подряд рвали анимацию.
  const cascadePool = lazy(() => pool(['flap-cascade.mp3'], 2));
  const minutePool = lazy(() => pool(['flap-minute.mp3'], 1));
  const downPool = lazy(() => pool(['key-down.mp3'], 2));
  const upPool = lazy(() => pool(['key-up.mp3'], 2));
  const knobOk = createRateLimiter(28, now);
  const cascadeOk = createRateLimiter(250, now);

  return {
    knob() { if (knobOk()) play(knobPool()); },
    cascade() { if (cascadeOk()) play(cascadePool()); },
    minute() { play(minutePool()); },
    keyDown() { play(downPool()); },
    keyUp() { play(upPool()); },
  };
}
