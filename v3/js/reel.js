// Катушка-радар на Canvas 2D. Радар неподвижен (север вверху), поверх вращаются обод и три спицы с втулкой.
// Спицы работают как развёртка: отметка вспыхивает под спицей и гаснет до следующей (blipBrightness).
// Рисуем в круг min(width, height) по центру canvas; размер берётся из CSS-бокса (ResizeObserver).
import { stepReel, blipBrightness, bearing, layoutLabels, easeRange, SPOKES } from './reel-math.js';
import { reducedMotion } from './motion.js';

const RIM_TEXT = 'ATC LIVE RADIO · WITH LO-FI · 7½ IPS';
const RIM_FONT = 'Teko, sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const REDUCED_BRIGHTNESS = 0.8;
// Угол катушки в покое: спицы не закрывают N, шкалу и подпись внизу, надпись обода стоит сверху.
const REST_ANGLE = 30;
const RANGE_ANIM_MS = 1000;

const C = {
  seat: '#8d918c',
  scope: '#171a17',
  ring: 'rgba(220,226,218,0.13)',
  cross: 'rgba(220,226,218,0.07)',
  runway: 'rgba(233,237,230,0.3)',
  screenText: 'rgba(233,237,230,0.45)',
  blip: '238,242,234',
  metalHi: '#eceeea', metalLo: '#c3c7c2',
  rimEdge: 'rgba(40,44,40,0.45)',
  tick: 'rgba(36,39,36,0.55)', tickLong: 'rgba(36,39,36,0.8)',
  rimInk: 'rgba(30,33,30,0.78)',
  spoke: '#d8dbd6', spokeEdge: 'rgba(60,64,60,0.55)',
  hub: '#cdd0cc', hubRing: '#e2e4e0', hubEdge: 'rgba(60,64,60,0.5)',
  spindle: '#151615', screw: '#a9ada7',
};

// Радиусы в долях радиуса окна R.
const G = {
  rimOuter: 0.995, rimInner: 0.875,
  tickOut: 0.982, tickShort: 0.955, tickLong: 0.94, ticks: 120,
  textBase: 0.895, textSize: 0.052,
  plot: 0.8, // единичный круг самолётов (r = 1) — внешнее кольцо дальности
  hub: 0.2,
  spokeRoot: 0.12, spokeTip: 0.93, spokeW0: 0.1, spokeW1: 0.13,
};

// Силуэт самолёта носом вверх, единичный размах.
function planePath(ctx, s) {
  const p = [[0, -1], [0.11, -0.78], [0.11, -0.22], [1, 0.2], [1, 0.36], [0.11, 0.18], [0.09, 0.62], [0.4, 0.84], [0.4, 0.96], [0, 0.88]];
  ctx.beginPath();
  ctx.moveTo(p[0][0] * s, p[0][1] * s);
  for (const [x, y] of p.slice(1)) ctx.lineTo(x * s, y * s);
  for (const [x, y] of p.slice(1, -1).reverse()) ctx.lineTo(-x * s, y * s);
  ctx.closePath();
}

