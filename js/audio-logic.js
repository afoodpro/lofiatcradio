export const LOFI_URL = 'https://lofi.stream.laut.fm/lofi';
export const IOS_LEVELS = { lofi: 0.5, atc: 1.0 };

const RETRY_DELAYS = [2000, 5000, 10000, 20000, 30000];

/** iPhone/iPad/iPod, including iPadOS that reports itself as a Mac. */
export function isIOS({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  return /iP(hone|ad|od)/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/** Reconnect delay in ms for the given attempt (0-based); capped at 30 s. */
export function retryDelay(attempt) {
  return RETRY_DELAYS[Math.min(Math.max(attempt, 0), RETRY_DELAYS.length - 1)];
}

/** True when the stream should be playing but has made no progress for timeoutMs. */
export function stallCheck({ playing, lastProgressAt, now, timeoutMs = 12000 }) {
  return Boolean(playing) && now - lastProgressAt > timeoutMs;
}

export function atcStatus({ failures }) {
  return failures >= 3 ? 'off' : 'live';
}

export function lampState({ playing, buffering, atc }) {
  if (!playing) return 'off';
  return buffering || atc === 'off' ? 'blink' : 'on';
}
