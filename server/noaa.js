import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { kml } from '@tmcw/togeojson';
import { readBytes } from './read-bytes.js';

export const FEED_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
export const REFRESH_MS = 5 * 60 * 1000;
const MAX_BYTES = 12 * 1024 * 1024;
function number(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function noaaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['www.nhc.noaa.gov', 'www.hurricanes.gov'].includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

export function normalizeStorms(payload) {
  if (!payload || !Array.isArray(payload.activeStorms)) throw new Error('Invalid NOAA feed');
  if (payload.activeStorms.some(s => !s || typeof s.id !== 'string' || !/^(al|ep|cp)\d{6}$/i.test(s.id))) throw new Error('Invalid storm identity');
  return payload.activeStorms.filter(s => /^(al|ep)\d{6}$/i.test(s.id)).map(s => {
    const lat = number(s.latitudeNumeric), lon = number(s.longitudeNumeric);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 ||
      typeof s.name !== 'string' || !s.name.trim() ||
      typeof s.lastUpdate !== 'string' || !Number.isFinite(Date.parse(s.lastUpdate))) {
      throw new Error('Invalid storm record');
    }
    const wind = number(s.intensity), speed = number(s.movementSpeed);
    const advisoryAt = [s.publicAdvisory?.issuance, s.forecastAdvisory?.issuance, s.lastUpdate]
      .find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
    return {
      id: s.id.toLowerCase(), name: String(s.name), basin: s.id.toLowerCase().startsWith('al') ? 'atlantic' : 'pacific',
      classification: String(s.classification || ''), latitude: lat, longitude: lon,
      windKmh: wind === null ? null : Math.round(wind * 1.852), windKnots: wind,
      pressure: number(s.pressure), movementKmh: speed === null ? null : Math.round(speed * 1.609344), movementDirection: number(s.movementDir),
      positionAt: s.lastUpdate, advisoryAt, advisoryNumber: s.publicAdvisory?.advNum || null,
      advisoryUrl: noaaUrl(s.publicAdvisory?.url) || noaaUrl(s.forecastAdvisory?.url) || 'https://www.nhc.noaa.gov/',
      track: { url: noaaUrl(s.forecastTrack?.kmzFile), issuedAt: s.forecastTrack?.issuance || null },
      cone: { url: noaaUrl(s.trackCone?.kmzFile), issuedAt: s.trackCone?.issuance || null },
    };
  });
}

