const assert = require('assert');

// Minimal DOM stub so app.js doesn't crash on require
global.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
};
global.document = { getElementById: () => null, querySelectorAll: () => [] };

// Load functions from app.js
eval(require('fs').readFileSync(
  require('path').join(__dirname, '../app.js'), 'utf8'
).split('// --- DOM wiring ---')[0]); // only load pure functions, stop before DOM code

// --- tests ---
assert.strictEqual(
  getAtcUrl('KJFK'),
  'https://s1-fmt2.liveatc.net/kjfk9_s',
  'getAtcUrl KJFK'
);
assert.strictEqual(
  getAtcUrl('URSS'),
  'https://s1-bos.liveatc.net/urss',
  'getAtcUrl URSS'
);
assert.strictEqual(
  getAtcUrl('XXXX'),
  null,
  'getAtcUrl unknown returns null'
);

const def = defaultState();
assert.strictEqual(def.isPlaying, false, 'default isPlaying false');
assert.strictEqual(def.selectedStation, 'KJFK', 'default station KJFK');
assert.strictEqual(def.lofiVolume, 0.7, 'default lofiVolume 0.7');
assert.strictEqual(def.atcVolume, 0.4, 'default atcVolume 0.4');

const merged = mergeStoredState({ selectedStation: 'RJTT', lofiVolume: 0.5 }, defaultState());
assert.strictEqual(merged.selectedStation, 'RJTT', 'mergeStoredState preserves stored station');
assert.strictEqual(merged.lofiVolume, 0.5, 'mergeStoredState preserves stored lofiVolume');
assert.strictEqual(merged.isPlaying, false, 'mergeStoredState always resets isPlaying to false');
assert.strictEqual(merged.atcVolume, 0.4, 'mergeStoredState uses default for missing key');

// --- loadState() tests ---

// 1. Empty localStorage → returns defaults
global.localStorage._store = {};
const s1 = loadState();
assert.strictEqual(s1.isPlaying, false, 'loadState empty: isPlaying false');
assert.strictEqual(s1.selectedStation, 'KJFK', 'loadState empty: selectedStation KJFK');
assert.strictEqual(s1.lofiVolume, 0.7, 'loadState empty: lofiVolume 0.7');
assert.strictEqual(s1.atcVolume, 0.4, 'loadState empty: atcVolume 0.4');

// 2. Corrupted JSON → returns defaults
global.localStorage._store = { lofiatc_state: 'not-valid-json{{' };
const s2 = loadState();
assert.strictEqual(s2.selectedStation, 'KJFK', 'loadState corrupt JSON: returns default station');

// 3. Valid stored state → merged correctly
global.localStorage._store = {
  lofiatc_state: JSON.stringify({ selectedStation: 'KSFO', lofiVolume: 0.3, atcVolume: 0.9 })
};
const s3 = loadState();
assert.strictEqual(s3.selectedStation, 'KSFO', 'loadState valid: preserves stored station');
assert.strictEqual(s3.lofiVolume, 0.3, 'loadState valid: preserves stored lofiVolume');
assert.strictEqual(s3.atcVolume, 0.9, 'loadState valid: preserves stored atcVolume');
assert.strictEqual(s3.isPlaying, false, 'loadState valid: isPlaying always false');

// 4. Partial state → missing keys filled with defaults
global.localStorage._store = {
  lofiatc_state: JSON.stringify({ selectedStation: 'RJTT' })
};
const s4 = loadState();
assert.strictEqual(s4.selectedStation, 'RJTT', 'loadState partial: preserves station');
assert.strictEqual(s4.lofiVolume, 0.7, 'loadState partial: uses default lofiVolume');
assert.strictEqual(s4.atcVolume, 0.4, 'loadState partial: uses default atcVolume');

console.log('All tests passed');
