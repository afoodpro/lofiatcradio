// --- Station config ---
const STATIONS = {
  KJFK: { name: 'New York JFK',    url: 'https://s1-fmt2.liveatc.net/kjfk9_s' },
  KSFO: { name: 'San Francisco',   url: 'https://s1-fmt2.liveatc.net/ksfo_twr' },
  EGLL: { name: 'London Heathrow', url: 'https://s1-fmt2.liveatc.net/egll8_s' },
  KLAX: { name: 'Los Angeles',     url: 'https://s1-fmt2.liveatc.net/klax5_s' },
  OMDB: { name: 'Dubai',           url: 'https://s1-bos.liveatc.net/omdb' },
  RJTT: { name: 'Tokyo Haneda',    url: 'https://s1-fmt2.liveatc.net/rjtt_control' },
  ZSPD: { name: 'Shanghai Pudong', url: 'https://s1-bos.liveatc.net/zspd' },
  UNNT: { name: 'Novosibirsk',     url: 'https://s1-fmt2.liveatc.net/unnt' },
  URSS: { name: 'Khabarovsk',      url: 'https://s1-bos.liveatc.net/urss' },
};

const LOFI_URL = 'https://lofi.stream.laut.fm/lofi';

function getAtcUrl(code) {
  return STATIONS[code] ? STATIONS[code].url : null;
}

function defaultState() {
  return {
    isPlaying: false,
    selectedStation: 'KJFK',
    lofiVolume: 0.3,
    atcVolume: 0.7,
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

// --- URL helpers ---
function getStationFromUrl() {
  try {
    const code = new URLSearchParams(window.location.search).get('station');
    return STATIONS[code] ? code : null;
  } catch (_) {
    return null;
  }
}

// --- Stream resilience ---
function makeStreamWatcher(audioEl, getName, isPlayingFn, onRetry, onExhausted) {
  const RETRY_DELAY_MS = 5000;
  const MAX_RETRIES = 5;
  let retryCount = 0;
  let retryTimer = null;

  function scheduleRetry() {
    if (retryTimer !== null) return;
    if (!isPlayingFn()) return;
    if (retryCount >= MAX_RETRIES) {
      console.warn(getName() + ': max retries reached, giving up');
      if (onExhausted) onExhausted();
      return;
    }
    retryCount++;
    console.log(getName() + ': retry ' + retryCount + '/' + MAX_RETRIES + ' in ' + RETRY_DELAY_MS + 'ms');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!isPlayingFn()) return;
      onRetry();
    }, RETRY_DELAY_MS);
  }

  audioEl.addEventListener('error', () => {
    if (isPlayingFn()) scheduleRetry();
  });

  audioEl.addEventListener('playing', () => {
    retryCount = 0;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  });

  return {
    cancel() {
      retryCount = 0;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    },
  };
}

