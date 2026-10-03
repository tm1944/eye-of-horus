import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Compile this pure module in memory so tests also work on Node 20.9+.
const source = readFileSync(new URL('../src/lib/layers.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { LAYER_IDS, defaultLayers, parseFilters, writeFilters, deriveVisuals } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const events = JSON.parse(readFileSync(new URL('../../../data/fixtures/events.json', import.meta.url), 'utf8'));
test('all eight layers persist, with the three weekend defaults', () => {
 const layers = defaultLayers();
 assert.equal(Object.keys(layers).length, 8);
 assert.deepEqual(LAYER_IDS.filter(id => layers[id].enabled), ['earthquake','wildfire','humanitarian']);
 assert(LAYER_IDS.every(id => layers[id].mode === 'markers' && layers[id].weightField === 'weight'));
});
test('empty layers means none; malformed URL values are safe', () => {
 assert(LAYER_IDS.every(id => !parseFilters('?layers=').layers[id].enabled));
 assert.equal(parseFilters('?t=broken&modes=news:nope&weights=finance:rawRef').time, null);
 assert.equal(parseFilters('?t=2026-10-03T10:00:00Z,2026-10-03T09:00:00Z').time, null);
});
test('URL round-trip preserves filters and unrelated query parameters', () => {
 const filters = parseFilters('?layers=news,wildfire&modes=wildfire:both&weights=wildfire:significance&t=2026-10-03T00:00:00Z,2026-10-04T00:00:00Z');
 const query = writeFilters('?demo=judge&weights=wildfire:significance', filters);
 assert.equal(filters.layers.wildfire.weightField, 'weight');
 assert.equal(new URLSearchParams(query).has('weights'), false);
 assert.equal(new URLSearchParams(query).get('demo'), 'judge');
 assert.deepEqual(parseFilters(query), filters);
});
test('start is inclusive, end exclusive, marker/heatmap modes agree', () => {
 const row = events[0];
 const filters = parseFilters(`?layers=earthquake&modes=earthquake:both&t=${row.occurredAt},2026-10-03T12:04:12Z`);
 const result = deriveVisuals(events, filters);
 assert.deepEqual(result.markers.map(e=>e.id), [row.id]);
 assert.equal(result.heatmaps.find(h=>h.id==='earthquake').points.length, 1);
 filters.time = { startIso:'2026-10-03T00:00:00Z',endIso:row.occurredAt };
 assert(!deriveVisuals([row], filters).visible.length);
});
test('disabled layers clear both visuals without mutating source data', () => {
 const before = JSON.stringify(events);
 const filters = parseFilters('?layers=wildfire&modes=wildfire:heatmap&weights=wildfire:significance');
 let result = deriveVisuals(events,filters);
 assert.equal(result.markers.length,0);
 assert.equal(result.heatmaps.find(h=>h.id==='wildfire').points[0].weight,events.find(e=>e.layerId==='wildfire').weight);
 filters.layers.wildfire.enabled=false;
 result=deriveVisuals(events,filters);
 assert.equal(result.heatmaps.length,8);
 assert(result.heatmaps.every(h=>h.points.length===0));
 assert.equal(JSON.stringify(events),before);
});
test('non-density POIs remain markers even with legacy heatmap URLs or config', () => {
 const filters = parseFilters('?layers=news,humanitarian&modes=news:heatmap,humanitarian:both');
 assert.equal(filters.layers.news.mode, 'markers');
 assert.equal(filters.layers.humanitarian.mode, 'markers');
 assert.equal(new URLSearchParams(writeFilters('', filters)).has('modes'), false);
 // Defend against invalid runtime state as well as URL input.
 filters.layers.news.mode = 'heatmap';
 const result = deriveVisuals(events, filters);
 assert.deepEqual(result.markers, result.visible);
 assert(result.heatmaps.every(layer => layer.points.length === 0));
});
