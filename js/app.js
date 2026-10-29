// Сборка прибора: станции и состояние → табло, катушка-радар, ручки, аудио, радар, клавиатура, Media Session, паспорт.
import { loadStations, findStation, stepStation } from './stations.js';
import { boardFields } from './board.js';
import { createFlapRow } from './flap.js';
import { createReel } from './reel.js';
import { createKnob } from './knob.js';
import { sleepIndexToMinutes, sleepDeadline } from './knob-math.js';
import { createUiSounds } from './ui-sounds.js';
import { createAudio } from './audio.js';
import { IOS_LEVELS, isIOS, lampState } from './audio-logic.js';
import { createRadarFeed, labelFor } from './radar-data.js';
import { DEFAULTS, loadState, saveState } from './state.js';
import { createSwitcher } from './switcher.js';
import { createPassport } from './passport.js';
import { reducedMotion } from './motion.js';

const CLOCK_CHECK_MS = 5000;
const SLEEP_FADE_MS = 8000;
const HINT_MS = 3000;
const KEY_FLASH_MS = 160;
const STATION_RETRY_MS = [2000, 5000, 10000]; // дальше — раз в 30 с
const STATION_RETRY_LAST_MS = 30000;
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

// ---- звуки интерфейса (от громкости потоков и mute не зависят) ----
// На iPhone выключены: iOS привязывает шторку, экран блокировки и CarPlay к последнему
// запущенному <audio> — короткий щелчок перехватывал «Сейчас играет» у потоков (кнопки
// переставали работать, вместо «станция ±» появлялось «±10 с»). Web Audio это бы обошло,
// но в v2 оно ломало звук в CarPlay — без проверки в машине не рискуем.
const SILENT_SOUNDS = { knob() {}, cascade() {}, minute() {}, keyDown() {}, keyUp() {} };
const sounds = ios ? SILENT_SOUNDS : createUiSounds();
// Табло на скрытой странице (заблокированный телефон) не звучит: клики без картинки не нужны.
const visible = () => document.visibilityState === 'visible';

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
  if (visible()) sounds.cascade();
}

// Время перещёлкивается само на смене минуты.
setInterval(() => {
  const st = shownStation();
  if (!st) return;
  const t = boardFields(st, new Date()).time;
  if (t !== shownTime) { shownTime = t; rows.time.set(t); if (visible()) sounds.minute(); }
}, CLOCK_CHECK_MS);

if (reducedMotion()) document.documentElement.classList.add('reduce-motion');

// ---- катушка-радар ----
const reel = createReel($('reel'));
const radarFeed = createRadarFeed({
  playing: false,
  onUpdate({ displayNm, status, blips }) {
    reel.setAircraft(blips, displayNm);
    reel.setRangeNm(displayNm);
    reel.setLabel(labelFor(status));
  },
});

// ---- лампочка и клавиша PLAY ----
const lamp = $('lamp');
const keyPlay = $('key-play');

// ---- аудио ----
const audio = createAudio({
  ios,
  autoResume: !ios, // iOS: после внешней паузы не возобновляем сами — движок встаёт на паузу, одно нажатие продолжает
  onState(s) {
    const wasOff = atc === 'off';
    playing = s.playing;
    atc = s.atc;
    lamp.dataset.state = lampState(s);
    if (keyPlay.getAttribute('aria-pressed') !== String(playing)) {
      if (playing) sounds.keyDown(); else sounds.keyUp();
    }
    keyPlay.setAttribute('aria-pressed', String(playing));
    reel.setPlaying(playing);
    radarFeed.setPlaying(playing);
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
  if (!ready || playing) return; // уже играет (напр. Media Session play при подключении к машине)
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
    mediaSession.metadata = new MediaMetadata({ title: `${st.city} ATC`, artist: 'ATC Live Radio', album: st.code,
      artwork: [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
    });
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

// Звук клавиш деки: нажатие и отжатие. С мышью/пальцем — по pointerdown/up; с клавиатуры
// (стрелки, Tab+Enter) и из Media Session — down и через KEY_TAP_MS up.
const KEY_TAP_MS = 120;
function tapSound() {
  sounds.keyDown();
  setTimeout(() => sounds.keyUp(), KEY_TAP_MS);
}
// ---- паспорт изделия (оборот прибора) ----
const passportBtn = $('passport-btn');
const passportBackBtn = $('passport-back-btn');
const passport = createPassport({
  unit: $('unit'),
  front: document.querySelector('.device'),
  back: $('passport'),
  button: passportBtn,
  backButton: passportBackBtn,
});

for (const key of [keyPrev, keyNext, passportBtn, passportBackBtn]) {
  key.addEventListener('pointerdown', () => sounds.keyDown());
  key.addEventListener('pointerup', () => sounds.keyUp());
  key.addEventListener('click', (e) => { if (e.detail === 0) tapSound(); }); // Enter/Space на сфокусированной
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
  if (passport.isOpen()) return; // прибор развёрнут обратной стороной: клавиши деки недоступны
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
    e.preventDefault(); flash(keyNext); tapSound(); step(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault(); flash(keyPrev); tapSound(); step(-1);
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
    previoustrack: () => { tapSound(); step(-1); },
    nexttrack: () => { tapSound(); step(1); },
    // Перемотки у живого эфира нет: без явного null iOS рисует «±10 с» вместо «станция ±».
    seekbackward: null,
    seekforward: null,
    seekto: null,
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { mediaSession.setActionHandler(action, fn); } catch { /* действие не поддерживается */ }
  }
}

// ---- ручки ----
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
        sounds.knob();
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
    onStep: () => sounds.knob(),
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
  sleepDeadlineAt = null;
  sleepKnob?.setValue(0);
}

let sleepDeadlineAt = null;

function fireSleep() {
  if (sleepTimer !== null) { clearTimeout(sleepTimer); sleepTimer = null; }
  sleepDeadlineAt = null;
  sleepKnob.setValue(0);
  audio.fadeOutAndPause(SLEEP_FADE_MS);
}

function setSleep(minutes) {
  if (sleepTimer !== null) { clearTimeout(sleepTimer); sleepTimer = null; }
  sleepDeadlineAt = sleepDeadline(Date.now(), minutes);
  if (sleepDeadlineAt === null) return;
  sleepTimer = setTimeout(fireSleep, sleepDeadlineAt - Date.now());
}

// На заблокированном iPhone один длинный setTimeout может «проспать» срок: страхуемся проверкой по часам.
setInterval(() => {
  if (sleepDeadlineAt !== null && Date.now() >= sleepDeadlineAt) fireSleep();
}, CLOCK_CHECK_MS);

sleepKnob = createKnob($('knob-sleep'), {
  label: 'Sleep timer',
  steps: 3,
  value: 0,
  scaleLabels: ['OFF', '30', '60', '90'],
  valueText: (i) => SLEEP_TEXT[i],
  onStep(i) {
    sounds.knob();
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

// Список станций не загрузился — пробуем снова (2 с, 5 с, 10 с, дальше раз в 30 с): в PWA на iOS кнопки перезагрузки нет.
async function loadStationsWithRetry() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await loadStations();
    } catch {
      rows.city.set('NO STATIONS');
      const wait = STATION_RETRY_MS[attempt] ?? STATION_RETRY_LAST_MS;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function start() {
  stations = await loadStationsWithRetry();
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
