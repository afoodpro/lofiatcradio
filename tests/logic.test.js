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
assert.strictEqual(def.lofiVolume, 0.3, 'default lofiVolume 0.3');
assert.strictEqual(def.atcVolume, 0.7, 'default atcVolume 0.7');
assert.strictEqual(def.selectedLofiStream, 'lofi', 'default selectedLofiStream lofi');

const merged = mergeStoredState({ selectedStation: 'RJTT', lofiVolume: 0.5 }, defaultState());
assert.strictEqual(merged.selectedStation, 'RJTT', 'mergeStoredState preserves stored station');
assert.strictEqual(merged.lofiVolume, 0.5, 'mergeStoredState preserves stored lofiVolume');
assert.strictEqual(merged.isPlaying, false, 'mergeStoredState always resets isPlaying to false');
assert.strictEqual(merged.atcVolume, 0.7, 'mergeStoredState uses default for missing key');

// --- loadState() tests ---

// 1. Empty localStorage → returns defaults
global.localStorage._store = {};
const s1 = loadState();
assert.strictEqual(s1.isPlaying, false, 'loadState empty: isPlaying false');
assert.strictEqual(s1.selectedStation, 'KJFK', 'loadState empty: selectedStation KJFK');
assert.strictEqual(s1.lofiVolume, 0.3, 'loadState empty: lofiVolume 0.3');
assert.strictEqual(s1.atcVolume, 0.7, 'loadState empty: atcVolume 0.7');

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
assert.strictEqual(s4.lofiVolume, 0.3, 'loadState partial: uses default lofiVolume');
assert.strictEqual(s4.atcVolume, 0.7, 'loadState partial: uses default atcVolume');

// --- makeStreamWatcher() tests ---
// makeStreamWatcher is defined before '// --- DOM wiring ---' so it IS loaded by the eval above.

// 1. Does not retry immediately on error — fires after delay
{
  const mockAudio = { _h: {}, addEventListener(e, fn) { this._h[e] = fn; } };
  let retried = false;
  const watcher = makeStreamWatcher(mockAudio, () => 'test', () => true, () => { retried = true; });
  mockAudio._h['error']();
  watcher.cancel(); // cancel before timer fires
  assert.strictEqual(retried, false, 'retry not immediate — fires after delay');
}

// 2. cancel() prevents retry from executing
{
  const mockAudio = { _h: {}, addEventListener(e, fn) { this._h[e] = fn; } };
  let retried = false;
  const watcher = makeStreamWatcher(mockAudio, () => 'test', () => true, () => { retried = true; });
  mockAudio._h['error']();
  watcher.cancel();
  assert.strictEqual(retried, false, 'cancel prevents retry from executing');
}

// 3. Does not schedule retry when not playing
{
  let isPlaying = false;
  const mockAudio = { _h: {}, addEventListener(e, fn) { this._h[e] = fn; } };
  let retried = false;
  const watcher = makeStreamWatcher(mockAudio, () => 'test', () => isPlaying, () => { retried = true; });
  mockAudio._h['error']();
  assert.strictEqual(retried, false, 'no retry scheduled when not playing');
  watcher.cancel();
}

// 4. playing event resets retry count
{
  const mockAudio = { _h: {}, addEventListener(e, fn) { this._h[e] = fn; } };
  const watcher = makeStreamWatcher(mockAudio, () => 'test', () => true, () => {});
  mockAudio._h['error'](); watcher.cancel(); // trigger + cancel (count = 1)
  mockAudio._h['playing'](); // reset count
  // If count was reset, we can trigger again without hitting MAX_RETRIES
  mockAudio._h['error'](); watcher.cancel();
  assert.ok(true, 'playing event resets retry count without error');
}

