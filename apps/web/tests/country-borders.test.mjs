import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/country-borders.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { countryBorders, borderContour } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const { features } = JSON.parse(readFileSync(new URL('../src/data/countries.geojson.json', import.meta.url), 'utf8'));
test('border extraction removes polar/date-line closures without mutating fill rings', () => {
 const feature = { geometry: { type: 'Polygon', coordinates: [[[180,-80],[180,-90],[-180,-90],[-180,-80],[-170,-75],[180,-80]]] } };
 const before = JSON.stringify(feature);
 assert.deepEqual(countryBorders([feature]), [[[-180,-80],[-170,-75],[180,-80]]]);
 assert.equal(JSON.stringify(feature), before);
});
test('country dataset retains closed geometry, Antarctica and valid lon/lat ordering', () => {
 assert(features.some(f => f.id === 'ATA'));
 assert.equal(new Set(features.map(f => f.id)).size, features.length);
 for (const f of features) {
  assert(['Polygon','MultiPolygon'].includes(f.geometry.type));
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const polygon of polygons) for (const ring of polygon) {
   assert(ring.length >= 4);
   assert.deepEqual(ring[0],ring.at(-1));
   for (const [lng,lat] of ring) { assert(Number.isFinite(lng) && Math.abs(lng)<=180); assert(Number.isFinite(lat) && Math.abs(lat)<=90); }
  }
 }
 const lines=countryBorders(features);
 assert(lines.length > features.length);
 assert(lines.every(line => line.length >= 2));
});

test('border contours follow spherical arcs and cross the dateline along the short route', () => {
 const arc = borderContour([[-30,60],[30,60]],1.5);
 assert(arc.length>2);
 assert(Math.max(...arc.map(p=>p[1]))>63);
 assert.deepEqual(arc[0],[-30,60]);
 assert.deepEqual(arc.at(-1),[30,60]);
 const seam = borderContour([[179,30],[-179,30]],0.5);
 assert(seam.every(([lng])=>Math.abs(lng)>=179));
 assert(seam.every(point=>point.every(Number.isFinite)));
});
