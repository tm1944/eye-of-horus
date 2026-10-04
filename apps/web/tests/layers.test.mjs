import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Compile this pure module in memory so tests also work on Node 20.9+.
const source = readFileSync(new URL('../src/lib/layers.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { LAYER_IDS, defaultLayers, parseFilters, writeFilters, deriveVisuals } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const events = JSON.parse(readFileSync(new URL('../../../data/fixtures/events.json', import.meta.url), 'utf8'));
test('all nine layers persist, with four societal product defaults', () => {
 const layers = defaultLayers();
 assert.equal(Object.keys(layers).length, 9);
 assert.deepEqual(LAYER_IDS.filter(id => layers[id].enabled), ['technology','politics','finance','humanitarian']);
 assert(LAYER_IDS.every(id => layers[id].mode === (['earthquake','wildfire'].includes(id) ? 'both' : 'markers') && layers[id].weightField === 'weight'));
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
 assert.equal(result.heatmaps.length,9);
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
 assert.deepEqual(result.markers.map(e => e.id).sort(), result.visible.filter(e => e.significance >= filters.minSignificance).map(e => e.id).sort());
 assert(result.heatmaps.every(layer => layer.points.length === 0));
});

test('one heatmap with preferred focus and fallback; low scores stay in density', () => {
 const filters = parseFilters('?layers=earthquake,wildfire');
 let result = deriveVisuals(events, filters);
 assert.equal(result.activeHeatmapId, 'wildfire');
 assert.equal(result.heatmaps.filter(h => h.points.length).length, 1);
 assert.equal(result.heatmaps.find(h => h.id === 'wildfire').points.length, events.filter(e => e.layerId === 'wildfire').length);
 assert(result.markers.every(e => e.significance >= 50));
 filters.heatmapLayer = 'earthquake';
 assert.equal(deriveVisuals(events, filters).activeHeatmapId, 'earthquake');
 filters.layers.earthquake.enabled = false;
 assert.equal(deriveVisuals(events, filters).activeHeatmapId, 'wildfire');
 filters.layers.wildfire.mode = 'markers';
 result = deriveVisuals(events, filters);
 assert.equal(result.activeHeatmapId, null);
 assert(result.heatmaps.every(h => !h.points.length));
});
test('marker cap keeps highest significance without mutating or capping heatmap input', () => {
 const rows = Array.from({length: 6000}, (_, i) => ({...events[1], id:`stress:${i}`, significance:i}));
 const before = rows.map(e => e.id);
 const filters = parseFilters('?layers=wildfire&minSignificance=100');
 const result = deriveVisuals(rows, filters);
 assert.equal(result.markerCandidateCount, 5900);
 assert.equal(result.markers.length, 5000);
 assert.equal(result.markers[0].significance, 5999);
 assert.equal(result.markers.at(-1).significance, 1000);
 assert.equal(result.heatmaps.find(h => h.id === 'wildfire').points.length, 6000);
 assert.deepEqual(rows.map(e => e.id), before);
});
test('marker threshold validates URLs and includes its boundary; modes round-trip', () => {
 for (const raw of ['', '-1', 'Infinity', 'oops']) assert.equal(parseFilters(`?minSignificance=${raw}`).minSignificance, 50);
 const filters = parseFilters('?layers=wildfire&minSignificance=55&modes=wildfire:markers&heatmap=earthquake');
 assert.deepEqual(parseFilters(writeFilters('', filters)), filters);
 assert(deriveVisuals(events, filters).markers.some(e => e.significance === 55));
 assert.equal(parseFilters('?minSignificance=0').minSignificance, 0);
 assert.equal(deriveVisuals([], filters).activeHeatmapId, null);
});

test('default product view covers tech, government, finance and society with no heatmap', () => {
 const filters = parseFilters('');
 const result = deriveVisuals(events, filters);
 assert.equal(result.activeHeatmapId, null);
 assert.deepEqual([...new Set(result.markers.map(e => e.layerId))].sort(), ['finance','humanitarian','politics','technology']);
 const technology = parseFilters('?layers=technology&modes=technology:heatmap');
 assert.equal(technology.layers.technology.mode, 'markers');
 assert.deepEqual(parseFilters(writeFilters('', technology)), technology);
 assert(deriveVisuals(events, technology).markers.length > 0);
 const schema = JSON.parse(readFileSync(new URL('../../../packages/schema/event.schema.json', import.meta.url), 'utf8'));
 assert.deepEqual([...schema.properties.layerId.enum].sort(), [...LAYER_IDS].sort());
});
