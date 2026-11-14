import { FEED_URL, REFRESH_MS, normalizeEarthquakes } from '../shared/usgs.js';
import { readBytes } from './read-bytes.js';
export { FEED_URL, REFRESH_MS, normalizeEarthquakes };
const MAX_BYTES = 8 * 1024 * 1024;

export function createUsgsService({ fetcher = fetch, now = Date.now } = {}) {
  let cache = null, pending = null, lastAttempt = -Infinity, failed = false;
  async function update() {
    lastAttempt = now();
    try {
      const response = await fetcher(FEED_URL, { signal: AbortSignal.timeout(18000), redirect: 'error', headers: { Accept: 'application/geo+json, application/json', 'User-Agent': 'THB-Mexico-Hazard-Monitor/1.0' } });
      const body = await readBytes(response, MAX_BYTES);
      cache = { ...normalizeEarthquakes(JSON.parse(body.toString('utf8'))), fetchedAt: new Date(now()).toISOString() };
      failed = false;
    } catch (error) { failed = true; if (!cache) throw error; }
  }
  return { async getEarthquakes() {
    if (!pending && now() - lastAttempt >= (failed ? 30000 : REFRESH_MS)) pending = update().finally(() => { pending = null; });
    if (pending) await pending;
    if (!cache) throw Error('USGS unavailable');
    return { ...cache, stale: failed || now() - Date.parse(cache.generatedAt) > 10 * 60000 };
  } };
}
