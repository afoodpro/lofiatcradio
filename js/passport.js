// Паспорт изделия — чёрный шильдик со схемой на обороте прибора. Кнопка в правом верхнем углу
// разворачивает прибор, такая же кнопка на обороте (или Esc) — возвращает; фокус возвращается
// на кнопку лицевой панели. Ничего не делает при импорте — только при вызове createPassport.

import { reducedMotion } from './motion.js';

const HALF_MS = 300; // половина разворота — совпадает с transition .unit в device.css

const FONT_PRELOAD_DELAY_MS = 3000;
// Кириллица и латиница: загружаются оба файла unicode-range каждого начертания.
const FONT_SAMPLE = 'Паспорт Passport';

/**
 * @param {object} o
 * @param {HTMLElement} o.unit          обёртка, которая разворачивается (лицо + оборот)
 * @param {HTMLElement} o.front         лицевая панель (на время паспорта — inert)
 * @param {HTMLElement} o.back          оборот: role="dialog", hidden в закрытом виде
 * @param {HTMLButtonElement} o.button      кнопка паспорта на лицевой панели (aria-expanded)
 * @param {HTMLButtonElement} o.backButton  такая же кнопка на обороте
 */
export function createPassport({ unit, front, back, button, backButton }) {
  let open = false;
  let doneTimer = null;


  // Кнопка на обороте стоит на той же высоте, что на лице: на высоком телефоне катушка вместе
  // с кнопкой отцентрована и ниже края корпуса, поэтому высоту меряем (по горизонтали отступ
  // задан в CSS). Только offsetTop: он не зависит от transform, и замер верен и посреди
  // разворота, и на развёрнутом приборе.
  function place() {
    let top = 0;
    for (let el = button; el && el !== front; el = el.offsetParent) top += el.offsetTop;
    back.style.setProperty('--btn-top', `${top}px`);
    back.style.setProperty('--btn-bottom', `${top + button.offsetHeight}px`);
  }

  // Разворот в два шага (см. device.css): уход в профиль → смена сторон → доворот из −90°.
  let turnToken = 0;
  function turn(toBack, done) {
    const token = ++turnToken;
    clearTimeout(doneTimer);
    const swap = () => {
      unit.classList.toggle('show-back', toBack);
      done();
    };
    if (reducedMotion()) { swap(); return; }
    unit.classList.remove('turn-in-start', 'turning-in', 'no-anim');
    unit.classList.add('turn-out');
    doneTimer = setTimeout(() => {
      if (token !== turnToken) return;
      unit.classList.add('no-anim', 'turn-in-start');
      unit.classList.remove('turn-out');
      swap();
      void unit.offsetWidth; // зафиксировать −90° без анимации
      unit.classList.remove('no-anim');
      unit.classList.add('turning-in');
      unit.classList.remove('turn-in-start');
      doneTimer = setTimeout(() => { if (token === turnToken) unit.classList.remove('turning-in'); }, HALF_MS);
    }, HALF_MS);
  }

  function show() {
    if (open) return;
    open = true;
    place();
    front.inert = true;
    button.setAttribute('aria-expanded', 'true');
    turn(true, () => {
      back.hidden = false;
      back.inert = false;
      backButton.focus({ preventScroll: true });
    });
  }

  function hide() {
    if (!open) return;
    open = false;
    back.inert = true; // пока оборот уходит, он не держит фокус и не ловит нажатия
    button.setAttribute('aria-expanded', 'false');
    turn(false, () => {
      back.hidden = true;
      front.inert = false;
      button.focus({ preventScroll: true });
    });
  }

  button.addEventListener('click', show);
  backButton.addEventListener('click', hide);
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') { e.preventDefault(); hide(); }
  });
  window.addEventListener('resize', () => { if (open) place(); });

  // Шрифт таблички — заранее, в простое: иначе на первом развороте текст перерисуется посреди поворота.
  const preloadFonts = () => {
    if (!document.fonts?.load) return;
    for (const weight of [400, 500]) document.fonts.load(`${weight} 16px Oswald`, FONT_SAMPLE).catch(() => {});
  };
  setTimeout(() => {
    if (window.requestIdleCallback) window.requestIdleCallback(preloadFonts);
    else preloadFonts();
  }, FONT_PRELOAD_DELAY_MS);

  return { isOpen: () => open, open: show, close: hide };
}
