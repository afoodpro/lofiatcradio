// Поворотная ручка: чёрная рифлёная, белая риска, шкала делений вокруг. Рисуется inline SVG, размер задаёт CSS-бокс элемента.
// Опции: valueText(stepIndex) -> строка для aria-valuetext (сон), scaleLabels — подписи на каждое деление вместо MIN/MAX.
// Жест: тянуть вверх/вниз или вести по кругу, колесо, клавиши. Вся математика — в knob-math.js.
import { snap, valueToAngle, dragValue, wheelSteps, WHEEL_THRESHOLD, DRAG_PX_PER_STEP, ANGLE_MIN, ANGLE_MAX } from './knob-math.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'Teko, "Arial Narrow", sans-serif';
const INK = '#2a2d2a';
const FLUTES = 30;

const polar = (r, deg) => {
  const a = deg * Math.PI / 180;
  return [50 + r * Math.sin(a), 50 - r * Math.cos(a)];
};
const f = (n) => n.toFixed(2);

// Шкала: короткие деления на каждом шаге, подписи — либо MIN/MAX по краям, либо свои на каждое деление.
function scaleMarkup(steps, scaleLabels) {
  const many = steps > 4;
  let s = '';
  for (let i = 0; i <= steps; i++) {
    const deg = ANGLE_MIN + (ANGLE_MAX - ANGLE_MIN) * i / steps;
    const major = !many || i === 0 || i === steps || i % 5 === 0;
    const [x1, y1] = polar(many && !major ? 35 : 33, deg);
    const [x2, y2] = polar(major ? 39 : 38, deg);
    s += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${INK}" stroke-width="${major ? 1.6 : 1}" stroke-linecap="round"/>`;
  }
  const placed = scaleLabels
    ? scaleLabels.map((t, i) => [t, ANGLE_MIN + (ANGLE_MAX - ANGLE_MIN) * i / steps])
    : [['MIN', ANGLE_MIN], ['MAX', ANGLE_MAX]];
  for (const [t, deg] of placed) {
    const [x, y] = polar(47, deg);
    s += `<text x="${f(x)}" y="${f(y + 3)}" text-anchor="middle" font-family='${FONT}' font-size="10" fill="${INK}">${t}</text>`;
  }
  return s;
}

function bodyMarkup() {
  let flutes = '';
  for (let i = 0; i < FLUTES; i++) {
    const deg = 360 * i / FLUTES;
    const [x1, y1] = polar(23.5, deg);
    const [x2, y2] = polar(29.5, deg);
    flutes += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
  }
  // Одна мягкая тень без filter (id фильтра дублировались бы между ручками).
  return `<circle cx="50" cy="53" r="31" fill="rgba(0,0,0,0.10)"/><circle cx="50" cy="52" r="30.5" fill="rgba(0,0,0,0.14)"/>` +
    `<circle cx="50" cy="50" r="30" fill="#161716"/>` +
    `<g stroke="#3a3d3a" stroke-width="1.3" stroke-linecap="round">${flutes}</g>` +
    `<circle cx="50" cy="50" r="22" fill="#1d1f1d"/>` +
    `<circle cx="50" cy="50" r="22" fill="none" stroke="#2f322f" stroke-width="0.8"/>`;
}

