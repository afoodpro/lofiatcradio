// Сборка прибора: станции и состояние → табло, катушка-радар, ручки, аудио, радар, клавиатура, Media Session.
import { loadStations, findStation, stepStation } from './stations.js';
import { boardFields } from './board.js';
import { createFlapRow } from './flap.js';
import { createReel } from './reel.js';
import { createKnob } from './knob.js';
import { sleepIndexToMinutes, sleepDeadline } from './knob-math.js';
import { createKnobSounds } from './knob-sounds.js';
import { createAudio } from './audio.js';
import { IOS_LEVELS, isIOS, lampState } from './audio-logic.js';
import { createRadarFeed, labelFor } from './radar-data.js';
import { DEFAULTS, loadState, saveState } from './state.js';
import { createSwitcher } from './switcher.js';

const CLOCK_CHECK_MS = 5000;
const SLEEP_FADE_MS = 8000;
const HINT_MS = 3000;
const KEY_FLASH_MS = 160;
const SLEEP_TEXT = ['OFF', '30 MIN', '60 MIN', '90 MIN'];

const $ = (id) => document.getElementById(id);

let storage = null;
try { storage = window.localStorage; } catch { storage = null; }

const ios = isIOS(navigator);
const mediaSession = 'mediaSession' in navigator ? navigator.mediaSession : null;

// ---- состояние ----
let stations = [];
let state = { ...DEFAULTS };
let shownCode = DEFAULTS.station; // что на табло (меняется сразу при нажатии)
let playing = false;
let atc = 'live';
let shownTime = '';
let sleepTimer = null;

// ---- табло ----
const rows = {
  code: createFlapRow($('f-code'), 4, 'lg'),
  city: createFlapRow($('f-city'), 14, 'md'),
  time: createFlapRow($('f-time'), 5, 'md'),
  freq: createFlapRow($('f-freq'), 5, 'md'),
  pos: createFlapRow($('f-pos'), 3, 'md'),
};

const shownStation = () => findStation(stations, shownCode);
// OFF относится к станции, которая реально играет, а не к той, что только листается на табло.
const posText = (st, f) => (atc === 'off' && st.code === state.station ? 'OFF' : f.pos);

function renderBoard() {
  const st = shownStation();
  if (!st) return;
  const f = boardFields(st, new Date());
  rows.code.set(f.code);
  rows.city.set(f.city);
  rows.time.set(f.time);
  rows.freq.set(f.freq);
  rows.pos.set(posText(st, f));
  shownTime = f.time;
}

// Время перещёлкивается само на смене минуты.
setInterval(() => {
  const st = shownStation();
  if (!st) return;
  const t = boardFields(st, new Date()).time;
  if (t !== shownTime) { shownTime = t; rows.time.set(t); }
}, CLOCK_CHECK_MS);

// ---- катушка-радар ----
const reel = createReel($('reel'));
const radarFeed = createRadarFeed({
  onUpdate({ nm, status, blips }) {
    reel.setAircraft(blips);
    reel.setRangeNm(nm);
    reel.setLabel(labelFor(status));
  },
});

// ---- лампочка и клавиша PLAY ----
const lamp = $('lamp');
const keyPlay = $('key-play');

// ---- аудио ----
const audio = createAudio({
  ios,
  onState(s) {
    const wasOff = atc === 'off';
    playing = s.playing;
    atc = s.atc;
    lamp.dataset.state = lampState(s);
    keyPlay.setAttribute('aria-pressed', String(playing));
    reel.setPlaying(playing);
    if (mediaSession) mediaSession.playbackState = playing ? 'playing' : 'paused';
    if (wasOff !== (atc === 'off')) {
      const st = shownStation();
      if (st) rows.pos.set(posText(st, boardFields(st, new Date())));
    }
  },
});

// Пока список станций не загружен, PLAY выключена: иначе на iOS эфир позже стартовал бы без жеста пользователя.
let ready = false;

function play() {
  if (!ready) return;
  audio.play(); // синхронно в обработчике жеста (iOS)
}

function pause() {
  cancelSleep();
  audio.pause();
}

function togglePlay() {
  if (playing) pause(); else play();
}

// ---- переключение станций ----
const announce = $('announce');

function updateMediaMetadata(st) {
  if (!mediaSession || typeof MediaMetadata === 'undefined') return;
  try {
    mediaSession.metadata = new MediaMetadata({ title: `${st.city} ATC`, artist: 'ATC Live Radio', album: st.code });
  } catch { /* старый браузер */ }
}

const switcher = createSwitcher({
  onPreview(code) {
    shownCode = code;
    renderBoard();
  },
  onCommit(code) {
    const st = findStation(stations, code);
    if (!st || code === state.station) return;
    state = { ...state, station: code };
    reel.setAircraft([]);
    reel.setLabel(null);
    audio.setStation(st);
    radarFeed.start(st);
    saveState(storage, state);
    updateMediaMetadata(st);
    announce.textContent = `${st.city} ${st.code}`;
  },
});

function step(dir) {
  if (!stations.length) return;
  switcher.request(stepStation(stations, shownCode, dir).code);
}

function jumpTo(index) {
  const st = stations[index];
  if (st) switcher.request(st.code);
}

// ---- клавиши и табло ----
const keyPrev = $('key-prev');
const keyNext = $('key-next');

