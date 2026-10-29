import test from 'node:test';
import assert from 'node:assert/strict';
import { localTime, boardFields, flipPath } from '../js/board.js';

const d = new Date('2026-10-29T07:40:00Z');
test('localTime по поясам', () => {
  assert.equal(localTime('Asia/Tokyo', d), '16:40'); assert.equal(localTime('America/New_York', d), '03:40');
  assert.equal(localTime('America/Los_Angeles', d), '00:40'); assert.equal(localTime('Australia/Sydney', d), '18:40');
  assert.equal(localTime('Europe/Moscow', d), '10:40'); assert.equal(localTime('Asia/Novosibirsk', d), '14:40');
});
test('полночь — 00, не 24', () => assert.equal(localTime('UTC', new Date('2026-10-29T00:05:00Z')), '00:05'));
test('boardFields', () => assert.deepEqual(boardFields({code:'UNNT',city:'NOVOSIBIRSK',freq:'SCAN',pos:'ALL',tz:'Asia/Novosibirsk'}, d),
  {code:'UNNT', city:'NOVOSIBIRSK   ', time:'14:40', freq:'SCAN ', pos:'ALL'}));
test('время от любой даты, без накопления', () => assert.equal(boardFields({code:'RJTT',city:'TOKYO',freq:'119.4',pos:'APP',tz:'Asia/Tokyo'}, new Date('2026-10-29T08:41:00Z')).time, '17:41'));
test('flipPath', () => { assert.deepEqual(flipPath('A','D'), ['B','C','D']); assert.deepEqual(flipPath('-',' ').at(-1), ' '); assert.deepEqual(flipPath('A','A'), []); assert.deepEqual(flipPath(' ','ä'), []); });
