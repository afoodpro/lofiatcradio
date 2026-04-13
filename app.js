// --- Station config ---
const STATIONS = {
  KJFK: { name: 'New York JFK',    url: 'https://s1-fmt2.liveatc.net/kjfk9_s',       lat:  40.64, lon:  -73.78 },
  KSFO: { name: 'San Francisco',   url: 'https://s1-fmt2.liveatc.net/ksfo_twr',      lat:  37.62, lon: -122.38 },
  KDTW: { name: 'Detroit',         url: 'https://s1-fmt2.liveatc.net/kdtw_twr',      lat:  42.21, lon:  -83.35 },
  KLAX: { name: 'Los Angeles',     url: 'https://s1-fmt2.liveatc.net/klax5_s',       lat:  33.94, lon: -118.41 },
  KATL: { name: 'Atlanta',         url: 'https://s1-fmt2.liveatc.net/katl_twr',      lat:  33.64, lon:  -84.43 },
  RJTT: { name: 'Tokyo Haneda',    url: 'https://s1-fmt2.liveatc.net/rjtt_twr',      lat:  35.55, lon:  139.78 },
  KEWR: { name: 'Newark',          url: 'https://s1-fmt2.liveatc.net/kewr_twr',      lat:  40.69, lon:  -74.17 },
  UNNT: { name: 'Novosibirsk',     url: 'https://s1-fmt2.liveatc.net/unnt',          lat:  55.01, lon:   82.65 },
  URSS: { name: 'Khabarovsk',      url: 'https://s1-bos.liveatc.net/urss',           lat:  48.52, lon:  135.18 },
};

const LOFI_STREAMS = {
  lofi:    { name: 'Lo-Fi',   url: 'https://lofi.stream.laut.fm/lofi' },
  jazz:    { name: 'Jazz',    url: 'https://jazz.stream.laut.fm/jazz' },
  ambient: { name: 'Ambient', url: 'https://ambient.stream.laut.fm/ambient' },
};

// --- METAR helpers ---
function formatWind(dir, spd) {
  if (dir === 0 && spd === 0) return 'CALM';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(dir / 45) % 8] + ' ' + spd + 'kt';
}

function formatMetar(m) {
  const temp = m.temp != null ? Math.round(m.temp) + '°C' : null;
  const wind = (m.wspd != null && m.wdir != null) ? formatWind(m.wdir, m.wspd) : null;
  return [temp, wind].filter(Boolean).join(' · ');
}

async function fetchMetar(icao) {
  const s = STATIONS[icao];
  if (!s) return null;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + s.lat + '&longitude=' + s.lon +
      '&current=temperature_2m,wind_speed_10m,wind_direction_10m' +
      '&wind_speed_unit=kn&forecast_days=1';
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const c = data.current;
    if (!c) return null;
    return { temp: c.temperature_2m, wspd: Math.round(c.wind_speed_10m), wdir: Math.round(c.wind_direction_10m) };
  } catch (_) {
    return null;
  }
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function getLofiUrl(key) {
  return LOFI_STREAMS[key] ? LOFI_STREAMS[key].url : LOFI_STREAMS.lofi.url;
}

function getAtcUrl(code) {
  return STATIONS[code] ? STATIONS[code].url : null;
}

