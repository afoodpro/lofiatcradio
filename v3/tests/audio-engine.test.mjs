import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../js/audio.js';

const KJFK = { code: 'KJFK', mount: 'kjfk_twr' };
const EHAM = { code: 'EHAM', mount: 'eham_twr_18c36c' };

function fakeEl() {
  const el = new EventTarget();
  let src = '';
  Object.assign(el, { paused: true, muted: false, volume: 1, currentTime: 0, playCalls: 0, attrs: {} });
  Object.defineProperty(el, 'src', { get: () => src, set: (v) => { src = v; } });
  el.setAttribute = (k, v) => { el.attrs[k] = v; };
  el.removeAttribute = (k) => { if (k === 'src') src = ''; delete el.attrs[k]; };
  el.play = () => { el.playCalls++; el.paused = false; return Promise.resolve(); };
  el.loadCalls = 0;
  el.load = () => { el.loadCalls++; };
  el.pause = () => { if (el.paused) return; el.paused = true; el.dispatchEvent(new Event('pause')); };
  return el;
}

function setup(t, opts = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const els = [];
  const states = [];
  const api = createAudio({ ios: false, onState: (s) => states.push(s), createElement: () => { const e = fakeEl(); els.push(e); return e; }, ...opts });
  return { api, lofi: els[0], atc: els[1], last: () => states[states.length - 1] };
}
const flush = () => new Promise((r) => setImmediate(r));

test('stalled не меняет src и счётчик сбоев', (t) => {
  const { api, atc, last } = setup(t);
  api.setStation(KJFK); api.play();
  const src = atc.src;
  atc.dispatchEvent(new Event('stalled'));
  t.mock.timers.tick(5000);
  assert.equal(atc.src, src);
  assert.equal(last().atc, 'live');
});

test('error: повтор с новым nocache, после 3 сбоев эфир OFF', (t) => {
  const { api, atc, last } = setup(t);
  api.setStation(KJFK); api.play();
  const first = atc.src;
  atc.dispatchEvent(new Event('error'));
  assert.equal(atc.src, first);
  t.mock.timers.tick(2000);
  assert.notEqual(atc.src, first);
  assert.match(atc.src, /^https:\/\/s1-bos\.liveatc\.net\/kjfk_twr\?nocache=\d+$/);
  atc.dispatchEvent(new Event('error')); t.mock.timers.tick(5000);
  assert.equal(last().atc, 'live');
  atc.dispatchEvent(new Event('error'));
  assert.equal(last().atc, 'off');
});

test('сбой эфира не трогает лофи', (t) => {
  const { api, lofi, atc } = setup(t);
  api.setStation(KJFK); api.play();
  const src = lofi.src;
  atc.dispatchEvent(new Event('error')); t.mock.timers.tick(2000);
  assert.equal(lofi.src, src);
});

test('сторож: нет прогресса 12 с от запроса play => переподключение', (t) => {
  const { api, atc } = setup(t);
  api.setStation(KJFK); api.play();
  const first = atc.src;
  for (let i = 0; i < 5; i++) t.mock.timers.tick(2000); // 10 s: no reconnect yet
  assert.equal(atc.src, first);
  for (let i = 0; i < 4; i++) t.mock.timers.tick(2000); // watchdog fires after 12 s, retry 2 s later
  assert.notEqual(atc.src, first);
});

test('внешняя пауза возобновляется через 800 мс, пауза движка — нет', async (t) => {
  const { api, atc } = setup(t);
  api.setStation(KJFK); api.play();
  atc.pause(); // external
  const calls = atc.playCalls;
  t.mock.timers.tick(799);
  assert.equal(atc.paused, true);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(atc.paused, false);
  assert.equal(atc.playCalls, calls + 1);
  api.pause();
  const after = atc.playCalls;
  t.mock.timers.tick(5000); await flush();
  assert.equal(atc.paused, true);
  assert.equal(atc.playCalls, after);
});

