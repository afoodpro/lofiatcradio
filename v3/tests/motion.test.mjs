import test from 'node:test';
import assert from 'node:assert/strict';
import { RESPECT_REDUCED_MOTION, reducedMotion } from '../js/motion.js';

test('флаг выключен: reducedMotion() ложь даже если система просит уменьшить движение', () => {
  assert.equal(RESPECT_REDUCED_MOTION, false);
  globalThis.matchMedia = () => ({ matches: true });
  try { assert.equal(reducedMotion(), false); } finally { delete globalThis.matchMedia; }
});
