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
(function () {
  const state = loadState();

  const audioLofi = document.getElementById('audio-lofi');
  const audioAtc  = document.getElementById('audio-atc');
  const playBtn   = document.getElementById('play-btn');
  const iconPlay  = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const stationCode = document.getElementById('station-code');
  const stationName = document.getElementById('station-name');
  const stationItems = document.querySelectorAll('.station-item');
  const lofiSlider = document.getElementById('lofi-vol');
  const atcSlider  = document.getElementById('atc-vol');

  // Apply initial state to DOM
  function applyState() {
    // volumes
    audioLofi.volume = state.lofiVolume;
    audioAtc.volume  = state.atcVolume;
    lofiSlider.value = state.lofiVolume;
    atcSlider.value  = state.atcVolume;
    lofiSlider.style.setProperty('--val', state.lofiVolume * 100);
    atcSlider.style.setProperty('--val', state.atcVolume * 100);

    // station header
    stationCode.textContent = state.selectedStation;
    stationName.textContent = STATIONS[state.selectedStation].name;

    // station list highlight
    stationItems.forEach(item => {
      item.classList.toggle('active', item.dataset.code === state.selectedStation);
    });

    // audio sources
    audioLofi.src = LOFI_URL;
    audioAtc.src  = getAtcUrl(state.selectedStation);
  }

  // Toggle play/pause
  function setPlaying(playing) {
    state.isPlaying = playing;
    if (playing) {
      audioLofi.play();
      audioAtc.play();
      iconPlay.style.display  = 'none';
      iconPause.style.display = '';
    } else {
      audioLofi.pause();
      audioAtc.pause();
      iconPlay.style.display  = '';
      iconPause.style.display = 'none';
    }
  }

  // Switch ATC station
  function switchStation(code) {
    if (!STATIONS[code]) return;
    state.selectedStation = code;

    stationCode.textContent = code;
    stationName.textContent = STATIONS[code].name;
    stationItems.forEach(item => {
      item.classList.toggle('active', item.dataset.code === code);
    });

    audioAtc.src = getAtcUrl(code);
    if (state.isPlaying) audioAtc.play();

    saveState(state);
  }

  // --- Event listeners ---
  playBtn.addEventListener('click', () => setPlaying(!state.isPlaying));

  stationItems.forEach(item => {
    item.addEventListener('click', () => switchStation(item.dataset.code));
  });

  lofiSlider.addEventListener('input', () => {
    state.lofiVolume = parseFloat(lofiSlider.value);
    audioLofi.volume = state.lofiVolume;
    lofiSlider.style.setProperty('--val', state.lofiVolume * 100);
    saveState(state);
  });

  atcSlider.addEventListener('input', () => {
    state.atcVolume = parseFloat(atcSlider.value);
    audioAtc.volume = state.atcVolume;
    atcSlider.style.setProperty('--val', state.atcVolume * 100);
    saveState(state);
  });

  applyState();
})();