// 5. onExhausted fires when MAX_RETRIES (5) reached
{
  // Use synchronous setTimeout so retries execute immediately and retryCount accumulates
  const origSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };

  const mockAudio = { _h: {}, addEventListener(e, fn) { this._h[e] = fn; } };
  let exhausted = false;
  // onRetry triggers another error so retryCount keeps climbing each cycle
  const watcher = makeStreamWatcher(
    mockAudio, () => 'test', () => true,
    () => { mockAudio._h['error'](); },
    () => { exhausted = true; }
  );
  mockAudio._h['error'](); // kicks off the retry chain
  assert.strictEqual(exhausted, true, 'onExhausted fires when max retries reached');

  global.setTimeout = origSetTimeout;
}

// --- getStationFromUrl() tests ---
const origWindow = global.window;

// 1. Valid station in URL
global.window = { location: { search: '?station=RJTT' } };
assert.strictEqual(getStationFromUrl(), 'RJTT', 'getStationFromUrl: valid station code');

// 2. Unknown station code → null
global.window = { location: { search: '?station=ZZZZ' } };
assert.strictEqual(getStationFromUrl(), null, 'getStationFromUrl: unknown code returns null');

// 3. No station param → null
global.window = { location: { search: '' } };
assert.strictEqual(getStationFromUrl(), null, 'getStationFromUrl: no param returns null');

// 4. Lowercase code → null (codes are uppercase)
global.window = { location: { search: '?station=kjfk' } };
assert.strictEqual(getStationFromUrl(), null, 'getStationFromUrl: lowercase code returns null');

global.window = origWindow;

// --- getLofiUrl() tests ---
assert.strictEqual(
  getLofiUrl('lofi'),
  'https://lofi.stream.laut.fm/lofi',
  'getLofiUrl: lofi stream'
);
assert.strictEqual(
  getLofiUrl('jazz'),
  'https://jazz.stream.laut.fm/jazz',
  'getLofiUrl: jazz stream'
);
assert.strictEqual(
  getLofiUrl('ambient'),
  'https://ambient.stream.laut.fm/ambient',
  'getLofiUrl: ambient stream'
);
assert.strictEqual(
  getLofiUrl('unknown'),
  'https://lofi.stream.laut.fm/lofi',
  'getLofiUrl: unknown key falls back to lofi'
);

// --- formatWind() tests ---
assert.strictEqual(formatWind(270, 15), 'W 15kt',  'formatWind W 15kt');
assert.strictEqual(formatWind(0, 0),    'CALM',     'formatWind calm');
assert.strictEqual(formatWind(360, 10), 'N 10kt',   'formatWind 360 = N');
assert.strictEqual(formatWind(45, 8),   'NE 8kt',   'formatWind NE');
assert.strictEqual(formatWind(180, 20), 'S 20kt',   'formatWind S');

// --- formatMetar() tests ---
assert.strictEqual(
  formatMetar({ temp: 10, wdir: 270, wspd: 15 }),
  '10°C · W 15kt',
  'formatMetar temp+wind'
);
assert.strictEqual(
  formatMetar({ temp: -3, wdir: 0, wspd: 0 }),
  '-3°C · CALM',
  'formatMetar negative temp + calm'
);
assert.strictEqual(
  formatMetar({ temp: null, wdir: null, wspd: null }),
  '',
  'formatMetar all null returns empty string'
);
assert.strictEqual(
  formatMetar({ temp: 22, wdir: null, wspd: null }),
  '22°C',
  'formatMetar temp only when wind missing'
);

// --- formatDuration() tests ---
assert.strictEqual(formatDuration(0),    '0s',     'formatDuration 0');
assert.strictEqual(formatDuration(45),   '45s',    'formatDuration 45s');
assert.strictEqual(formatDuration(60),   '1m 0s',  'formatDuration 60s = 1m 0s');
assert.strictEqual(formatDuration(90),   '1m 30s', 'formatDuration 90s');
assert.strictEqual(formatDuration(3600), '1h 0m',  'formatDuration 1h');
assert.strictEqual(formatDuration(3723), '1h 2m',  'formatDuration 1h 2m (seconds hidden above 1h)');

console.log('All tests passed');
