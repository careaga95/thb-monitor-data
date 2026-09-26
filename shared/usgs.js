export const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
export const REFRESH_MS = 60000;
const iso = value => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;

export function normalizeEarthquakes(payload) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features) || !iso(payload.metadata?.generated)) throw Error('Invalid USGS feed');
  const earthquakes = payload.features.map(f => {
    if (f?.type !== 'Feature' || typeof f.properties?.type !== 'string') throw Error('Invalid USGS feature');
    return f;
  }).filter(f => f.properties.type === 'earthquake').map(f => {
    const p = f.properties, c = f.geometry?.coordinates;
    if (!/^[a-zA-Z0-9_-]+$/.test(f.id || '') || f.geometry?.type !== 'Point' || !Array.isArray(c) || !Number.isFinite(c[0]) || Math.abs(c[0]) > 180 || !Number.isFinite(c[1]) || Math.abs(c[1]) > 90 || !iso(p.time)) throw Error('Invalid earthquake');
    return { id: f.id, place: typeof p.place === 'string' ? p.place : 'Ubicación sin descripción',
      longitude: c[0], latitude: c[1], depthKm: Number.isFinite(c[2]) ? c[2] : null,
      magnitude: Number.isFinite(p.mag) ? p.mag : null, magnitudeType: typeof p.magType === 'string' ? p.magType : null,
      occurredAt: iso(p.time), updatedAt: iso(p.updated), status: p.status === 'reviewed' ? 'reviewed' : 'automatic',
      url: `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(f.id)}` };
  }).sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  return { earthquakes, generatedAt: iso(payload.metadata.generated) };
}

