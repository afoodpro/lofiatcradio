import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadStations, findStation, stepStation, atcUrl, RELAY } from '../js/stations.js';

const list = JSON.parse(readFileSync(new URL('../stations.json', import.meta.url)));

test('7 станций в порядке спеки', () => assert.deepEqual(list.map(s => s.code), ['KJFK','KSFO','EHAM','URSS','UNNT','RJTT','YSSY']));
test('поля табло влезают', () => list.forEach(s => { assert.ok(s.city.length <= 14); assert.ok(s.freq.length <= 5); assert.ok(s.pos.length <= 3); }));
test('atcUrl', () => assert.equal(atcUrl(findStation(list, 'UNNT'), 1793260000000), `${RELAY}/unnt?nocache=1793260000000`));
test('stepStation по кругу', () => { assert.equal(stepStation(list, 'YSSY', 1).code, 'KJFK'); assert.equal(stepStation(list, 'KJFK', -1).code, 'YSSY'); });
test('неизвестный код', () => assert.equal(findStation(list, 'KLAX'), undefined));
test('loadStations: не-2xx отклоняется', async () => {
  await assert.rejects(loadStations(async () => ({ ok: false, status: 503, json: async () => [] })), /503/);
});
test('loadStations: ok отдаёт список', async () => {
  assert.deepEqual(await loadStations(async () => ({ ok: true, json: async () => [1] })), [1]);
});
