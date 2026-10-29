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
  const flapFiles = Array.from({ length: 5 }, (_, i) => `flap-${i + 1}.mp3`);
  const downPool = lazy(() => pool(['key-down.mp3'], 2));
  const upPool = lazy(() => pool(['key-up.mp3'], 2));
  const knobOk = createRateLimiter(28);
  const flapOk = createRateLimiter(38);
  let flapPrev = -1;
  const flapItems = [];

  return {
    knob() { if (knobOk()) play(knobPool()); },
    flap() {
      if (!flapOk()) return;
      // 5 вариантов, не повторяя предыдущий; у каждого свой маленький пул (всего 10 элементов).
      if (!flapItems.length) flapFiles.forEach((f) => flapItems.push(pool([f], 2)));
      flapPrev = pickVariant(flapItems.length, flapPrev);
      play(flapItems[flapPrev]());
    },
    keyDown() { play(downPool()); },
    keyUp() { play(upPool()); },
  };
}
