export const RELAY = 'https://s1-bos.liveatc.net';
export const DEFAULT_CODE = 'KJFK';

/**
 * Fetch and parse stations.json relative to this module.
 * @param {typeof fetch} fetchFn
 * @returns {Promise<Object[]>} Array of station objects
 */
export async function loadStations(fetchFn = fetch) {
  const url = new URL('../stations.json', import.meta.url);
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`stations.json: HTTP ${response.status}`);
  return response.json();
}

/**
 * Find a station by code.
 * @param {Object[]} list - Array of stations
 * @param {string} code - Station code (e.g., 'KJFK')
 * @returns {Object | undefined} Station object or undefined
 */
export function findStation(list, code) {
  return list.find(s => s.code === code);
}

/**
 * Get next or previous station (wraps around).
 * @param {Object[]} list - Array of stations
 * @param {string} code - Current station code
 * @param {1 | -1} dir - Direction: 1 for next, -1 for previous
 * @returns {Object} Station object
 */
export function stepStation(list, code, dir) {
  const index = list.findIndex(s => s.code === code);
  if (index === -1) {
    throw new Error(`Station ${code} not found`);
  }
  const nextIndex = (index + dir + list.length) % list.length;
  return list[nextIndex];
}

/**
 * Get ATC stream URL for a station.
 * @param {Object} station - Station object
 * @param {number} nowMs - Current time in milliseconds
 * @returns {string} URL to ATC stream
 */
export function atcUrl(station, nowMs) {
  return `${RELAY}/${station.mount}?nocache=${nowMs}`;
}
