import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRadius, radarStatus, labelFor, toBlips, createRadarFeed, RADAR_BASE } from '../js/radar-data.js';

const flush = () => new Promise((r) => setImmediate(r));

function fakeDocument(state = 'visible') {
  const listeners = [];
  return {
    visibilityState: state,
    addEventListener(type, fn) { if (type === 'visibilitychange') listeners.push(fn); },
    fire(next) { this.visibilityState = next; listeners.forEach((f) => f()); },
  };
}
const okRes = (aircraft) => ({ ok: true, json: async () => ({ aircraft }) });
const plane = { hex: 'a', call: 'AAA1', lat: 55.2, lon: 82.65, track: 90 };

test('радиус растёт только при пустом экране', () => {
  assert.equal(nextRadius(40, 0), 80);
  assert.equal(nextRadius(150, 0), 250);
  assert.equal(nextRadius(250, 0), 250);
  assert.equal(nextRadius(80, 3), 80);
});

test('статусы и подписи', () => {
  assert.equal(radarStatus({ ok: false, nm: 40, count: 5 }), 'offline');
  assert.equal(radarStatus({ ok: true, nm: 250, count: 0 }), 'none');
  assert.equal(radarStatus({ ok: true, nm: 80, count: 0 }), 'ok');
  assert.equal(labelFor('none'), 'NO ADS-B COVERAGE');
  assert.equal(labelFor('offline'), 'RADAR OFFLINE');
  assert.equal(labelFor('ok'), null);
});

test('toBlips отбрасывает дальние', () => {
  const st = { lat: 55.01, lon: 82.65 };
  const b = toBlips(st, 40, [
    { lat: 55.2, lon: 82.65, track: 90, call: 'SBI1234XYZ' },
    { lat: 57, lon: 82.65, track: 0, call: 'FAR' },
  ]);
  assert.equal(b.length, 1);
  assert.equal(b[0].call, 'SBI1234');
});

test('ответ прошлой станции игнорируется', async () => {
  globalThis.document = fakeDocument();
  const pending = {};
  const urls = [];
  const fetchFn = (url) => { urls.push(url); return new Promise((res) => { pending[new URL(url).searchParams.get('station')] = res; }); };
  const updates = [];
  const feed = createRadarFeed({ onUpdate: (u) => updates.push(u), fetchFn });
  const kjfk = { code: 'KJFK', lat: 40.64, lon: -73.78 };
  const eham = { code: 'EHAM', lat: 52.31, lon: 4.76 };
  feed.start(kjfk);
  feed.start(eham);
  pending.KJFK(okRes([{ hex: 'k', call: 'KJFK1', lat: 40.7, lon: -73.78, track: 0 }]));
  await flush();
  assert.equal(updates.length, 0);
  pending.EHAM(okRes([{ hex: 'e', call: 'EHAM1', lat: 52.4, lon: 4.76, track: 0 }]));
  await flush();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].blips[0].call, 'EHAM1');
  assert.ok(urls[1].startsWith(`${RADAR_BASE}/v1/aircraft?station=EHAM&nm=40`));
  feed.stop();
});

test('пустой экран: радиус растёт сразу, затем опрос раз в 10 с', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = fakeDocument();
  const urls = [];
  const fetchFn = async (url) => { urls.push(url); return okRes(urls.length < 2 ? [] : [{ ...plane }]); };
  const updates = [];
  const feed = createRadarFeed({ onUpdate: (u) => updates.push(u), fetchFn });
  const st = { code: 'UNNT', lat: 55.01, lon: 82.65 };
  feed.start(st);
  await flush();
  assert.equal(urls.length, 2);
  assert.ok(urls[1].endsWith('nm=80'));
  assert.equal(updates[1].nm, 80);
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(urls.length, 3);
  assert.ok(urls[2].endsWith('nm=80')); // радиус не уменьшается
  feed.stop();
});

test('ошибка: offline и повтор через 30 с; stop гасит таймеры', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = fakeDocument();
  let calls = 0;
  const fetchFn = async () => { calls += 1; return { ok: false, status: 502, json: async () => ({}) }; };
  const updates = [];
  const feed = createRadarFeed({ onUpdate: (u) => updates.push(u), fetchFn });
  feed.start({ code: 'UNNT', lat: 55, lon: 82 });
  await flush();
  assert.equal(updates[0].status, 'offline');
  t.mock.timers.tick(29999);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 2);
  feed.stop();
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, 2);
});

test('пауза в фоне и возобновление', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = fakeDocument();
  globalThis.document = doc;
  let calls = 0;
  const fetchFn = async () => { calls += 1; return okRes([{ ...plane }]); };
  const feed = createRadarFeed({ onUpdate() {}, fetchFn });
  feed.start({ code: 'UNNT', lat: 55.01, lon: 82.65 });
  await flush();
  assert.equal(calls, 1);
  doc.fire('hidden');
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, 1);
  doc.fire('visible');
  await flush();
  assert.equal(calls, 2);
  feed.stop();
});

test('зависший запрос: через 10 с offline, через ещё 30 с новый запрос', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = fakeDocument();
  let calls = 0;
  const fetchFn = (url, { signal }) => {
    calls += 1;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  const updates = [];
  const feed = createRadarFeed({ onUpdate: (u) => updates.push(u), fetchFn });
  feed.start({ code: 'UNNT', lat: 55, lon: 82 });
  await flush();
  assert.equal(updates.length, 0);
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'offline');
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(calls, 2);
  feed.stop();
});

test('борты только вне круга: радиус растёт', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = fakeDocument();
  const urls = [];
  const fetchFn = async (url) => { urls.push(url); return okRes([{ hex: 'f', call: 'FAR', lat: 57, lon: 82.65, track: 0 }]); };
  const feed = createRadarFeed({ onUpdate() {}, fetchFn });
  feed.start({ code: 'UNNT', lat: 55.01, lon: 82.65 });
  await flush();
  assert.ok(urls[0].endsWith('nm=40'));
  assert.ok(urls[1].endsWith('nm=80'));
  feed.stop();
});

test('onUpdate бросает исключение: опрос продолжается', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = fakeDocument();
  let calls = 0;
  const fetchFn = async () => { calls += 1; return okRes([{ ...plane }]); };
  const feed = createRadarFeed({ onUpdate() { throw new Error('boom'); }, fetchFn });
  feed.start({ code: 'UNNT', lat: 55.01, lon: 82.65 });
  await flush();
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(calls, 2);
  feed.stop();
});

test('пауза: опрос раз в 60 с, PLAY подтягивает ожидание к 10 с', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = fakeDocument();
  let calls = 0;
  const fetchFn = async () => { calls += 1; return okRes([{ ...plane }]); };
  const feed = createRadarFeed({ onUpdate() {}, fetchFn, playing: false });
  feed.start({ code: 'UNNT', lat: 55.01, lon: 82.65 });
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(59000);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(calls, 2);
  feed.setPlaying(true); // ждущий опрос перепланирован на 10 с
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(calls, 3);
  feed.setPlaying(false);
  t.mock.timers.tick(10000); // уже запланированный опрос ещё идёт; следующий — через 60 с
  await flush();
  assert.equal(calls, 4);
  t.mock.timers.tick(59000);
  await flush();
  assert.equal(calls, 4);
  feed.stop();
});
