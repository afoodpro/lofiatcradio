// --- Station config ---
const STATIONS = {
  KJFK: { name: 'New York JFK',    url: 'https://s1-fmt2.liveatc.net/kjfk9_s' },
  KSFO: { name: 'San Francisco',   url: 'https://s1-fmt2.liveatc.net/ksfo_twr' },
  RJTT: { name: 'Tokyo Haneda',    url: 'https://s1-fmt2.liveatc.net/rjtt_control' },
  UNNT: { name: 'Novosibirsk',     url: 'https://s1-fmt2.liveatc.net/unnt' },
  URSS: { name: 'Khabarovsk',      url: 'https://s1-bos.liveatc.net/urss' },
};

const LOFI_URL = 'https://stream.zeno.fm/0r0xa792kwzuv';

function getAtcUrl(code) {
  return STATIONS[code] ? STATIONS[code].url : null;
}

function defaultState() {
  return {
    isPlaying: false,
    selectedStation: 'KJFK',
    lofiVolume: 0.7,
    atcVolume: 0.4,
  };
}

function mergeStoredState(stored, defaults) {
  return {
    ...defaults,
    ...stored,
    isPlaying: false, // never restore playing state
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem('lofiatc_state');
    if (!raw) return defaultState();
    return mergeStoredState(JSON.parse(raw), defaultState());
  } catch (_) {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem('lofiatc_state', JSON.stringify({
    selectedStation: state.selectedStation,
    lofiVolume: state.lofiVolume,
    atcVolume: state.atcVolume,
  }));
}

// --- DOM wiring ---