test('внешняя пауза: сначала resume() приостановленного AudioContext', async (t) => {
  const order = [];
  class Ctx {
    state = 'running';
    constructor() { Ctx.last = this; }
    createGain() { return { gain: {}, connect() { return this; } }; }
    createMediaElementSource() { return { connect(n) { return n; } }; }
    resume() { order.push('resume'); this.state = 'running'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: Ctx };
  t.after(() => { delete globalThis.window; });
  const { api, lofi } = setup(t);
  api.setStation(KJFK); api.play();
  lofi.pause();
  lofi.play = () => { order.push('play'); lofi.paused = false; return Promise.resolve(); };
  // suspend the engine's context (as iOS/Bluetooth interruptions do)
  Ctx.last.state = 'suspended';
  t.mock.timers.tick(800); await flush();
  assert.deepEqual(order, ['resume', 'play']);
});

test('setStation на паузе не запускает воспроизведение, retry не ставит пустой src', (t) => {
  const { api, atc } = setup(t);
  api.setStation(KJFK); api.play(); api.pause();
  const calls = atc.playCalls;
  api.setStation(EHAM);
  assert.equal(atc.playCalls, calls);
  assert.equal(atc.src, '');
  atc.dispatchEvent(new Event('error'));
  t.mock.timers.tick(60000);
  assert.equal(atc.src, '');
  assert.equal(atc.playCalls, calls);
});

test('play без станции: эфир не стартует, ошибка эфира игнорируется', (t) => {
  const { api, atc, lofi, last } = setup(t);
  api.play();
  assert.equal(atc.playCalls, 0);
  assert.equal(lofi.playCalls, 1);
  atc.dispatchEvent(new Event('error')); t.mock.timers.tick(60000);
  assert.equal(atc.src, '');
  assert.equal(last().atc, 'live');
});

test('setStation во время игры меняет только эфир', (t) => {
  const { api, atc, lofi } = setup(t);
  api.setStation(KJFK); api.play();
  const lofiSrc = lofi.src, lofiCalls = lofi.playCalls;
  api.setStation(EHAM);
  assert.match(atc.src, /eham_twr_18c36c\?nocache=/);
  assert.equal(lofi.src, lofiSrc);
  assert.equal(lofi.playCalls, lofiCalls);
});

test('fadeOutAndPause: линейно гасит, паузит и возвращает уровни', (t) => {
  const { api, atc, lofi } = setup(t);
  api.setStation(KJFK); api.play();
  api.fadeOutAndPause(1000);
  t.mock.timers.tick(500);
  assert.ok(atc.volume > 0.3 && atc.volume < 0.7, `atc.volume=${atc.volume}`);
  assert.equal(atc.paused, false);
  t.mock.timers.tick(600);
  assert.equal(atc.paused, true);
  assert.equal(lofi.paused, true);
  assert.equal(atc.volume, 1);
});

test('iOS: fadeOutAndPause паузит сразу, setVolume — no-op, mute возвращает состояние', (t) => {
  const { api, atc } = setup(t, { ios: true });
  api.setStation(KJFK); api.play();
  api.setVolume('atc', 0.2);
  assert.equal(atc.volume, 1);
  assert.equal(api.toggleMute('atc'), true);
  assert.equal(api.toggleMute('atc'), false);
  api.fadeOutAndPause(5000);
  assert.equal(atc.paused, true);
});

test('внешняя пауза: resume отклонён (и перезагрузка тоже) => hardPause и onState', async (t) => {
  const { api, atc, last } = setup(t);
  api.setStation(KJFK); api.play();
  atc.pause(); // external
  atc.play = () => { atc.playCalls++; return Promise.reject(new DOMException('no', 'NotAllowedError')); };
  t.mock.timers.tick(800); await flush();
  assert.equal(last().playing, false);
});

test('внешняя пауза: AbortError при resume не роняет движок', async (t) => {
  const { api, atc, last } = setup(t);
  api.setStation(KJFK); api.play();
  atc.pause();
  atc.play = () => Promise.reject(new DOMException('aborted', 'AbortError'));
  t.mock.timers.tick(800); await flush();
  assert.equal(last().playing, true);
});

test('autoResume: false — внешняя пауза сразу становится паузой движка', (t) => {
  const { api, atc, last } = setup(t, { autoResume: false });
  api.setStation(KJFK); api.play();
  const calls = atc.playCalls;
  atc.pause();
  assert.equal(last().playing, false);
  t.mock.timers.tick(5000);
  assert.equal(atc.playCalls, calls);
});

test('NotAllowedError на эфире: hardPause, сбои не растут', async (t) => {
  const { api, atc, last } = setup(t);
  api.setStation(KJFK);
  atc.play = () => { atc.playCalls++; return Promise.reject(new DOMException('gesture', 'NotAllowedError')); };
  api.play(); await flush();
  assert.equal(last().playing, false);
  assert.equal(last().atc, 'live');
});

test('hardPause сбрасывает src обоих потоков и вызывает load()', (t) => {
  const { api, atc, lofi } = setup(t);
  api.setStation(KJFK); api.play();
  api.pause();
  assert.equal(atc.src, ''); assert.equal(lofi.src, '');
  assert.equal(atc.loadCalls, 1); assert.equal(lofi.loadCalls, 1);
  api.play();
  assert.match(atc.src, /kjfk_twr\?nocache=/);
  assert.ok(lofi.src);
});

test('crossOrigin на лофи только вне iOS', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // сторож движка не должен держать процесс
  const make = (ios) => { const els = []; createAudio({ ios, createElement: () => { const e = fakeEl(); els.push(e); return e; } }); return els[0]; };
  assert.equal(make(false).crossOrigin, 'anonymous');
  assert.equal(make(true).crossOrigin, undefined);
});
