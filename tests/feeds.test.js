import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { normalizeStorms, parseKmz } from '../server/noaa.js';
import { normalizeEarthquakes } from '../server/usgs.js';

const positionAt = '2026-09-20T15:00:00.000Z';
const advisoryAt = '2026-09-20T14:45:00.000Z';
const storm = {
  id: 'ep012026',
  name: 'Example',
  intensity: '40',
  movementSpeed: 9,
  latitudeNumeric: 11.1,
  longitudeNumeric: -125.5,
  lastUpdate: positionAt,
  publicAdvisory: { issuance: advisoryAt },
};
const feed = (overrides = {}) => ({ activeStorms: [{ ...storm, ...overrides }] });

test('NOAA converts the reported motion and wind from their respective units', () => {
  const [normalized] = normalizeStorms(feed());
  assert.equal(normalized.movementKmh, 14);
  assert.equal(normalized.windKmh, 74);
  assert.equal(normalized.advisoryAt, advisoryAt);
  assert.equal(normalized.positionAt, positionAt);
  assert.equal(normalizeStorms(feed({ publicAdvisory: undefined }))[0].advisoryAt, positionAt);
});

test('NOAA distinguishes absent values from valid zeroes', () => {
  for (const invalid of [false, true, '  ', [], {}]) {
    assert.throws(() => normalizeStorms(feed({ longitudeNumeric: invalid })), /Invalid storm record/);
    assert.equal(normalizeStorms(feed({ intensity: invalid }))[0].windKnots, null);
  }
  assert.equal(normalizeStorms(feed({ intensity: '0', longitudeNumeric: 0 }))[0].windKnots, 0);
});

const kmz = placemarks => zipSync({
  'doc.kml': strToU8(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemarks}</Document></kml>`),
});

test('forecast geometry excludes invalid placemarks and fails when none remain', () => {
  const invalid = '<Placemark><Point><coordinates>Infinity,190,0</coordinates></Point></Placemark>';
  const valid = '<Placemark><LineString><coordinates>-125,11,0 -126,12,0</coordinates></LineString></Placemark>';
  assert.throws(() => parseKmz(kmz(invalid)), /Empty forecast geometry/);
  const [feature] = parseKmz(kmz(invalid + valid)).features;
  assert.deepEqual(feature.geometry.coordinates, [[-125, 11, 0], [-126, 12, 0]]);
  assert.equal(parseKmz(kmz(invalid + valid)).features.length, 1);
});

test('USGS requires a valid event identifier', () => {
  const generated = Date.parse(positionAt);
  const earthquake = {
    type: 'Feature',
    id: 'us-example',
    geometry: { type: 'Point', coordinates: [-99, 19, 10] },
    properties: { type: 'earthquake', mag: 4.5, time: generated },
  };
  const collection = id => ({
    type: 'FeatureCollection',
    metadata: { generated },
    features: [{ ...earthquake, id }],
  });
  assert.equal(normalizeEarthquakes(collection(earthquake.id)).earthquakes[0].id, earthquake.id);
  for (const invalid of [123, ['us-example'], 'x'.repeat(81)]) {
    assert.throws(() => normalizeEarthquakes(collection(invalid)), /Invalid earthquake/);
  }
});
