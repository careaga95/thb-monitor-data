import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNoaaService } from '../server/noaa.js';
import { createUsgsService } from '../server/usgs.js';

const layerKinds = ['track', 'cone'];

function canReuseLayer(product, cached, staleFeed) {
  if (cached?.status !== 'ok' || cached.data?.type !== 'FeatureCollection' ||
      !Array.isArray(cached.data.features)) return false;
  // Legacy snapshots can lack product metadata in both files.
  if (staleFeed && !product && cached.issuedAt == null) return true;
  if (typeof product?.issuedAt !== 'string' || typeof cached.issuedAt !== 'string') return false;
  const issuedAt = Date.parse(product.issuedAt);
  return Number.isFinite(issuedAt) && issuedAt === Date.parse(cached.issuedAt);
}

export async function collectSnapshot({ noaa = createNoaaService(), usgs = createUsgsService(), previous = async () => null } = {}) {
  const files = {}, warnings = [];
  async function feed(name, get) {
    try { files[`${name}.json`] = await get(); }
    catch {
      warnings.push(`${name}: upstream unavailable`);
      const old = await previous(`${name}.json`);
      files[`${name}.json`] = Array.isArray(old?.[name]) && Number.isFinite(Date.parse(old.fetchedAt))
        ? { ...old, stale: true } : { error: `${name} unavailable`, stale: true };
    }
    return files[`${name}.json`];
  }
  const [storms] = await Promise.all([feed('storms', () => noaa.getStorms()), feed('earthquakes', () => usgs.getEarthquakes())]);
  await Promise.all((storms.storms || []).map(async storm => {
    if (!/^(al|ep)\d{6}$/.test(storm.id)) return;
    const name = `storms/${storm.id}/layers.json`;
    let layers = null;
    if (!storms.stale) {
      try { layers = await noaa.getLayers(storm.id); }
      catch { /* Try the preceding snapshot for the same products. */ }
    }
    if (layers?.id !== storm.id) layers = null;
    const missing = layerKinds.filter(kind => !layers?.[kind] || layers[kind].status === 'error');
    if (!missing.length) {
      files[name] = layers;
      return;
    }

    const old = await previous(name);
    const result = layers ? { ...layers } : { id: storm.id, stale: true };
    for (const kind of missing) {
      const cached = old?.id === storm.id ? old[kind] : null;
      if (canReuseLayer(storm[kind], cached, storms.stale)) result[kind] = cached;
      else result[kind] ??= { status: 'error' };
    }
    files[name] = result;
  }));
  return { files, warnings };
}

async function main() {
  const base = process.env.PREVIOUS_DATA_URL;
  const previous = async name => {
    if (!base) return null;
    try {
      const response = await fetch(`${base.replace(/\/$/,'')}/${name}`, { signal:AbortSignal.timeout(10000), cache:'no-store' });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  };
  const { files, warnings } = await collectSnapshot({ previous });
  const output = resolve(process.env.SNAPSHOT_DIR || 'dist/api');
  for (const [name,data] of Object.entries(files)) {
    const file = resolve(output,name); await mkdir(dirname(file), { recursive:true }); await writeFile(file, JSON.stringify(data));
  }
  for (const warning of warnings) console.warn(warning);
  console.log(`Exported ${Object.keys(files).length} data files.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