// --- DOM wiring ---
(function () {
  const state = loadState();

  // URL param overrides saved station (but isn't persisted)
  const urlStation = getStationFromUrl();
  if (urlStation) state.selectedStation = urlStation;

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

  // Media Session API — lock screen / car display / Bluetooth controls
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: STATIONS[state.selectedStation].name + ' ATC',
      artist: 'Lo-Fi × ATC Radio',
      album: state.selectedStation,
    });
    navigator.mediaSession.setActionHandler('play',  () => setPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => setPlaying(false));
    navigator.mediaSession.setActionHandler('stop',  () => setPlaying(false));
  }

  // Buffering indicator
  function setBuffering(buffering) {
    playBtn.classList.toggle('is-buffering', buffering && state.isPlaying);
  }

  audioLofi.addEventListener('waiting', () => setBuffering(true));
  audioLofi.addEventListener('playing', () => setBuffering(false));
  audioLofi.addEventListener('canplay', () => setBuffering(false));

  // Stream error display
  const liveBadge = document.querySelector('.live-badge');
  const liveBadgeText = document.querySelector('.live-badge-text');

  function setLofiError(hasError) {
    liveBadge.classList.toggle('is-error', hasError);
    liveBadgeText.textContent = hasError ? 'LO-FI UNAVAILABLE' : 'LIVE · ATC RADIO';
  }

  function setAtcError(code, hasError) {
    stationItems.forEach(item => {
      if (item.dataset.code === code) {
        item.classList.toggle('is-offline', hasError);
      }
    });
  }

  // Sleep timer state
  let sleepTimer = null;
  const sleepOptions = document.querySelectorAll('.sleep-option');

  function cancelSleep() {
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
    sleepOptions.forEach(b => b.classList.remove('active'));
  }

  // Stream resilience watchers
  const lofiWatcher = makeStreamWatcher(
    audioLofi,
    () => 'audioLofi',
    () => state.isPlaying,
    () => {
      setLofiError(false);
      audioLofi.src = LOFI_URL;
      audioLofi.play().catch(() => {});
    },
    () => setLofiError(true)
  );

  const atcWatcher = makeStreamWatcher(
    audioAtc,
    () => 'audioAtc[' + state.selectedStation + ']',
    () => state.isPlaying,
    () => {
      setAtcError(state.selectedStation, false);
      audioAtc.src = getAtcUrl(state.selectedStation);
      audioAtc.play().catch(() => {});
    },
    () => setAtcError(state.selectedStation, true)
  );

  // Toggle play/pause
  function setPlaying(playing) {
    state.isPlaying = playing;
    playBtn.classList.toggle('is-playing', playing);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
    if (playing) {
      iconPlay.classList.add('icon-hidden');
      iconPause.classList.remove('icon-hidden');
      iconPause.style.display = '';
      audioLofi.play().catch(err => {
        console.error('Lo-fi stream error:', err);
        state.isPlaying = false;
        playBtn.classList.remove('is-playing');
        iconPlay.classList.remove('icon-hidden');
        iconPause.classList.add('icon-hidden');
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      });
      audioAtc.play().catch(err => {
        console.error('ATC stream error:', err);
      });
    } else {
      audioLofi.pause();
      audioAtc.pause();
      iconPlay.classList.remove('icon-hidden');
      iconPause.classList.add('icon-hidden');
      setBuffering(false);
      lofiWatcher.cancel();
      atcWatcher.cancel();
      setLofiError(false);
      setAtcError(state.selectedStation, false);
      cancelSleep();
    }
  }

  // Switch ATC station — fade header out, swap text, fade in
  function switchStation(code) {
    if (!STATIONS[code]) return;
    atcWatcher.cancel();
    setAtcError(state.selectedStation, false);
    state.selectedStation = code;

    stationCode.classList.add('fading');
    stationName.classList.add('fading');

    setTimeout(() => {
      stationCode.textContent = code;
      stationName.textContent = STATIONS[code].name;
      stationCode.classList.remove('fading');
      stationName.classList.remove('fading');
    }, 200);

    stationItems.forEach(item => {
      item.classList.toggle('active', item.dataset.code === code);
    });

    audioAtc.src = getAtcUrl(code);
    if (state.isPlaying) audioAtc.play();

    updateMediaSession();
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

  function applySliderWheel(slider, audioEl, stateKey) {
    slider.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const next = Math.min(1, Math.max(0, state[stateKey] + delta));
      state[stateKey] = Math.round(next * 100) / 100;
      audioEl.volume = state[stateKey];
      slider.value = state[stateKey];
      slider.style.setProperty('--val', state[stateKey] * 100);
      saveState(state);
    }, { passive: false });
  }

  applySliderWheel(lofiSlider, audioLofi, 'lofiVolume');
  applySliderWheel(atcSlider,  audioAtc,  'atcVolume');

  document.addEventListener('keydown', (e) => {
    // Don't intercept when user interacts with a form element
    if (e.target.tagName === 'INPUT') return;

    if (e.code === 'Space') {
      e.preventDefault(); // prevent page scroll
      setPlaying(!state.isPlaying);
      return;
    }

    const stationKeys = Object.keys(STATIONS);
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= 0 && idx < stationKeys.length) {
      switchStation(stationKeys[idx]);
    }
  });

  sleepOptions.forEach(btn => {
    btn.addEventListener('click', () => {
      const minutes = parseInt(btn.dataset.minutes, 10);
      if (btn.classList.contains('active')) {
        cancelSleep();
        return;
      }
      cancelSleep();
      btn.classList.add('active');
      sleepTimer = setTimeout(() => {
        setPlaying(false);
        sleepOptions.forEach(b => b.classList.remove('active'));
        sleepTimer = null;
      }, minutes * 60 * 1000);
    });
  });

  applyState();
  updateMediaSession();
})();

// --- Service Worker registration ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/lofiatcradio/sw.js')
      .catch(err => console.warn('SW registration failed:', err));
  });
}
