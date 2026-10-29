import test from 'node:test';
import assert from 'node:assert/strict';
import { snap, valueToAngle, dragValue, SLEEP_MINUTES, sleepIndexToMinutes, sleepDeadline } from '../js/knob-math.js';

test('snap и угол', () => { assert.equal(snap(0.333,20),0.35); assert.equal(valueToAngle(0,20),-135); assert.equal(valueToAngle(1,20),135); assert.equal(Math.round(valueToAngle(1/3,3)),-45); });
test('dragValue', () => { assert.equal(dragValue(0.5,-80,0),1); assert.equal(dragValue(0.5,0,135),1); assert.equal(dragValue(0.5,10,5),0.5-10/160); assert.equal(dragValue(0.1,400,0),0); });
test('dragValue: угол меньше порога игнорируется, больший по модулю выигрывает', () => {
  assert.equal(dragValue(0.5,0,12),0.5);
  assert.equal(dragValue(0.5,0,-27),0.4);
  assert.equal(dragValue(0.5,-8,27),0.6);
});
test('сон', () => { assert.equal(sleepDeadline(1000,0),null); assert.equal(sleepDeadline(1000,30),1000+30*60000); assert.deepEqual(SLEEP_MINUTES,[0,30,60,90]); });
test('индекс сна в минуты', () => { assert.equal(sleepIndexToMinutes(2),60); assert.equal(sleepIndexToMinutes(9),90); assert.equal(sleepIndexToMinutes(-1),0); });
