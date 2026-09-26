import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSnapshot } from '../scripts/export-data.js';
const old = { storms:[{id:'ep012026'}],fetchedAt:'2026-09-20T12:00:00Z',stale:false };
const fail = async () => { throw Error('offline'); };
test('snapshot preserves last successful NOAA timestamp and layers during upstream outage', async () => {
  const {files,warnings}=await collectSnapshot({ noaa:{getStorms:fail},usgs:{getEarthquakes:async()=>({earthquakes:[]})},previous:async name=>name==='storms.json'?old:{id:'ep012026',track:{status:'ok',data:{type:'FeatureCollection',features:[]}}} });
  assert.equal(files['storms.json'].stale,true);assert.equal(files['storms.json'].fetchedAt,old.fetchedAt);
  assert.equal(files['storms/ep012026/layers.json'].track.status,'ok');assert.equal(files['storms/ep012026/layers.json'].stale,true);assert.equal(warnings.length,1);
});
test('first snapshot outage writes explicit unavailability, never an empty activity list', async () => {
  const {files}=await collectSnapshot({noaa:{getStorms:fail},usgs:{getEarthquakes:fail}});
  assert.equal(files['storms.json'].storms,undefined);assert.equal(files['earthquakes.json'].earthquakes,undefined);assert.ok(files['storms.json'].error);
});
test('snapshot keeps successful partial geometry and writes no layers for inactive storms', async () => {
  const layers={id:'ep012026',track:{status:'ok'},cone:{status:'error'}};
  const {files}=await collectSnapshot({noaa:{getStorms:async()=>old,getLayers:async()=>layers},usgs:{getEarthquakes:async()=>({earthquakes:[]})}});
  assert.deepEqual(files['storms/ep012026/layers.json'],layers);assert.equal(Object.keys(files).length,3);
});
