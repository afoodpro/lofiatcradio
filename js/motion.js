// «Уменьшение движения»: решение владельца — анимации работают всегда, пока флаг выключен.
// DOM при импорте не трогает.
export const RESPECT_REDUCED_MOTION = false;

export function reducedMotion() {
  if (!RESPECT_REDUCED_MOTION) return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
