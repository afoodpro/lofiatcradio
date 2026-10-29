// Журнал отладки на экране — только по ?debug (грузится динамически из app.js).
// Пишет: действия Media Session (шторка, экран блокировки, руль), события и ошибки аудиоэлементов,
// результаты play(), состояние AudioContext, видимость страницы. Ничего не меняет в поведении.

export function installDebug() {
  const box = document.createElement('pre');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:42vh;overflow:auto;margin:0;padding:6px 8px;'
    + 'background:rgba(0,0,0,.82);color:#9f9;font:10px/1.35 ui-monospace,Menlo,monospace;z-index:99999;white-space:pre-wrap;pointer-events:auto;';
  document.body.appendChild(box);
  const lines = [];
  const t0 = performance.now();
  const log = (msg) => {
    const t = ((performance.now() - t0) / 1000).toFixed(1).padStart(6);
    lines.push(`${t} ${msg}`);
    if (lines.length > 60) lines.shift();
    box.textContent = lines.join('\n');
    box.scrollTop = box.scrollHeight;
  };
  const name = (el) => {
    const s = el.currentSrc || el.src || el.getAttribute('src') || '';
    if (/liveatc/.test(s)) return 'ATC';
    if (/hostingradio|laut/.test(s)) return 'LOFI';
    if (/sounds\//.test(s)) return 'UI';
    return s ? s.split('/').pop().slice(0, 20) : '(no src)';
  };

  // Media Session: перехватываем регистрацию, чтобы видеть каждое нажатие.
  const ms = navigator.mediaSession;
  if (ms && ms.setActionHandler) {
    const orig = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action, fn) => orig(action, fn ? (d) => { log(`MS action ${action}`); return fn(d); } : null);
  }

  // play() каждого медиаэлемента: результат и ошибка.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    const n = name(this);
    log(`${n}.play() src=${(this.currentSrc || this.src || '').slice(-28)} paused=${this.paused} rs=${this.readyState}`);
    const p = play.apply(this, a);
    if (p && p.then) p.then(() => log(`${n}.play() ok`), (e) => log(`${n}.play() REJECT ${e.name}: ${e.message}`));
    return p;
  };
  const pause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function (...a) { log(`${name(this)}.pause() by app`); return pause.apply(this, a); };

  // События аудиоэлементов (те, что уже в документе, и новые).
  const EVENTS = ['playing', 'pause', 'waiting', 'stalled', 'error', 'ended', 'emptied', 'suspend', 'abort'];
  const watched = new WeakSet();
  const watch = (el) => {
    if (watched.has(el)) return; watched.add(el);
    for (const ev of EVENTS) el.addEventListener(ev, () => {
      const extra = ev === 'error' && el.error ? ` code=${el.error.code}` : '';
      if (ev === 'suspend' && !el.paused) return; // шум при буферизации
      log(`${name(el)} event ${ev}${extra}`);
    });
  };
  document.querySelectorAll('audio').forEach(watch);
  new MutationObserver(() => document.querySelectorAll('audio').forEach(watch)).observe(document.body, { childList: true, subtree: true });

  // AudioContext (щелчки интерфейса): смены состояния.
  const C = window.AudioContext || window.webkitAudioContext;
  if (C) {
    const W = function (...a) {
      const ctx = new C(...a);
      log(`AudioContext created state=${ctx.state}`);
      ctx.addEventListener?.('statechange', () => log(`AudioContext state=${ctx.state}`));
      return ctx;
    };
    W.prototype = C.prototype;
    window.AudioContext = W;
    if (window.webkitAudioContext) window.webkitAudioContext = W;
  }

  document.addEventListener('visibilitychange', () => log(`page ${document.visibilityState}`));
  window.addEventListener('pagehide', () => log('pagehide'));
  log(`debug on · ${navigator.userAgent.match(/(iPhone|iPad|Mac OS X|Android)[^;)]*/)?.[0] || 'ua?'}`);
  return log;
}
