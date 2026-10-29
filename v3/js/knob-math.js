// Математика ручек (без DOM): деления, угол, жест перетаскивания, таймер сна.
export const ANGLE_MIN = -135;
export const ANGLE_MAX = 135;
const ANGLE_SPAN = ANGLE_MAX - ANGLE_MIN; // 270°
const DRAG_PX = 160;       // 160 px вверх = полный ход
const ANGLE_DEAD_ZONE = 12; // градусов: меньший поворот по кругу не считается

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function snap(v, steps) { return clamp01(Math.round(clamp01(v) * steps) / steps); }

export function valueToAngle(v, steps) { return ANGLE_MIN + ANGLE_SPAN * snap(v, steps); }

// dyPx: смещение указателя по Y от старта (вниз положительно); dAngleDeg: поворот вокруг центра ручки (по часовой положительно).
export function dragValue(startV, dyPx, dAngleDeg) {
  const byDy = -dyPx / DRAG_PX;
  const byAngle = Math.abs(dAngleDeg) > ANGLE_DEAD_ZONE ? dAngleDeg / ANGLE_SPAN : 0;
  return clamp01(startV + (Math.abs(byAngle) > Math.abs(byDy) ? byAngle : byDy));
}

export const SLEEP_MINUTES = [0, 30, 60, 90];

export function sleepIndexToMinutes(i) {
  return SLEEP_MINUTES[Math.min(SLEEP_MINUTES.length - 1, Math.max(0, Math.round(i)))];
}

export function sleepDeadline(nowMs, minutes) { return minutes > 0 ? nowMs + minutes * 60000 : null; }
