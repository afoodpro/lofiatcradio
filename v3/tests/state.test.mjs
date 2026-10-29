import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, loadState, saveState } from '../js/state.js';
import { createSwitcher } from '../js/switcher.js';

const codes = ['KJFK', 'KSFO', 'EHAM', 'URSS', 'UNNT', 'RJTT', 'YSSY'];
const mem = (v) => ({ getItem: () => v, setItem() {} });
const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('пусто → умолчания', () => assert.deepEqual(loadState(mem(null), '', codes), DEFAULTS));
test('станция из v2, которой нет', () => assert.equal(loadState(mem('{"station":"KLAX","lofi":0.2,"atc":0.9}'), '', codes).station, 'KJFK'));
test('битый JSON и исключения', () => {
  assert.deepEqual(loadState(mem('{oops'), '', codes), DEFAULTS);
  assert.deepEqual(loadState(boom, '', codes), DEFAULTS);
  assert.doesNotThrow(() => saveState(boom, DEFAULTS));
});
test('?station перекрывает, неизвестный игнорируется', () => {
  assert.equal(loadState(mem(null), '?station=RJTT', codes).station, 'RJTT');
  assert.equal(loadState(mem(null), '?station=KDTW', codes).station, 'KJFK');
});
test('громкость вне 0..1 → умолчание', () => assert.equal(loadState(mem('{"station":"EHAM","lofi":7,"atc":0.5}'), '', codes).lofi, DEFAULTS.lofi));
test('сохранённое читается, saveState пишет в ключ lofiatc_v3', () => {
  const store = {};
  const s = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  saveState(s, { station: 'EHAM', lofi: 0.2, atc: 0.9 });
  assert.ok(store.lofiatc_v3);
  assert.deepEqual(loadState(s, '', codes), { station: 'EHAM', lofi: 0.2, atc: 0.9 });
  assert.equal(loadState(s, '?station=YSSY', codes).station, 'YSSY');
});
test('switcher: 5 быстрых NEXT → один commit', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = [], c = [];
  const s = createSwitcher({ onPreview: (x) => p.push(x), onCommit: (x) => c.push(x) });
  ['KSFO', 'EHAM', 'URSS', 'UNNT', 'RJTT'].forEach((x) => s.request(x));
  t.mock.timers.tick(299); assert.equal(c.length, 0);
  t.mock.timers.tick(1); assert.deepEqual(c, ['RJTT']); assert.equal(p.length, 5);
});