export function createReel(canvas) {
  const ctx = canvas.getContext('2d');
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = reducedMotion();
  let state = { angle: REST_ANGLE, speed: 0 };
  let playing = false;
  let label = null;
  let rangeNm = null; // целевой масштаб, NM
  let shownNm = null; // масштаб на экране (плывёт к rangeNm)
  let rangeAnim = null; // {from, to, t0} — t0 ставится в первом кадре
  let planes = []; // борты в NM от центра: {xNm, yNm, track, call}
  let cssW = 0, cssH = 0, scale = 1;
  let raf = 0, last = 0, destroyed = false;
  let glyphs = null; // {size, list: [{ch, a}]} — раскладка надписи по ободу для текущего размера

  // ---- размер и чёткость ----
  const ro = new ResizeObserver(([e]) => {
    cssW = e.contentRect.width;
    cssH = e.contentRect.height;
    const box = e.devicePixelContentBoxSize?.[0];
    const dpr = window.devicePixelRatio || 1;
    const pw = box ? box.inlineSize : Math.round(cssW * dpr);
    const ph = box ? box.blockSize : Math.round(cssH * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    scale = cssW > 0 ? pw / cssW : dpr;
    glyphs = null;
    render();
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }

  const onFonts = () => { glyphs = null; kick(); };
  document.fonts?.load(`500 12px ${RIM_FONT}`).then(onFonts, () => {});
  document.fonts?.addEventListener?.('loadingdone', onFonts);

  const onMotion = () => { reduced = reducedMotion(); if (reduced) state = { angle: state.angle, speed: 0 }; kick(); };
  mq?.addEventListener?.('change', onMotion);

  // ---- цикл ----
  function animating() {
    return rangeAnim !== null || (!reduced && (playing || state.speed > 0.02));
  }

  function frame(t) {
    raf = 0;
    const dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (rangeAnim) {
      if (rangeAnim.t0 === null) rangeAnim.t0 = t;
      shownNm = easeRange(rangeAnim.from, rangeAnim.to, t - rangeAnim.t0, RANGE_ANIM_MS);
      if (t - rangeAnim.t0 >= RANGE_ANIM_MS) { shownNm = rangeAnim.to; rangeAnim = null; }
    }
    if (!reduced) {
      state = stepReel(state, dt, playing);
      if (!playing && state.speed <= 0.02) state = { angle: state.angle, speed: 0 };
    }
    render();
    if (animating()) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function kick() {
    if (destroyed || raf) return;
    raf = requestAnimationFrame(frame);
  }


  // ---- отрисовка ----
  function render() {
    if (destroyed || cssW <= 0 || cssH <= 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const R = Math.min(cssW, cssH) / 2;
    ctx.translate(cssW / 2, cssH / 2);
    drawScope(R);
    drawAircraft(R);
    ctx.save();
    ctx.rotate(state.angle * Math.PI / 180);
    drawSpokes(R);
    drawRim(R);
    drawHub(R);
    ctx.restore();
  }

  function circle(r) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }

  function drawScope(R) {
    const sr = R * G.rimInner, pr = R * G.plot;
    circle(sr);
    ctx.fillStyle = C.scope;
    ctx.fill();
    ctx.save();
    circle(sr);
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.ring;
    for (const f of [1 / 3, 2 / 3, 1]) { circle(pr * f); ctx.stroke(); }
    ctx.strokeStyle = C.cross;
    ctx.beginPath();
    ctx.moveTo(0, -sr); ctx.lineTo(0, sr);
    ctx.moveTo(-sr, 0); ctx.lineTo(sr, 0);
    ctx.stroke();
    // Полосы аэропорта в центре (условные): длиннее втулки (0.2R), концы видны вокруг неё.
    ctx.strokeStyle = C.runway;
    ctx.lineCap = 'butt';
    for (const [deg, len, w] of [[-40, R * 0.66, 0.016], [30, R * 0.56, 0.012]]) {
      const a = deg * Math.PI / 180;
      ctx.lineWidth = Math.max(1.5, R * w);
      ctx.beginPath();
      ctx.moveTo(-Math.cos(a) * len / 2, -Math.sin(a) * len / 2);
      ctx.lineTo(Math.cos(a) * len / 2, Math.sin(a) * len / 2);
      ctx.stroke();
    }
    ctx.fillStyle = C.screenText;
    ctx.font = `500 9px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', 0, -pr + 5);
    ctx.font = `500 8.5px ${MONO}`;
    if (rangeNm != null) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${Math.round(shownNm ?? rangeNm)} NM`, pr - 4, -3);
    }
    if (label) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, pr * 0.82);
    }
    ctx.restore();
  }

  function drawAircraft(R) {
    if (!planes.length) return;
    const pr = R * G.plot;
    const nm = shownNm ?? rangeNm ?? 1;
    // Положение в долях единичного круга при текущем (плавающем) масштабе.
    const aircraft = planes.map((a) => ({ x: a.xNm / nm, y: a.yNm / nm, track: a.track, call: a.call }));
    const size = Math.min(8, Math.max(5, R * 0.035));
    ctx.save();
    circle(R * G.rimInner);
    ctx.clip();
    ctx.font = `500 8.5px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // Подписи: от ближнего борта к дальнему, наложившиеся прячем (силуэт рисуем всегда).
    const charW = ctx.measureText('M').width;
    const shown = layoutLabels(
      aircraft.map((p) => ({ x: p.x * pr + size + 3, y: p.y * pr - size * 0.6, text: p.call || '' })),
      { charW, h: 10, pad: 2 },
    );
    for (const [i, p] of aircraft.entries()) {
      const x = p.x * pr, y = p.y * pr;
      const b = reduced ? REDUCED_BRIGHTNESS : blipBrightness(bearing(p.x, p.y), state.angle);
      const flash = Math.max(0, (b - 0.88) / 0.12); // короткий ореол сразу после спицы
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((p.track || 0) * Math.PI / 180);
      ctx.shadowColor = `rgba(${C.blip},0.9)`;
      ctx.shadowBlur = flash * 7 * scale;
      ctx.fillStyle = `rgba(${C.blip},${b})`;
      planePath(ctx, size);
      ctx.fill();
      ctx.restore();
      if (p.call && shown[i]) {
        ctx.fillStyle = `rgba(${C.blip},${0.2 + 0.7 * b})`;
        ctx.fillText(p.call, x + size + 3, y - size * 0.6);
      }
    }
    ctx.restore();
  }

  function spokeShape(R) {
    const r0 = R * G.spokeRoot, r1 = R * G.spokeTip;
    const w0 = R * G.spokeW0 / 2, w1 = R * G.spokeW1 / 2;
    // Прорезь внутри спицы: сквозь неё виден экран.
    const s0 = R * (G.hub + 0.035), s1 = R * (G.spokeTip - 0.09);
    const inset = R * 0.024;
    const sw0 = w0 + (w1 - w0) * (s0 - r0) / (r1 - r0) - inset;
    const sw1 = w0 + (w1 - w0) * (s1 - r0) / (r1 - r0) - inset;
    ctx.beginPath();
    ctx.moveTo(-w0, -r0); ctx.lineTo(-w1, -r1); ctx.lineTo(w1, -r1); ctx.lineTo(w0, -r0); ctx.closePath();
    ctx.moveTo(-sw0, -s0 - sw0);
    ctx.arc(0, -s0 - sw0, sw0, Math.PI, 0, true);
    ctx.lineTo(sw1, -s1 + sw1);
    ctx.arc(0, -s1 + sw1, sw1, 0, Math.PI, true);
    ctx.closePath();
  }

  function drawSpokes(R) {
    for (let k = 0; k < SPOKES; k++) {
      ctx.save();
      ctx.rotate(k * 2 * Math.PI / SPOKES);
      spokeShape(R);
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 4 * scale;
      ctx.shadowOffsetY = 1.5 * scale;
      ctx.fillStyle = C.spoke;
      ctx.fill('evenodd');
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.spokeEdge;
      ctx.stroke();
      ctx.restore();
    }
  }

  function rimGradient(R) {
    // Освещение обода неподвижно: компенсируем поворот холста.
    const a = -state.angle * Math.PI / 180;
    if (typeof ctx.createConicGradient === 'function') {
      const g = ctx.createConicGradient(a - Math.PI / 2, 0, 0);
      [[0, C.metalHi], [0.14, C.metalLo], [0.3, C.metalHi], [0.5, C.metalLo], [0.66, C.metalHi], [0.84, C.metalLo], [1, C.metalHi]]
        .forEach(([o, c]) => g.addColorStop(o, c));
      return g;
    }
    const dx = Math.sin(a) * R, dy = -Math.cos(a) * R;
    const g = ctx.createLinearGradient(dx, dy, -dx, -dy);
    g.addColorStop(0, C.metalHi);
    g.addColorStop(1, C.metalLo);
    return g;
  }

  function layoutGlyphs(R) {
    const size = Math.max(7, R * G.textSize);
    ctx.font = `500 ${size}px ${RIM_FONT}`;
    const rt = R * G.textBase, spacing = size * 0.14;
    const chars = [...RIM_TEXT];
    const spans = chars.map((ch) => (ctx.measureText(ch).width + spacing) / rt);
    let a = -spans.reduce((s, w) => s + w, 0) / 2 - REST_ANGLE * Math.PI / 180; // в покое — по центру сверху
    const list = chars.map((ch, i) => { const g = { ch, a: a + spans[i] / 2 }; a += spans[i]; return g; });
    glyphs = { size, list };
  }

  function drawRim(R) {
    const outer = R * G.rimOuter, ri = R * G.rimInner;
    ctx.beginPath();
    ctx.arc(0, 0, outer, 0, Math.PI * 2);
    ctx.arc(0, 0, ri, 0, Math.PI * 2, true);
    ctx.fillStyle = rimGradient(R);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 3 * scale;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.rimEdge;
    circle(ri); ctx.stroke();
    ctx.strokeStyle = C.seat;
    circle(outer); ctx.stroke();

    for (let i = 0; i < G.ticks; i++) {
      const long = i % 10 === 0;
      const a = i * 2 * Math.PI / G.ticks;
      const s = Math.sin(a), c = -Math.cos(a);
      const r0 = R * (long ? G.tickLong : G.tickShort), r1 = R * G.tickOut;
      ctx.strokeStyle = long ? C.tickLong : C.tick;
      ctx.lineWidth = long ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(s * r0, c * r0);
      ctx.lineTo(s * r1, c * r1);
      ctx.stroke();
    }

    if (!glyphs) layoutGlyphs(R);
    ctx.font = `500 ${glyphs.size}px ${RIM_FONT}`;
    ctx.fillStyle = C.rimInk;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const rt = R * G.textBase;
    for (const g of glyphs.list) {
      ctx.save();
      ctx.rotate(g.a);
      ctx.fillText(g.ch, 0, -rt);
      ctx.restore();
    }
  }

  function drawHub(R) {
    const hr = R * G.hub;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 5 * scale;
    ctx.shadowOffsetY = 1.5 * scale;
    circle(hr);
    ctx.fillStyle = C.hub;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.hubEdge;
    ctx.stroke();
    // Винты у корня спиц.
    for (let k = 0; k < SPOKES; k++) {
      const a = k * 2 * Math.PI / SPOKES;
      const x = Math.sin(a) * hr * 0.8, y = -Math.cos(a) * hr * 0.8;
      ctx.beginPath();
      ctx.arc(x, y, hr * 0.075, 0, Math.PI * 2);
      ctx.fillStyle = C.screw;
      ctx.fill();
      ctx.strokeStyle = C.hubEdge;
      ctx.stroke();
    }
    circle(hr * 0.58);
    ctx.fillStyle = C.hubRing;
    ctx.fill();
    ctx.strokeStyle = C.hubEdge;
    ctx.stroke();
    // Шпиндель в отверстии втулки с тремя шпоночными пазами.
    const sp = hr * 0.3;
    circle(sp);
    ctx.fillStyle = C.spindle;
    ctx.fill();
    for (let k = 0; k < SPOKES; k++) {
      ctx.save();
      ctx.rotate(k * 2 * Math.PI / SPOKES + Math.PI / 3);
      ctx.fillRect(-sp * 0.17, -sp * 1.28, sp * 0.34, sp * 0.4);
      ctx.restore();
    }
  }

  return {
    setPlaying(b) {
      playing = !!b;
      kick();
    },
    // list — отметки с x, y в долях радиуса при масштабе nm (NM на единичный круг).
    setAircraft(list, nm) {
      planes = Array.isArray(list) ? list.map((p) => ({ xNm: p.x * nm, yNm: p.y * nm, track: p.track, call: p.call })) : [];
      kick();
    },
    setLabel(text) {
      label = text || null;
      kick();
    },
    setRangeNm(nm) {
      rangeNm = Number.isFinite(nm) ? nm : null;
      if (rangeNm === null || shownNm === null || reduced) { shownNm = rangeNm; rangeAnim = null; }
      else if (shownNm !== rangeNm) rangeAnim = { from: shownNm, to: rangeNm, t0: null };
      kick();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      mq?.removeEventListener?.('change', onMotion);
      document.fonts?.removeEventListener?.('loadingdone', onFonts);
    },
  };
}
