// Математика катушки-радара: вращение, яркость отметок, проекция. DOM не трогает.
// Углы — в градусах от севера по часовой; экранная ось y направлена вниз (север вверху).
export const REEL_DEG_PER_SEC = 30; // оборот за 12 с
export const SPOKES = 3;

const MAX_DT = 0.1; // вкладка в фоне не даёт рывка
const EASE_PER_SEC = 1.5;
const SPOKE_GAP = 360 / SPOKES;
const MIN_BRIGHTNESS = 0.22;

const mod = (a, n) => ((a % n) + n) % n;

// Шаг вращения: скорость плавно стремится к 30°/с (играет) или к 0 (пауза).
export function stepReel({ angle, speed }, dtSec, playing) {
  const dt = Math.min(Math.max(dtSec, 0), MAX_DT);
  const target = playing ? REEL_DEG_PER_SEC : 0;
  const nextSpeed = speed + (target - speed) * Math.min(1, dt * EASE_PER_SEC);
  return { angle: mod(angle + nextSpeed * dt, 360), speed: nextSpeed };
}

// Яркость отметки: 1 в момент прохода спицы, линейно гаснет до 0.22 к следующей.
// Спица k смотрит на пеленг reelAngle + k·120°.
export function blipBrightness(bearingDeg, reelAngleDeg) {
  const delta = mod(reelAngleDeg - bearingDeg, SPOKE_GAP);
  return 1 - (1 - MIN_BRIGHTNESS) * delta / SPOKE_GAP;
}

// Плоская проекция вокруг (lat0, lon0) на радиус nm морских миль: единичный круг = радиус шкалы.
export function project(lat0, lon0, nm, lat, lon) {
  const x = (lon - lon0) * Math.cos(lat0 * Math.PI / 180) * 60 / nm;
  const y = -(lat - lat0) * 60 / nm;
  return { x, y, r: Math.hypot(x, y) };
}

export function bearing(x, y) {
  return mod(Math.atan2(x, -y) * 180 / Math.PI, 360);
}

// Какие подписи показывать. items — от ближнего к дальнему; (x, y) — левый край и середина по вертикали
// прямоугольника подписи (ширина = длина текста · charW, высота h). Подпись скрывается, если с запасом pad
// пересекает уже принятую.
export function layoutLabels(items, { charW, h, pad }) {
  const taken = [];
  return items.map(({ x, y, text }) => {
    const w = text.length * charW;
    const box = { l: x - pad, r: x + w + pad, t: y - h / 2 - pad, b: y + h / 2 + pad };
    const clash = taken.some((o) => box.l < o.r && o.l < box.r && box.t < o.b && o.t < box.b);
    if (!clash) taken.push(box);
    return !clash;
  });
}
