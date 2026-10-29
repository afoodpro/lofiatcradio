// DOM-компонент табло: ряд перекидных флажков (Web Animations API).
// Стили ячеек (.cell .u .d .fu .fd, размеры lg/md) — в CSS; здесь только разметка и анимация.
import { flipPath } from './board.js';

const STEP_MS = 70;
const STAGGER_MS = 25;

function cellHTML(size) {
  const half = (cls) => `<span class="${cls}"><b> </b></span>`;
  return `<span class="cell ${size}" data-c=" ">${half('u')}${half('d')}${half('fu')}${half('fd')}</span>`;
}

function setFace(cell, c) {
  cell.el.dataset.c = c;
  cell.cur = c;
  for (const b of cell.el.querySelectorAll('b')) b.textContent = c;
}

// Один шаг флажка cur -> next: верхняя половинка падает, нижняя поднимается.
function flipOnce(cell, next, onFlip) {
  onFlip?.();
  const { el, cur } = cell;
  const u = el.querySelector('.u b'), d = el.querySelector('.d b');
  const fu = el.querySelector('.fu'), fd = el.querySelector('.fd');
  u.textContent = next;
  d.textContent = cur;
  fu.querySelector('b').textContent = cur;
  fd.querySelector('b').textContent = next;
  fu.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
    { duration: STEP_MS / 2, easing: 'ease-in', fill: 'forwards' });
  const a = fd.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
    { duration: STEP_MS / 2, delay: STEP_MS / 2, easing: 'ease-out', fill: 'forwards' });
  return a.finished.then(() => {
    setFace(cell, next);
    fu.getAnimations().forEach((x) => x.cancel());
    fd.getAnimations().forEach((x) => x.cancel());
  });
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createFlapRow(container, length, size, { onFlip } = {}) {
  container.innerHTML = Array.from({ length }, () => cellHTML(size)).join('');
  const cells = [...container.querySelectorAll('.cell')].map((el) => ({
    el, cur: ' ', target: ' ', timer: null, running: false,
  }));

  function run(cell) {
    const [next] = flipPath(cell.cur, cell.target);
    if (next === undefined) { cell.running = false; return; }
    flipOnce(cell, next, onFlip).then(() => run(cell), () => { cell.running = false; });
  }

  function retarget(cell, target, delay) {
    cell.target = target;
    if (cell.running) return; // цепочка уже идёт, подхватит новую цель на следующем шаге
    cell.running = true;
    cell.timer = setTimeout(() => { cell.timer = null; run(cell); }, delay);
  }

  function settle(cell, target) {
    clearTimeout(cell.timer);
    cell.timer = null;
    cell.running = false;
    cell.el.querySelectorAll('.fu, .fd').forEach((h) => h.getAnimations().forEach((x) => x.cancel()));
    cell.target = target;
    setFace(cell, target);
  }

  return {
    set(text) {
      const t = String(text ?? '').toUpperCase();
      const instant = reducedMotion();
      cells.forEach((cell, i) => {
        let target = t[i] ?? ' ';
        if (flipPath(' ', target).length === 0 && target !== ' ') target = ' '; // символ вне CHARSET
        if (instant) settle(cell, target);
        else retarget(cell, target, i * STAGGER_MS);
      });
    },
  };
}
