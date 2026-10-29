import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, createUiSounds, UI_SOUND_FILES } from '../js/ui-sounds.js';

test('лимитер', () => { let t=0; const ok=createRateLimiter(38,()=>t); assert.equal(ok(),true); t=20; assert.equal(ok(),false); t=38; assert.equal(ok(),true); });

// Фейковый Web Audio: буфер = имя файла, «сыграно» = список стартовавших буферов.
function fakeAudio() {
  const started = [];
  const made = { contexts: 0, fetched: [] };
  const createContext = () => {
    made.contexts++;
    return {
      state: 'suspended',
      destination: {},
      resume() { this.state = 'running'; return Promise.resolve(); },
      decodeAudioData(ab, ok) { ok({ file: ab.file }); },
      createBufferSource() {
        return { buffer: null, connect() { return this; }, start() { started.push(this.buffer.file); } };
      },
    };
  };
  const fetchFn = (url) => { made.fetched.push(url); return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve({ file: url.split('/').pop() }) }); };
  return { started, made, createContext, fetchFn };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test('ничего не создаётся и не грузится до первого звука', () => {
  const f = fakeAudio();
  createUiSounds({ base: new URL('file:///s/'), createContext: f.createContext, fetchFn: f.fetchFn });
  assert.equal(f.made.contexts, 0);
  assert.equal(f.made.fetched.length, 0);
});

test('первый звук создаёт контекст, будит его и грузит все файлы один раз; дальше звуки играют из буферов', async () => {
  const f = fakeAudio();
  const s = createUiSounds({ base: new URL('file:///s/'), createContext: f.createContext, fetchFn: f.fetchFn });
  s.keyDown();
  await flush(); await flush();
  assert.equal(f.made.contexts, 1);
  assert.deepEqual([...f.made.fetched].map((u) => u.split('/').pop()).sort(), [...UI_SOUND_FILES].sort());
  s.keyDown(); s.keyUp(); s.knob(); s.minute(); s.cascade();
  assert.deepEqual(f.started.slice(-5), ['key-down.mp3', 'key-up.mp3', 'knob-tick.mp3', 'flap-minute.mp3', 'flap-cascade.mp3']);
  s.knob();
  await flush();
  assert.equal(f.made.fetched.length, UI_SOUND_FILES.length, 'повторной загрузки нет');
});

test('cascade не чаще раза в 250 мс, knob — в 28 мс', async () => {
  const f = fakeAudio(); let now = 0;
  const s = createUiSounds({ base: new URL('file:///s/'), createContext: f.createContext, fetchFn: f.fetchFn, now: () => now });
  s.minute(); await flush(); await flush();
  const before = f.started.length;
  now = 1000; s.cascade(); now = 1100; s.cascade(); now = 1400; s.cascade();
  now = 2000; s.knob(); now = 2010; s.knob(); now = 2030; s.knob();
  const added = f.started.slice(before);
  assert.equal(added.filter((x) => x === 'flap-cascade.mp3').length, 2);
  assert.equal(added.filter((x) => x === 'knob-tick.mp3').length, 2);
});

test('без Web Audio — тишина без ошибок', () => {
  const s = createUiSounds({ base: new URL('file:///s/'), createContext: () => null, fetchFn: () => Promise.reject(new Error('no')) });
  assert.doesNotThrow(() => { s.knob(); s.cascade(); s.minute(); s.keyDown(); s.keyUp(); });
});
