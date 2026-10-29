import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, pickVariant, createUiSounds } from '../js/ui-sounds.js';

test('лимитер', () => { let t=0; const ok=createRateLimiter(38,()=>t); assert.equal(ok(),true); t=20; assert.equal(ok(),false); t=38; assert.equal(ok(),true); });
test('pickVariant не повторяет подряд', () => { for (let i=0;i<50;i++){ const v=pickVariant(5,2); assert.ok(v>=0&&v<5&&v!==2); } assert.equal(pickVariant(1,0),0); });
test('pickVariant покрывает все остальные варианты', () => {
  const seen = new Set(); for (let i = 0; i < 20; i++) seen.add(pickVariant(5, 2, () => i / 20));
  assert.deepEqual([...seen].sort(), [0, 1, 3, 4]);
});
test('createUiSounds ничего не создаёт до вызова и играет из пула', () => { const made=[]; const fake=(src)=>{ const a={src,currentTime:0,play(){ a.played=(a.played||0)+1; return Promise.resolve(); }}; made.push(a); return a; };
  const s=createUiSounds({base:new URL('file:///s/'),createAudio:fake}); assert.equal(made.length,0); s.keyDown(); assert.ok(made.some(a=>a.src.endsWith('key-down.mp3')&&a.played===1)); assert.ok(made.every(a=>!('volume' in a) || a.volume===undefined)); });
test('knob и keyUp играют свои файлы', () => { const made=[]; const fake=(src)=>{ const a={src,currentTime:0,play(){ a.played=(a.played||0)+1; return Promise.resolve(); }}; made.push(a); return a; };
  const s=createUiSounds({base:new URL('file:///s/'),createAudio:fake}); s.knob(); s.keyUp();
  for (const f of ['knob-tick','key-up']) assert.ok(made.some(a=>a.src.endsWith(f+'.mp3')&&a.played===1));
  assert.ok(made.some(a=>/key-up\.mp3$/.test(a.src)&&a.played===1)); });

// Хотфикс WebKit: каждый play() у <audio> на iOS блокирует страницу, поэтому каскад табло — один файл на смену.
test('cascade: один запуск flap-cascade на смену, повтор быстрее 250 мс не играет', () => {
  const made = []; let now = 0;
  const fake = (src) => { const a = { src, currentTime: 0, play() { a.played = (a.played || 0) + 1; return Promise.resolve(); } }; made.push(a); return a; };
  const s = createUiSounds({ base: new URL('file:///s/'), createAudio: fake, now: () => now });
  s.cascade(); now = 100; s.cascade(); now = 400; s.cascade();
  const plays = made.filter((a) => /flap-cascade\.mp3$/.test(a.src)).reduce((n, a) => n + (a.played || 0), 0);
  assert.equal(plays, 2);
  assert.ok(!made.some((a) => /flap-[1-5]\.mp3$/.test(a.src)));
});

test('minute: играет flap-minute', () => {
  const made = [];
  const fake = (src) => { const a = { src, currentTime: 0, play() { a.played = (a.played || 0) + 1; return Promise.resolve(); } }; made.push(a); return a; };
  const s = createUiSounds({ base: new URL('file:///s/'), createAudio: fake });
  s.minute();
  assert.ok(made.some((a) => /flap-minute\.mp3$/.test(a.src) && a.played === 1));
});
