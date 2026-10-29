// Состояние плеера в localStorage: станция и две громкости. DOM не трогает.
// Любые сбои хранилища (приватный режим, запрет cookie) и битые значения → умолчания.
export const DEFAULTS = Object.freeze({ station: 'KJFK', lofi: 0.35, atc: 0.75 });
const KEY = 'lofiatc_v3';

const isLevel = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export function loadState(storage, search, codes) {
  let saved = null;
  try {
    const raw = storage?.getItem(KEY);
    if (raw) saved = JSON.parse(raw);
  } catch { saved = null; }
  if (!saved || typeof saved !== 'object') saved = {};

  let station = codes.includes(saved.station) ? saved.station : DEFAULTS.station;
  try {
    const wanted = new URLSearchParams(search || '').get('station');
    if (wanted && codes.includes(wanted.toUpperCase())) station = wanted.toUpperCase();
  } catch { /* кривой query — игнорируем */ }

  return {
    station,
    lofi: isLevel(saved.lofi) ? saved.lofi : DEFAULTS.lofi,
    atc: isLevel(saved.atc) ? saved.atc : DEFAULTS.atc,
  };
}

export function saveState(storage, state) {
  try {
    storage?.setItem(KEY, JSON.stringify({ station: state.station, lofi: state.lofi, atc: state.atc }));
  } catch { /* хранилище недоступно — живём без памяти */ }
}
