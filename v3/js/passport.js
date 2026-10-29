// Паспорт изделия — металлическая табличка на обороте прибора. Кнопка в правом верхнем углу
// разворачивает прибор, такая же кнопка на обороте (или Esc) — возвращает; фокус возвращается
// на кнопку лицевой панели. Ничего не делает при импорте — только при вызове createPassport.

const FLIP_MS = 600; // совпадают с transition в device.css
const FADE_MS = 250; // prefers-reduced-motion: вместо разворота — смена плавным переходом

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

  // Кнопка на обороте стоит там же, где на лице: на высоком телефоне катушка вместе с кнопкой
  // отцентрована и ниже края корпуса, поэтому положение меряем.
  function place() {
    const u = unit.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    back.style.setProperty('--btn-top', `${Math.round(b.top - u.top)}px`);
    back.style.setProperty('--btn-right', `${Math.round(u.right - b.right)}px`);
    back.style.setProperty('--btn-bottom', `${Math.round(b.bottom - u.top)}px`);
  }

  function show() {
    if (open) return;
    open = true;
    clearTimeout(doneTimer);
    place();
    back.hidden = false;
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

  return { isOpen: () => open, open: show, close: hide };
}