export function createKnob(el, { label, steps = 20, value = 0, disabled = false, valueText, scaleLabels, onChange, onStep, onPress } = {}) {
  let v = snap(value, steps);
  let isDisabled = !!disabled;
  let pressed = false;
  let dragging = false;
  let start = null;
  let wheelAcc = 0;
  let lastWheel = 0;
  const coarse = steps <= 4;

  el.classList.add('knob');
  el.style.touchAction = 'none';
  el.style.userSelect = 'none';
  el.style.webkitUserSelect = 'none';
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', label);
  el.innerHTML =
    `<svg viewBox="0 0 100 100" width="100%" height="100%" focusable="false" aria-hidden="true" style="display:block;overflow:visible">` +
    `<g class="knob-scale">${scaleMarkup(steps, scaleLabels)}</g>` +
    bodyMarkup() +
    `<line class="knob-index" x1="50" y1="30" x2="50" y2="45" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` +
    `</svg>`;
  const index = el.querySelector('.knob-index');
  index.style.transformOrigin = '50px 50px';
  index.style.transition = 'transform .16s cubic-bezier(.3,.7,.4,1)';

  const stepOf = (x) => Math.round(snap(x, steps) * steps);

  function render() {
    index.style.transform = `rotate(${valueToAngle(v, steps)}deg)`;
    if (isDisabled) {
      el.setAttribute('role', 'button');
      el.setAttribute('aria-pressed', String(pressed));
      el.removeAttribute('aria-valuenow');
      el.removeAttribute('aria-valuemin');
      el.removeAttribute('aria-valuemax');
      el.removeAttribute('aria-valuetext');
      el.setAttribute('aria-disabled', 'false'); // нажимается: это кнопка mute
    } else {
      el.setAttribute('role', 'slider');
      el.removeAttribute('aria-pressed');
      el.removeAttribute('aria-disabled');
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', '100');
      el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      if (typeof valueText === 'function') el.setAttribute('aria-valuetext', valueText(stepOf(v)));
      else el.removeAttribute('aria-valuetext');
    }
    el.style.opacity = isDisabled ? '0.45' : '';
    el.style.cursor = isDisabled ? 'pointer' : 'grab';
  }

  function commit(next) {
    const n = snap(next, steps);
    if (n === v) return;
    const changedStep = stepOf(n) !== stepOf(v);
    v = n;
    render();
    if (changedStep && typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(4); } catch (e) { /* нет вибрации — ничего страшного */ }
    }
    if (changedStep && onStep) onStep(stepOf(v));
    if (onChange) onChange(v);
  }

  function angleOf(e) {
    const r = el.getBoundingClientRect();
    return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
  }

  el.addEventListener('pointerdown', (e) => {
    if (isDisabled || e.button !== 0) return;
    dragging = true;
    start = { y: e.clientY, v, a: angleOf(e) };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    el.style.cursor = 'grabbing';
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let da = angleOf(e) - start.a;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    const dy = e.clientY - start.y;
    // Грубые ручки (сон): целые деления по DRAG_PX_PER_STEP.coarse; остальные — непрерывное значение, commit привязывает к делению.
    if (coarse) commit(start.v + Math.round(-dy / DRAG_PX_PER_STEP.coarse) / steps);
    else commit(dragValue(start.v, dy, da));
  });
  const endDrag = () => { dragging = false; start = null; if (!isDisabled) el.style.cursor = 'grab'; };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('lostpointercapture', endDrag);

  el.addEventListener('wheel', (e) => {
    if (isDisabled) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel > 250) wheelAcc = 0;
    lastWheel = now;
    const r = wheelSteps(wheelAcc, e.deltaY, e.deltaMode, coarse ? WHEEL_THRESHOLD.coarse : WHEEL_THRESHOLD.fine);
    wheelAcc = r.acc;
    if (r.steps) commit(v + r.steps / steps);
  }, { passive: false });

  el.addEventListener('click', () => { if (isDisabled && onPress) onPress(); });

  el.addEventListener('keydown', (e) => {
    if (isDisabled) {
      if ((e.key === 'Enter' || e.key === ' ') && onPress) { e.preventDefault(); onPress(); }
      return;
    }
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowRight') commit(v + 1 / steps);
    else if (k === 'ArrowDown' || k === 'ArrowLeft') commit(v - 1 / steps);
    else if (k === 'Home') commit(0);
    else if (k === 'End') commit(1);
    else return;
    e.preventDefault();
  });

  render();

  return {
    setValue(next) { v = snap(next, steps); render(); },
    setDisabled(b, isPressed = false) { isDisabled = !!b; pressed = !!isPressed; dragging = false; render(); },
  };
}