function defaultState() {
  return {
    isPlaying: false,
    selectedStation: 'KJFK',
    lofiVolume: 0.3,
    atcVolume: 0.7,
    selectedLofiStream: 'lofi',
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
    selectedLofiStream: state.selectedLofiStream,
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

  // iOS Safari: audioEl.volume is read-only, Web Audio can't route non-CORS streams.
  // Fix volumes at known-good levels and hide sliders entirely.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const IOS_LOFI_VOL = 0.68;
  const IOS_ATC_VOL  = 1.0;

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
  const metarInfo = document.getElementById('metar-info');

  // Web Audio API — lofi volume on iOS (audioEl.volume is read-only on WebKit).
  // Only lofi is routed through the graph: laut.fm sends CORS headers (required by
  // createMediaElementSource). LiveATC has no CORS, so ATC uses audioEl.volume directly.
  let audioCtx = null;
  let lofiGain = null;

  function ensureAudioGraph() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return;
    }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      lofiGain = audioCtx.createGain();
      lofiGain.gain.value = state.lofiVolume;
      audioCtx.createMediaElementSource(audioLofi).connect(lofiGain).connect(audioCtx.destination);

      // iOS/CarPlay: system suspends AudioContext on BT reconnect, navigation, calls etc.
      // Audio element may keep playing internally but GainNode output goes silent.
      // Resume the context as soon as system releases the interruption.
      audioCtx.addEventListener('statechange', () => {
        if (audioCtx.state === 'suspended' && state.isPlaying) {
          audioCtx.resume().then(() => {
            if (state.isPlaying && audioLofi.paused) audioLofi.play().catch(() => {});
          }).catch(() => {});
        }
      });
    } catch (e) {
      console.warn('Web Audio API unavailable:', e);
      audioCtx = null; lofiGain = null;
    }
  }

  function setLofiGain(v) {
    if (lofiGain) lofiGain.gain.value = v; else audioLofi.volume = v;
  }

  function setAtcGain(v) {
    audioAtc.volume = v; // liveatc.net has no CORS — Web Audio not applicable; works on desktop
  }

  function updateMetar(code) {
    metarInfo.textContent = '';
    fetchMetar(code).then(m => {
      if (!m) return;
      const text = formatMetar(m);
      if (text) {
        metarInfo.textContent = text;
        metarInfo.classList.remove('metar-in');
        void metarInfo.offsetWidth; // force reflow to restart animation
        metarInfo.classList.add('metar-in');
      }
    }).catch(() => {});
  }

  const stationItems = document.querySelectorAll('.station-item');
  const lofiSlider = document.getElementById('lofi-vol');
  const atcSlider  = document.getElementById('atc-vol');

  // Apply initial state to DOM
  function applyState() {
    // volumes
    if (isIOS) {
      setLofiGain(IOS_LOFI_VOL);
      setAtcGain(IOS_ATC_VOL);
      document.querySelector('.volumes').style.display = 'none';
    } else {
      setLofiGain(state.lofiVolume);
      setAtcGain(state.atcVolume);
      lofiSlider.value = state.lofiVolume;
      atcSlider.value  = state.atcVolume;
      lofiSlider.style.setProperty('--val', state.lofiVolume * 100);
      atcSlider.style.setProperty('--val', state.atcVolume * 100);
    }

    // station header
    stationCode.textContent = state.selectedStation;
    stationName.textContent = STATIONS[state.selectedStation].name;

    // station list highlight
    stationItems.forEach(item => {
      item.classList.toggle('active', item.dataset.code === state.selectedStation);
    });

    // audio sources
    audioLofi.src = getLofiUrl(state.selectedLofiStream);
    audioAtc.src  = getAtcUrl(state.selectedStation);
    updateMetar(state.selectedStation);
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

    // Steering wheel / headunit prev/next → cycle through ATC stations
    const stationKeys = Object.keys(STATIONS);
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      const idx = stationKeys.indexOf(state.selectedStation);
      switchStation(stationKeys[(idx - 1 + stationKeys.length) % stationKeys.length]);
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      const idx = stationKeys.indexOf(state.selectedStation);
      switchStation(stationKeys[(idx + 1) % stationKeys.length]);
    });
  }

  // Auto-resume after external audio interruption (Bluetooth disconnect/reconnect,
  // CarPlay handoff, navigation announcement, phone call end, etc.)
  // When the system pauses audio without user intent, state.isPlaying stays true —
  // we detect this and schedule a play attempt after the interruption clears.
  function handleExternalPause(audioEl, getUrl) {
    audioEl.addEventListener('pause', () => {
      if (!state.isPlaying) return; // user-initiated pause — do nothing
      setTimeout(() => {
        if (!state.isPlaying || !audioEl.paused) return;
        // Make sure AudioContext is running before attempting play
        const resume = (audioCtx && audioCtx.state === 'suspended')
          ? audioCtx.resume()
          : Promise.resolve();
        resume.then(() => {
          audioEl.play().catch(() => {
            // play() rejected — stream dropped during interruption, reload and retry
            audioEl.src = getUrl();
            audioEl.play().catch(() => {});
          });
        }).catch(() => {});
      }, 800);
    });
  }

  handleExternalPause(audioLofi, () => getLofiUrl(state.selectedLofiStream));
  handleExternalPause(audioAtc,  () => getAtcUrl(state.selectedStation));

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
      audioLofi.src = getLofiUrl(state.selectedLofiStream);
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
      ensureAudioGraph();
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
    }, 130); // matches --t-fast (110ms) + small buffer

    stationItems.forEach(item => {
      item.classList.toggle('active', item.dataset.code === code);
    });

    audioAtc.src = getAtcUrl(code);
    if (state.isPlaying) audioAtc.play().catch(err => {
      if (err.name !== 'AbortError') console.error('ATC play error:', err);
    });

    updateMediaSession();
    updateMetar(code);
    saveState(state);
  }

  // --- Event listeners ---
  playBtn.addEventListener('click', () => setPlaying(!state.isPlaying));

  stationItems.forEach(item => {
    item.addEventListener('click', () => switchStation(item.dataset.code));
  });

  lofiSlider.addEventListener('input', () => {
    state.lofiVolume = parseFloat(lofiSlider.value);
    setLofiGain(state.lofiVolume);
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    lofiSlider.style.setProperty('--val', state.lofiVolume * 100);
    saveState(state);
  });

  atcSlider.addEventListener('input', () => {
    state.atcVolume = parseFloat(atcSlider.value);
    setAtcGain(state.atcVolume);
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    atcSlider.style.setProperty('--val', state.atcVolume * 100);
    saveState(state);
  });

  function applySliderWheel(slider, setGainFn, stateKey) {
    slider.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const next = Math.min(1, Math.max(0, state[stateKey] + delta));
      state[stateKey] = Math.round(next * 100) / 100;
      setGainFn(state[stateKey]);
      slider.value = state[stateKey];
      slider.style.setProperty('--val', state[stateKey] * 100);
      saveState(state);
    }, { passive: false });
  }

  applySliderWheel(lofiSlider, setLofiGain, 'lofiVolume');
  applySliderWheel(atcSlider,  setAtcGain,  'atcVolume');

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

  // Lo-fi stream switcher
  const lofiOptions = document.querySelectorAll('.lofi-option');

  function applyLofiStream() {
    lofiOptions.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.stream === state.selectedLofiStream);
    });
  }

  function switchLofiStream(key) {
    if (!LOFI_STREAMS[key] || key === state.selectedLofiStream) return;
    state.selectedLofiStream = key;
    applyLofiStream();
    audioLofi.src = getLofiUrl(key);
    if (state.isPlaying) audioLofi.play().catch(() => {});
    saveState(state);
  }

  lofiOptions.forEach(btn => {
    btn.addEventListener('click', () => switchLofiStream(btn.dataset.stream));
  });

  applyState();
  applyLofiStream();
  updateMediaSession();
})();

// --- Service Worker registration ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/lofiatcradio/sw.js')
      .catch(err => console.warn('SW registration failed:', err));
  });
}
