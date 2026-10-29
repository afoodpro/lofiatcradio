// Паспорт изделия — металлическая табличка на обороте прибора. Кнопка в правом верхнем углу
// разворачивает прибор, такая же кнопка на обороте (или Esc) — возвращает; фокус возвращается
// на кнопку лицевой панели. Ничего не делает при импорте — только при вызове createPassport.

const FLIP_MS = 600; // совпадают с transition в device.css
const FADE_MS = 250; // prefers-reduced-motion: вместо разворота — смена плавным переходом
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

  const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

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

  function show() {
    if (open) return;
    open = true;
    clearTimeout(doneTimer);
    place();
    back.hidden = false;
    back.inert = false;
    front.inert = true;
    unit.classList.add('is-turning');
    void unit.offsetWidth; // старт перехода из исходного положения
    unit.classList.add('is-flipped');
    button.setAttribute('aria-expanded', 'true');
    backButton.focus({ preventScroll: true });
  }

  function hide() {
    if (!open) return;
    open = false;
    clearTimeout(doneTimer);
    unit.classList.remove('is-flipped');
    back.inert = true; // пока оборот уходит, он не держит фокус и не ловит нажатия
    front.inert = false;
    button.setAttribute('aria-expanded', 'false');
    button.focus({ preventScroll: true });
    doneTimer = setTimeout(() => {
      back.hidden = true;
      unit.classList.remove('is-turning');
    }, reducedMotion() ? FADE_MS : FLIP_MS);
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
