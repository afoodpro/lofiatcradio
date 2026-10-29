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
export const MAX_BLIPS = 12;
export const HUB_CLEAR_R = 0.28; // в единицах r (1 = внешнее кольцо, 0.8R экрана): втулка 0.2R = r 0.25, плюс половина силуэта

// Бортов меньше k → следующий радиус из RADII; иначе тот же. Радиус не уменьшается.
export function nextRadius(nm, count, k = MAX_BLIPS) {
  if (count >= k) return nm;
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

// Масштаб экрана, NM: k-й ближайший (или самый дальний) борт ставим на долю edge радиуса.
// Борты под втулкой (ближе hubClear × D) не считаются: D уточняем двумя-тремя шагами.
export function chooseDisplayRadius(distancesNm, { maxNm, minNm = 10, k = 12, edge = 0.9, hubClear = HUB_CLEAR_R } = {}) {
  const sorted = distancesNm.filter((d) => Number.isFinite(d) && d <= maxNm).sort((a, b) => a - b);
  if (!sorted.length) return maxNm;
  const clamp = (v) => Math.min(maxNm, Math.max(minNm, v));
  const edgeOf = (list) => clamp(list[Math.min(k, list.length) - 1] / edge);
  let d = edgeOf(sorted);
  for (let i = 0; i < 3; i++) {
    const visible = sorted.filter((x) => x >= hubClear * d);
    if (!visible.length) return d;
    const next = edgeOf(visible);
    if (next === d) break;
    d = next;
  }
  return d;
}

// Отметки внутри круга и вне втулки; не больше MAX_BLIPS ближайших к станции.
export function toBlips(station, nm, aircraft) {
  const out = [];
  for (const a of aircraft) {
    const { x, y, r } = project(station.lat, station.lon, nm, a.lat, a.lon);
    if (r > 1 || r < HUB_CLEAR_R) continue;
    out.push({ x, y, r, track: a.track, call: String(a.call ?? '').slice(0, CALL_MAX) });
  }
  out.sort((p, q) => p.r - q.r);
  return out.slice(0, MAX_BLIPS).map(({ x, y, track, call }) => ({ x, y, track, call }));
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
      emit({ nm: asked, displayNm: asked, status: 'offline', blips: [] });
      schedule(RETRY_MS);
      return;
    }
    const dists = data.aircraft.map((a) => project(st.lat, st.lon, 1, a.lat, a.lon).r);
    const displayNm = Math.round(chooseDisplayRadius(dists, { maxNm: asked }));
    const blips = toBlips(st, displayNm, data.aircraft);
    const count = blips.length; // рост и статус решает число видимых бортов
    emit({ nm: asked, displayNm, status: radarStatus({ ok: true, nm: asked, count }), blips });
    const grown = nextRadius(asked, count);
    if (grown !== asked) {
      nm = grown;
      if (visible()) poll(); // бортов мало: следующий радиус сразу
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