// Keep only typed facts from NOAA's KML description, never upstream markup.
export function forecastFacts(description) {
  const text = String((typeof description === 'object' ? description?.value : description) || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  const match = text.match(/Valid at:\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s+(GMT|UTC|AST|EST|EDT|CST|CDT|MST|MDT|PST|PDT|HST|AKST|AKDT)\s+(\w+)\s+(\d{1,2}),\s*(\d{4})/i);
  if (!match) return {};
  const [, hour, minute, meridiem, zone, month, day, year] = match;
  const offsets={GMT:0,UTC:0,AST:-4,EST:-5,EDT:-4,CST:-6,CDT:-5,MST:-7,MDT:-6,PST:-8,PDT:-7,HST:-10,AKST:-9,AKDT:-8};
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const m = months.indexOf(month.toLowerCase());
  if (m < 0 || +hour < 1 || +hour > 12 || +minute > 59 || +day < 1 || +day > 31) return {};
  const localDate = new Date(Date.UTC(+year,m,+day,(+hour%12)+(meridiem.toUpperCase()==='PM'?12:0),+minute));
  if (localDate.getUTCMonth() !== m) return {};
  const date=new Date(localDate.getTime()-offsets[zone.toUpperCase()]*3600000);
  const forecast = text.match(/(\d+)\s*hr Forecast/i);
  const observed = /Advisory Information/i.test(text);
  if (!forecast && !observed) return {};
  const hours = forecast ? +forecast[1] : 0;
  if (hours > 168) return {};
  const wind = text.match(/Maximum Wind:\s*(\d+)\s*knots/i);
  return {validAt:date.toISOString(),forecastHours:hours,positionType:forecast?'forecast':'reported',...(wind?{windKmh:Math.round(+wind[1]*1.852),windKnots:+wind[1]}:{})};
}

// NHC draws each forecast point with a lettered symbol: D depression, S storm, H hurricane,
// M major hurricane, L remnant low; the "x" variants mark a post-tropical system.
export function symbolFacts(styleUrl) {
  const point = String(styleUrl || '').match(/^#(x?)([dshml])_point$/i);
  if (point) return {stormType:point[2].toUpperCase(),postTropical:Boolean(point[1])};
  const line = String(styleUrl || '').match(/^#(\d{1,3})_line$/);
  return line ? {trackHours:+line[1]} : {};
}

function validPosition(position) {
  return Array.isArray(position) && position.length >= 2 && position.every(Number.isFinite) &&
    Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90;
}

function validLine(line) {
  return Array.isArray(line) && line.length >= 2 && line.every(validPosition);
}

function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.every(validPosition) &&
    ring[0].length === ring.at(-1).length && ring[0].every((value, index) => value === ring.at(-1)[index]);
}

function nonEmptyArray(items, valid) {
  return Array.isArray(items) && items.length > 0 && items.every(valid);
}

function validGeometry(geometry) {
  switch (geometry?.type) {
    case 'Point': return validPosition(geometry.coordinates);
    case 'MultiPoint': return nonEmptyArray(geometry.coordinates, validPosition);
    case 'LineString': return validLine(geometry.coordinates);
    case 'MultiLineString': return nonEmptyArray(geometry.coordinates, validLine);
    case 'Polygon': return nonEmptyArray(geometry.coordinates, validRing);
    case 'MultiPolygon': return nonEmptyArray(geometry.coordinates, rings => nonEmptyArray(rings, validRing));
    case 'GeometryCollection': return nonEmptyArray(geometry.geometries, validGeometry);
    default: return false;
  }
}

export function parseKmz(buffer) {
  let selected = false;
  const archive = unzipSync(new Uint8Array(buffer), {
    filter: entry => {
      if (selected || !/\.kml$/i.test(entry.name) || entry.originalSize > MAX_BYTES) return false;
      selected = true;
      return true;
    },
  });
  const entry = Object.entries(archive).find(([name]) => /\.kml$/i.test(name));
  if (!entry) throw new Error('KML missing');
  const xml = strFromU8(entry[1]);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unexpected XML declaration');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const collection = kml(doc);
  // Never send or render upstream HTML descriptions/styles.
  collection.features = collection.features.filter(f => validGeometry(f.geometry)).map(f => {
    const symbol = symbolFacts(f.properties?.styleUrl);
    const facts = f.geometry.type === 'Point' ? forecastFacts(f.properties?.description) : {};
    const typed = f.geometry.type === 'Point' ? (facts.positionType === 'forecast' && symbol.stormType ? {stormType:symbol.stormType,postTropical:symbol.postTropical} : {}) : (symbol.trackHours ? {trackHours:symbol.trackHours} : {});
    return { type: 'Feature', geometry: f.geometry, properties: { name: String(f.properties?.name || ''), ...facts, ...typed } };
  });
  if (!collection.features.length) throw new Error('Empty forecast geometry');
  return collection;
}

// `layerStore` ({get, put} by KMZ URL) lets other instances reuse a parsed product. NHC names each
// KMZ after its advisory, so a URL always holds the same geometry; the Worker backs it with its edge cache.
export function createNoaaService({ fetcher = fetch, now = Date.now, layerStore = null } = {}) {
  let cachedFeed = null, pendingFeed = null, lastAttempt = 0;
  const layerCache = new Map(), pendingLayers = new Map();

  async function download(url, format) {
    if (!noaaUrl(url)) throw new Error('Unapproved upstream');
    const response = await fetcher(url, {
      headers: { 'User-Agent': 'THB-Mexico-Storm-Monitor/1.0 (https://thbmexico.com)', Accept: format === 'json' ? 'application/json' : 'application/vnd.google-earth.kmz' },
      signal: AbortSignal.timeout(18000), redirect: 'error',
    });
    const buffer = await readBytes(response, MAX_BYTES);
    return format === 'json' ? JSON.parse(buffer.toString()) : buffer;
  }

  async function getStorms() {
    if (cachedFeed && now() - Date.parse(cachedFeed.fetchedAt) < REFRESH_MS) return { ...cachedFeed, stale: false };
    if (pendingFeed) return pendingFeed;
    // Avoid hammering an unavailable upstream from many page requests.
    if (lastAttempt && now() - lastAttempt < 30000) {
      if (cachedFeed) return { ...cachedFeed, stale: true };
      throw new Error('NOAA temporarily unavailable');
    }
    lastAttempt = now();
    pendingFeed = (async () => {
      try {
        const storms = normalizeStorms(await download(FEED_URL, 'json'));
        cachedFeed = { storms, fetchedAt: new Date(now()).toISOString(), source: FEED_URL };
        return { ...cachedFeed, stale: false };
      } catch (err) {
        if (cachedFeed) return { ...cachedFeed, stale: true };
        throw err;
      } finally { pendingFeed = null; }
    })();
    return pendingFeed;
  }

  async function getGeometry(url) {
    if (layerCache.has(url)) return layerCache.get(url);
    if (pendingLayers.has(url)) return pendingLayers.get(url);
    const promise = (async () => {
      // A failing store only costs a download: it never hides a product NOAA can still serve.
      const stored = await Promise.resolve().then(() => layerStore?.get(url)).catch(() => null);
      const data = stored || parseKmz(await download(url, 'buffer'));
      if (!stored) await Promise.resolve().then(() => layerStore?.put(url, data)).catch(() => {});
      if (layerCache.size >= 100) layerCache.delete(layerCache.keys().next().value);
      layerCache.set(url, data); return data;
    })().finally(() => pendingLayers.delete(url));
    pendingLayers.set(url, promise);
    return promise;
  }

  async function getLayers(id) {
    const feed = await getStorms();
    const storm = feed.storms.find(s => s.id === id);
    if (!storm) return null;
    const entries = await Promise.all(['track', 'cone'].map(async kind => {
      const ref = storm[kind];
      if (!ref.url) return [kind, { status: 'unavailable', data: null, issuedAt: ref.issuedAt }];
      try { return [kind, { status: 'ok', data: await getGeometry(ref.url), issuedAt: ref.issuedAt }]; }
      catch { return [kind, { status: 'error', data: null, issuedAt: ref.issuedAt }]; }
    }));
    return { id, stale: feed.stale, ...Object.fromEntries(entries) };
  }
  return { getStorms, getLayers };
}
