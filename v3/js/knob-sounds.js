// Щелчки ручек: обычные <audio> (работает и на iOS, где громкость <audio> менять нельзя — 30% вшито в файлы).
// Ничего не создаётся при импорте — только при вызове createKnobSounds.
const CLICKS = ['knob-click-1.mp3', 'knob-click-2.mp3', 'knob-click-3.mp3'];
const POOL_SIZE = 6;
const MIN_GAP_MS = 28;

function make(url) {
  const a = new Audio(url);
  a.preload = 'auto';
  return a;
}

function play(a) {
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* автоплей запрещён — молчим */ }
}

export function createKnobSounds(base = new URL('../sounds/', import.meta.url)) {
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) pool.push(make(new URL(CLICKS[i % CLICKS.length], base).href));
  const pressAudio = make(new URL('knob-press.mp3', base).href);
  let next = 0;
  let last = -Infinity;
  return {
    tick() {
      const now = performance.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      play(pool[next++ % pool.length]);
    },
    press() { play(pressAudio); },
  };
}
