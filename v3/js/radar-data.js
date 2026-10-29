// Данные радара на клиенте: опрос прокси, авто-рост радиуса, превращение самолётов в отметки.
// DOM при импорте не трогает.
import { project } from './reel-math.js';

export const RADAR_BASE = 'https://radar.afood.pro';
export const RADII = [40, 80, 150, 250];
const POLL_MS = 10000; // пока играет
const PAUSED_POLL_MS = 60000; // на паузе радар почти не нужен — бережём бюджет OpenSky
const RETRY_MS = 30000;
const TIMEOUT_MS = 10000;
const CALL_MAX = 7;

// Пустой экран → следующий радиус из RADII; иначе тот же. Радиус не уменьшается.
export function nextRadius(nm, count) {
  if (count !== 0) return nm;
  const next = RADII.find((r) => r > nm);
  return next === undefined ? nm : next;
}

export function radarStatus({ ok, nm, count }) {
  if (!ok) return 'offline';
  if (count === 0 && nm === RADII[RADII.length - 1]) return 'none';
  return 'ok';
}

export function labelFor(status) {
  if (status === 'none') return 'NO ADS-B COVERAGE';
  if (status === 'offline') return 'RADAR OFFLINE';
  return null;
}

export function toBlips(station, nm, aircraft) {
  const out = [];
  for (const a of aircraft) {
    const { x, y, r } = project(station.lat, station.lon, nm, a.lat, a.lon);
    if (r > 1) continue;
    out.push({ x, y, track: a.track, call: String(a.call ?? '').slice(0, CALL_MAX) });
  }
  return out;
}

export function createRadarFeed({ onUpdate, fetchFn = (...args) => fetch(...args), playing: initialPlaying = true }) {
  let playing = initialPlaying;
  let station = null;
  let nm = RADII[0];
  let gen = 0; // меняется при start/stop: ответы прошлых запусков игнорируются
  let timer = null;
  let inflight = false;
  let listening = false;
  let ctl = null;
  let abortTimer = null;

  const visible = () => globalThis.document?.visibilityState === 'visible';
  const clearTimer = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

  function emit(update) {
    try { onUpdate(update); } catch { /* сбой потребителя не должен останавливать опрос */ }
  }

  function dropRequest() {
    if (abortTimer !== null) { clearTimeout(abortTimer); abortTimer = null; }
    if (ctl) { ctl.abort(); ctl = null; }
  }

  function schedule(ms) {
    clearTimer();
    if (station && visible()) timer = setTimeout(poll, ms);
  }

  async function poll() {
    timer = null;
    if (!station || inflight || !visible()) return;
    const myGen = gen;
    const st = station;
    const asked = nm;
    inflight = true;
    const mine = new AbortController();
    ctl = mine;
    abortTimer = setTimeout(() => mine.abort(), TIMEOUT_MS);
    let data = null;
    try {
      const res = await fetchFn(`${RADAR_BASE}/v1/aircraft?station=${encodeURIComponent(st.code)}&nm=${asked}`, { signal: mine.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      if (!data || !Array.isArray(data.aircraft)) throw new Error('bad payload');
    } catch {
      data = null;
    }
    if (myGen !== gen) return; // станция сменилась или feed остановлен; inflight уже сброшен
    inflight = false;
    if (abortTimer !== null) { clearTimeout(abortTimer); abortTimer = null; }
    ctl = null;
    if (!data) {
      emit({ nm: asked, status: 'offline', blips: [] });
      schedule(RETRY_MS);
      return;
    }
    const blips = toBlips(st, asked, data.aircraft);
    const count = blips.length; // рост и статус решает число бортов внутри круга
    emit({ nm: asked, status: radarStatus({ ok: true, nm: asked, count }), blips });
    const grown = nextRadius(asked, count);
    if (grown !== asked) {
      nm = grown;
      if (visible()) poll(); // пустой экран: следующий радиус сразу
    } else {
      schedule(playing ? POLL_MS : PAUSED_POLL_MS);
    }
  }

  function onVisibility() {
    if (!station) return;
    if (visible()) {
      if (timer === null && !inflight) poll();
    } else {
      clearTimer();
    }
  }

  return {
    // Играет — опрос раз в 10 с, пауза — раз в 60 с. При нажатии PLAY ждущий опрос подтягивается к 10 с.
    setPlaying(next) {
      next = Boolean(next);
      if (next === playing) return;
      playing = next;
      if (next && station && timer !== null && !inflight) schedule(POLL_MS);
    },
    start(next) {
      gen += 1;
      inflight = false;
      dropRequest();
      clearTimer();
      station = next;
      nm = RADII[0];
      if (!listening && globalThis.document) {
        globalThis.document.addEventListener('visibilitychange', onVisibility);
        listening = true;
      }
      poll();
    },
    stop() {
      gen += 1;
      inflight = false;
      station = null;
      dropRequest();
      clearTimer();
    },
  };
}
