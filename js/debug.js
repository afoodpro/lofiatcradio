// Журнал отладки на экране — только по ?debug (грузится динамически из app.js).
// Пишет: действия Media Session (шторка, экран блокировки, руль), события и ошибки аудиоэлементов,
// результаты play(), состояние AudioContext, видимость страницы. Ничего не меняет в поведении.

export function installDebug() {
  const box = document.createElement('pre');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:0;right:0;top:0;max-height:24vh;overflow:hidden;margin:0;padding:4px 6px;'
    + 'background:rgba(0,0,0,.78);color:#9f9;font:9px/1.3 ui-monospace,Menlo,monospace;z-index:99999;white-space:pre-wrap;pointer-events:none;';
  document.body.appendChild(box);
  const lines = [];
  const t0 = performance.now();
  const log = (msg) => {
    const t = ((performance.now() - t0) / 1000).toFixed(1).padStart(6);
    lines.push(`${t} ${msg}`);
    if (lines.length > 18) lines.shift();
    box.textContent = lines.join('\n');
  };
  const name = (el) => {
    const s = el.getAttribute('src') || el.src || el.currentSrc || '';
    if (/liveatc/.test(s)) return 'ATC';
    if (/hostingradio|laut/.test(s)) return 'LOFI';
    if (/sounds\//.test(s)) return 'UI';
    return s ? s.split('/').pop().slice(0, 20) : '(no src)';
  };

  // Media Session: перехватываем регистрацию, чтобы видеть каждое нажатие.
  const ms = navigator.mediaSession;
  if (ms) {
    // Какое состояние мы сообщаем системе (шторка показывает play/pause по нему).
    const proto = Object.getPrototypeOf(ms);
    const desc = Object.getOwnPropertyDescriptor(proto, 'playbackState');
    if (desc && desc.set) Object.defineProperty(ms, 'playbackState', { configurable: true, get: () => desc.get.call(ms), set: (v) => { log(`MS playbackState=${v}`); desc.set.call(ms, v); } });
  }
  if (ms && ms.setActionHandler) {
    const orig = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action, fn) => orig(action, fn ? (d) => { log(`MS action ${action}`); return fn(d); } : null);
  }

  // play() каждого медиаэлемента: результат и ошибка.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    const n = name(this);
    log(`${n}.play() src=${(this.getAttribute('src') || '').slice(-26)} paused=${this.paused} rs=${this.readyState}`);
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
