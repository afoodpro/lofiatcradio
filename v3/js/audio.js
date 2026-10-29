import { atcUrl } from './stations.js';
import { LOFI_URL, IOS_LEVELS, retryDelay, stallCheck, atcStatus } from './audio-logic.js';

const EXTERNAL_RESUME_MS = 800;
const WATCH_INTERVAL_MS = 2000;

const isAbort = (err) => Boolean(err) && err.name === 'AbortError';

/**
 * Two simultaneous streams. Creates both <audio> elements itself (hidden, appended
 * to document.body) when called; the ATC one gets referrerpolicy="no-referrer"
 * and the lofi one crossOrigin="anonymous" before any src is assigned.
 */
export function createAudio({ ios, onState = () => {}, createElement = (tag) => document.createElement(tag) }) {
  const lofiEl = createElement('audio');
  lofiEl.crossOrigin = 'anonymous';
  const atcEl = createElement('audio');
  atcEl.setAttribute('referrerpolicy', 'no-referrer');
  atcEl.referrerPolicy = 'no-referrer';
  for (const el of [lofiEl, atcEl]) {
    el.preload = 'none';
    el.setAttribute('playsinline', '');
    el.hidden = true;
    if (typeof document !== 'undefined' && document.body) document.body.appendChild(el);
  }

  let playing = false;
  let station = null;
  let ctx = null;
  let lofiGain = null;
  let fadeTimer = null;
  const levels = ios ? { ...IOS_LEVELS } : { lofi: 0.5, atc: 1.0 };
  let fadeFactor = 1;

  const streams = {
    lofi: { el: lofiEl, failures: 0, attempt: 0, timer: null, lastProgressAt: 0, buffering: false, url: () => LOFI_URL },
    atc: { el: atcEl, failures: 0, attempt: 0, timer: null, lastProgressAt: 0, buffering: false, url: () => (station ? atcUrl(station, Date.now()) : null) },
  };

  const emit = () => onState({
    playing,
    buffering: streams.lofi.buffering || streams.atc.buffering,
    atc: atcStatus({ failures: streams.atc.failures }),
  });

  function applyVolume(name) {
    if (ios) return; // audio.volume is read-only on iOS
    const v = levels[name] * fadeFactor;
    if (name === 'lofi' && lofiGain) lofiGain.gain.value = v;
    else streams[name].el.volume = v;
  }

  function ensureGraph() {
    // Never on iOS: an AudioContext makes CarPlay/Bluetooth stutter and pause.
    if (ios) return;
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      lofiGain = ctx.createGain();
      ctx.createMediaElementSource(lofiEl).connect(lofiGain).connect(ctx.destination);
      lofiEl.volume = 1;
      applyVolume('lofi');
    } catch (_) { ctx = null; lofiGain = null; }
  }

  // Must be called synchronously inside the user gesture (no .then before play on mobile).
  function startStream(name, reload) {
    const s = streams[name];
    const url = s.url();
    if (!url) return;
    if (reload || !s.el.src) s.el.src = url;
    s.lastProgressAt = Date.now();
    const p = s.el.play();
    if (p && p.catch) p.catch((err) => {
      if (isAbort(err)) return;
      if (err.name === 'NotAllowedError' && name === 'lofi') { hardPause(); return; }
      scheduleRetry(name);
    });
  }

  function clearRetry(name) {
    const s = streams[name];
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  }

  function scheduleRetry(name) {
    const s = streams[name];
    if (!playing || s.timer || !s.url()) return;
    s.failures += 1;
    const delay = retryDelay(s.attempt++);
    emit();
    s.timer = setTimeout(() => {
      s.timer = null;
      const url = s.url();
      if (!playing || !url) return;
      s.el.src = url;
      s.lastProgressAt = Date.now();
      const p = s.el.play();
      if (p && p.catch) p.catch((err) => { if (!isAbort(err)) scheduleRetry(name); });
    }, delay);
  }

  function markAlive(name) {
    const s = streams[name];
    const changed = s.failures !== 0 || s.buffering;
    s.failures = 0; s.attempt = 0; s.buffering = false;
    clearRetry(name);
    if (changed) emit();
  }

  for (const name of ['lofi', 'atc']) {
    const s = streams[name];
    s.el.addEventListener('timeupdate', () => { s.lastProgressAt = Date.now(); });
    s.el.addEventListener('playing', () => { s.lastProgressAt = Date.now(); markAlive(name); });
    s.el.addEventListener('waiting', () => { if (playing) { s.buffering = true; emit(); } });
    s.el.addEventListener('canplay', () => { if (s.buffering) { s.buffering = false; emit(); } });
    s.el.addEventListener('error', () => scheduleRetry(name));
    // 'stalled' is deliberately ignored: a live mount can be slow to send first bytes;
    // hard retries come from 'error' and the stallCheck watchdog (12 s from the play request).
    // External pause (Bluetooth/CarPlay/call): playing is still true, so resume.
    s.el.addEventListener('pause', () => {
      if (!playing) return;
      setTimeout(() => {
        if (!playing || !s.el.paused) return;
        const replay = () => {
          if (!playing || !s.el.paused) return;
          s.el.play().catch((err) => {
            if (isAbort(err)) return;
            const url = s.url();
            if (!url) return;
            s.el.src = url;
            s.el.play().catch(() => {});
          });
        };
        // v2 lesson: a suspended AudioContext must be resumed before replaying.
        if (ctx && ctx.state === 'suspended') ctx.resume().then(replay, replay);
        else replay();
      }, EXTERNAL_RESUME_MS);
    });
  }

  setInterval(() => {
    if (!playing) return;
    const now = Date.now();
    for (const name of ['lofi', 'atc']) {
      const s = streams[name];
      if (name === 'atc' && !station) continue;
      if (!s.timer && stallCheck({ playing: !s.el.paused || s.buffering, lastProgressAt: s.lastProgressAt, now })) scheduleRetry(name);
    }
  }, WATCH_INTERVAL_MS);

  function stopFade() {
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    if (fadeFactor !== 1) { fadeFactor = 1; applyVolume('lofi'); applyVolume('atc'); }
  }

  function hardPause() {
    stopFade();
    playing = false;
    lofiEl.pause();
    atcEl.pause();
    for (const name of ['lofi', 'atc']) { clearRetry(name); streams[name].buffering = false; streams[name].attempt = 0; }
    emit();
  }

  return {
    play() {
      stopFade();
      const wasStarted = Boolean(lofiEl.src);
      playing = true;
      ensureGraph();
      startStream('lofi', wasStarted);
      startStream('atc', wasStarted);
      emit();
    },
    pause: hardPause,
    setStation(next) {
      station = next;
      const s = streams.atc;
      s.failures = 0; s.attempt = 0; s.buffering = false;
      clearRetry('atc');
      if (playing) startStream('atc', true);
      else atcEl.removeAttribute('src');
      emit();
    },
    setVolume(name, v) {
      if (ios || !levels.hasOwnProperty(name)) return;
      levels[name] = Math.min(1, Math.max(0, v));
      applyVolume(name);
    },
    toggleMute(name) {
      const el = streams[name].el;
      el.muted = !el.muted;
      return el.muted;
    },
    fadeOutAndPause(ms) {
      if (ios || !playing) { hardPause(); return; }
      stopFade();
      const t0 = Date.now();
      fadeTimer = setInterval(() => {
        const k = 1 - (Date.now() - t0) / ms;
        if (k <= 0) { hardPause(); return; }
        fadeFactor = k;
        applyVolume('lofi'); applyVolume('atc');
      }, 50);
    },
  };
}