function flash(key) {
  key.classList.add('is-down');
  setTimeout(() => key.classList.remove('is-down'), KEY_FLASH_MS);
}

keyPlay.addEventListener('click', togglePlay);
keyPrev.addEventListener('click', () => step(-1));
keyNext.addEventListener('click', () => step(1));
$('board').addEventListener('click', () => step(1));

// Как фокус попал на кнопку: с клавиатуры (Tab) или кликом/тапом. :focus-visible здесь не годится —
// Chrome включает его на кнопке, полученной кликом, при первом же нажатии клавиши.
const POINTER_FOCUS_MS = 600;
let pointerAt = -Infinity;
let keyboardFocused = null;
document.addEventListener('pointerdown', () => { pointerAt = performance.now(); }, true);
document.addEventListener('focusin', (e) => {
  keyboardFocused = performance.now() - pointerAt > POINTER_FOCUS_MS ? e.target : null;
}, true);

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t instanceof Element && t.closest('.knob')) return; // ручка сама обрабатывает клавиши
  const control = t instanceof Element ? t.closest('button, a, input, textarea, select') : null;
  if (e.key === ' ' || e.code === 'Space') {
    // Пробел нажимает саму кнопку, только если на неё пришли с клавиатуры (Tab);
    // после клика мышью фокус тоже на кнопке, но пробел — это play/pause.
    if (control && control === keyboardFocused) return;
    e.preventDefault();
    if (!e.repeat) togglePlay();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault(); flash(keyNext); step(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault(); flash(keyPrev); step(-1);
  } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= stations.length) {
    e.preventDefault(); jumpTo(Number(e.key) - 1);
  }
});

// ---- Media Session (экран блокировки, кнопки руля) ----
if (mediaSession) {
  const handlers = {
    play: () => play(),
    pause: () => pause(),
    stop: () => pause(),
    previoustrack: () => step(-1),
    nexttrack: () => step(1),
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { mediaSession.setActionHandler(action, fn); } catch { /* действие не поддерживается */ }
  }
}

// ---- ручки ----
const sounds = createKnobSounds();
const hint = $('hint');
let hintShown = false;

function showIosHint() {
  if (hintShown) return;
  hintShown = true;
  hint.textContent = 'Volume on iPhone: use the side buttons';
  hint.classList.add('is-shown');
  setTimeout(() => hint.classList.remove('is-shown'), HINT_MS);
}

function volumeKnob(name, label) {
  const el = $(`knob-${name}`);
  if (ios) {
    // На iPhone громкость <audio> не меняется: ручка зафиксирована и работает как mute своего потока.
    const knob = createKnob(el, {
      label: `Mute ${label}`,
      steps: 20,
      value: IOS_LEVELS[name],
      disabled: true,
      onPress() {
        sounds.press();
        const muted = audio.toggleMute(name);
        knob.setDisabled(true, muted);
        showIosHint();
      },
    });
    return knob;
  }
  return createKnob(el, {
    label: `${label} volume`,
    steps: 20,
    value: state[name],
    onStep: () => sounds.tick(),
    onChange(v) {
      state = { ...state, [name]: v };
      audio.setVolume(name, v);
      if (ready) saveState(storage, state);
      else volumesTouched = true; // сохраним после загрузки, не затирая сохранённую станцию
    },
  });
}

// ---- таймер сна ----
let sleepKnob = null;

function cancelSleep() {
  if (sleepTimer !== null) { clearTimeout(sleepTimer); sleepTimer = null; }
  sleepKnob?.setValue(0);
}

function setSleep(minutes) {
  if (sleepTimer !== null) { clearTimeout(sleepTimer); sleepTimer = null; }
  const deadline = sleepDeadline(Date.now(), minutes);
  if (deadline === null) return;
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    sleepKnob.setValue(0);
    audio.fadeOutAndPause(SLEEP_FADE_MS);
  }, deadline - Date.now());
}

sleepKnob = createKnob($('knob-sleep'), {
  label: 'Sleep timer',
  steps: 3,
  value: 0,
  scaleLabels: ['OFF', '30', '60', '90'],
  valueText: (i) => SLEEP_TEXT[i],
  onStep(i) {
    sounds.tick();
    setSleep(sleepIndexToMinutes(i));
  },
});

// ---- запуск ----
// Громкости от списка станций не зависят: ручки появляются сразу. Станция здесь ещё умолчательная,
// поэтому до конца start() состояние не сохраняется.
let volumesTouched = false;
state = loadState(storage, '', []);
volumeKnob('lofi', 'LO-FI');
volumeKnob('atc', 'ATC');
audio.setVolume('lofi', state.lofi);
audio.setVolume('atc', state.atc);

async function start() {
  try {
    stations = await loadStations();
  } catch {
    rows.city.set('NO STATIONS');
    return;
  }
  const loaded = loadState(storage, location.search, stations.map((s) => s.code));
  state = volumesTouched ? { ...loaded, lofi: state.lofi, atc: state.atc } : loaded;
  shownCode = state.station;
  ready = true;
  keyPlay.disabled = false;
  if (volumesTouched) saveState(storage, state);

  const st = findStation(stations, state.station);
  audio.setStation(st);
  radarFeed.start(st);
  updateMediaMetadata(st);
  renderBoard();
}

start();

// Офлайн-оболочка: sw.js лежит рядом с index.html, scope совпадает с папкой приложения.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
