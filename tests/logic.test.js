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

console.log('All tests passed');
