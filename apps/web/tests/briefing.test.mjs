import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/briefing.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { tourOrder, rankOf, vitalSigns, placeLabel, chips, locatorPaths, impactLabel, satelliteImage } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const ev = (over = {}) => ({ id: 'e', source: 'gnews', layerId: 'news', significance: 50, lat: 0, lng: 0, attributes: {}, keywords: [], entities: [], ...over });

test('the tour sweeps north to south, then west to east', () => {
 const rows = [ev({ id: 'south', lat: -30 }), ev({ id: 'east', lat: 10, lng: 100 }), ev({ id: 'north', lat: 60 }), ev({ id: 'west', lat: 10, lng: -80 })];
 assert.deepEqual(tourOrder(rows).map(r => r.id), ['north', 'west', 'east', 'south']);
 assert.equal(rows[0].id, 'south', 'input untouched');
});

test('rank is by significance among the headlines', () => {
 const rows = [ev({ id: 'a', significance: 40 }), ev({ id: 'b', significance: 90 }), ev({ id: 'c', significance: 60 })];
 assert.equal(rankOf('b', rows), 1);
 assert.equal(rankOf('a', rows), 3);
 assert.equal(rankOf('missing', rows), 0);
});

test('vital signs pick the telling figures per event type and skip what is missing', () => {
 const quake = ev({ source: 'usgs', layerId: 'earthquake', attributes: { magnitude: 5.9, mag_type: 'mww', depth_km: 24.4, alert: 'yellow', tsunami: true, felt: 1200 } });
 assert.deepEqual(vitalSigns(quake), [
  { value: 'M 5.9', label: 'magnitude (mww)' }, { value: '24 km', label: 'depth' }, { value: 'Possible', label: 'tsunami', tone: 'orange' }]);
 assert.deepEqual(vitalSigns(ev({ source: 'gdacs', layerId: 'cyclone', attributes: { max_wind_kmh: 212.96, alert_level: 'Orange' } })),
  [{ value: '213 km/h', label: 'max wind' }, { value: 'Orange', label: 'alert', tone: 'orange' }]);
 assert.deepEqual(vitalSigns(ev({ source: 'firms', layerId: 'wildfire', attributes: { max_frp: 46.2, hotspot_count: 1, daynight: 'N' } })),
  [{ value: '46 MW', label: 'peak fire power' }, { value: '1', label: 'hotspot' }, { value: 'Night', label: 'detected' }]);
 assert.deepEqual(vitalSigns(ev({ source: 'conflict_csv', layerId: 'protest', attributes: { actor1: 'POLICE', actor2: 'PROTESTER', location: 'India' } })),
  [{ value: 'Police', label: 'side A' }, { value: 'Protester', label: 'side B' }, { value: 'India', label: 'location' }]);
 assert.deepEqual(vitalSigns(ev()), [], 'news has no figures');
 assert.deepEqual(vitalSigns(ev({ layerId: 'earthquake', attributes: { magnitude: 'n/a', alert: 'purple' } })), []);
 assert.equal(impactLabel({ impact_class: 'High', people_exposed: 12000, radius_km: 25 }),
  'High impact · 12,000 people within 25 km · JRC GHSL');
 assert.equal(impactLabel({}), null);
 assert.equal(impactLabel(null), null);
});

test('satellite images frame the hazard on the right day with fires overlaid on wildfires', () => {
 const now = new Date('2026-10-04T17:00:00Z');
 const fire = satelliteImage(ev({ layerId: 'wildfire', lat: 0, lng: 10, occurredAt: '2026-10-04T03:00:00Z' }), now);
 const url = new URL(fire.src);
 assert.equal(url.origin + url.pathname, 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi');
 assert.equal(url.searchParams.get('LAYERS'), 'VIIRS_SNPP_CorrectedReflectance_TrueColor,VIIRS_NOAA20_CorrectedReflectance_TrueColor,VIIRS_SNPP_Thermal_Anomalies_375m_All,VIIRS_NOAA20_Thermal_Anomalies_375m_All');
 assert.equal(fire.fires, true);
 assert.equal(url.searchParams.get('TIME'), '2026-10-03', 'same-day events use yesterday');
 const [west, south, east, north] = url.searchParams.get('BBOX').split(',').map(Number);
 assert.ok(Math.abs(north - 0.3378) < 1e-3 && Math.abs(south + 0.3378) < 1e-3, 'wildfire box spans 37.5 km each way');
 assert.ok(Math.abs(east - 10.3378) < 1e-3 && Math.abs(west - 9.6622) < 1e-3);
 assert.equal(fire.date, '2026-10-03');
 const quake = satelliteImage(ev({ layerId: 'earthquake', lat: 40, lng: 20, occurredAt: '2026-10-01T12:00:00Z' }), now);
 assert.deepEqual(quake.layers, ['VIIRS_SNPP_CorrectedReflectance_TrueColor', 'VIIRS_NOAA20_CorrectedReflectance_TrueColor']);
 assert.equal(quake.fires, false);
 assert.equal(quake.date, '2026-10-01');
 assert.equal(satelliteImage(ev({ occurredAt: '2026-10-01T12:00:00Z' }), now), null, 'news has no satellite view');
});

test('place labels and chips come from the data, deduplicated and grouped', () => {
 assert.equal(placeLabel(ev({ attributes: { place: '21 km NE of Lae' } })), '21 km NE of Lae');
 assert.equal(placeLabel(ev({ keywords: [{ text: 'Topic', type: 'topic' }, { text: 'Lisbon', type: 'location' }] })), 'Lisbon');
 assert.equal(placeLabel(ev()), null);
 const story = ev({
  keywords: [{ text: 'Lisbon', type: 'location', relevance: .9 }, { text: 'housing', type: 'topic', relevance: .95 }, { text: 'Ana Costa', type: 'person', relevance: .7 },
   { text: 'Porto', type: 'location', relevance: .8 }, { text: 'HOUSING', type: 'concept', relevance: .5 }],
  entities: [{ text: 'POLICE', type: 'actor', confidence: 1 }],
 });
 assert.deepEqual(chips(story), [
  { text: 'Ana Costa', kind: 'person' }, { text: 'Police', kind: 'actor' }, { text: 'Porto', kind: 'place' }, { text: 'housing', kind: 'topic' }]);
 assert.equal(chips(story, 2).length, 2);
});

test('the locator draws near-side land filled and horizon-crossing coasts as lines', () => {
 const square = (lng, lat, d) => [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]];
 const near = locatorPaths([square(0, 0, 5)], 0, 0, 50);
 assert.match(near.fill, /^M-4\.3 4\.4/, 'x = r·cos5°·sin(−5°) ≈ −4.34; y = −r·sin(−5°) ≈ 4.36');
 assert.equal(near.line, '');
 assert.deepEqual(locatorPaths([square(180, 0, 5)], 0, 0, 50), { fill: '', line: '' }, 'far side is hidden');
 const edge = locatorPaths([square(90, 0, 5)], 0, 0, 50);
 assert.equal(edge.fill, '');
 assert.notEqual(edge.line, '');
});
