// Чистая логика табло: поля станции и путь перекидного флажка. DOM не трогает.
export const CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-';

const WIDTHS = { code: 4, city: 14, freq: 5, pos: 3 };

export function localTime(tz, date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

const pad = (s, n) => String(s ?? '').padEnd(n, ' ').slice(0, n);

export function boardFields(station, date) {
  return {
    code: pad(station.code, WIDTHS.code),
    city: pad(station.city, WIDTHS.city),
    time: localTime(station.tz, date),
    freq: pad(station.freq, WIDTHS.freq),
    pos: pad(station.pos, WIDTHS.pos),
  };
}

// Символы, через которые флажок идёт вперёд по CHARSET от `from` до `to` (без from, с to).
export function flipPath(from, to) {
  if (!CHARSET.includes(to)) to = ' ';
  let i = CHARSET.indexOf(from);
  if (i < 0) i = 0;
  const path = [];
  while (CHARSET[i] !== to) {
    i = (i + 1) % CHARSET.length;
    path.push(CHARSET[i]);
  }
  return path;
}
