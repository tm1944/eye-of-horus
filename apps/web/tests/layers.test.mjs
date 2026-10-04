import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Compile this pure module in memory so tests also work on Node 20.9+.
const source = readFileSync(new URL('../src/lib/layers.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { CATEGORIES, LAYER_IDS, defaultLayers, parseFilters, writeFilters, deriveVisuals, categoryState, setCategoryEnabled, setLayerEnabled } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const events = JSON.parse(readFileSync(new URL('../../../data/fixtures/events.json', import.meta.url), 'utf8'));
test('all 30 layers persist, with four societal product defaults', () => {
 const layers = defaultLayers();
 assert.equal(Object.keys(layers).length, 30);
 assert.deepEqual(LAYER_IDS.filter(id => layers[id].enabled).sort(), ['finance','humanitarian','politics','technology']);
});
test('empty layers means none; malformed URL values are safe', () => {
 assert(LAYER_IDS.every(id => !parseFilters('?layers=').layers[id].enabled));
 assert.equal(parseFilters('?t=broken&modes=news:nope&weights=finance:rawRef').time, null);
 assert.equal(parseFilters('?t=2026-10-03T10:00:00Z,2026-10-03T09:00:00Z').time, null);
});
test('URL round-trip preserves filters and unrelated parameters, retiring heatmap settings', () => {
 const filters = parseFilters('?layers=news,wildfire&modes=wildfire:both&heatmap=earthquake&weights=wildfire:significance&t=2026-10-03T00:00:00Z,2026-10-04T00:00:00Z');
 const query = new URLSearchParams(writeFilters('?demo=judge&weights=wildfire:significance&modes=wildfire:heatmap&heatmap=wildfire', filters));
 for (const legacy of ['weights', 'modes', 'heatmap']) assert.equal(query.has(legacy), false);
 assert.equal(query.get('demo'), 'judge');
 assert.deepEqual(parseFilters(`?${query}`), filters);
});
test('start is inclusive, end exclusive; the heatmap mirrors the markers', () => {
 const row = events[0];
 const filters = parseFilters(`?layers=earthquake&t=${row.occurredAt},2026-10-03T12:04:12Z`);
 const result = deriveVisuals(events, filters);
 assert.deepEqual(result.markers.map(e=>e.id), [row.id]);
 assert.deepEqual(result.heatmap, [{ lat: row.lat, lng: row.lng, weight: 1 }]);
 filters.time = { startIso:'2026-10-03T00:00:00Z',endIso:row.occurredAt };
 assert(!deriveVisuals([row], filters).visible.length);
});
test('disabled layers clear markers and heatmap without mutating source data', () => {
 const before = JSON.stringify(events);
 const filters = parseFilters('?layers=wildfire&minSignificance=0');
 let result = deriveVisuals(events, filters);
 assert(result.markers.length > 0);
 assert.equal(result.heatmap.length, result.markers.length);
 filters.layers.wildfire.enabled = false;
 result = deriveVisuals(events, filters);
 assert.equal(result.markers.length, 0);
 assert.equal(result.heatmap.length, 0);
 assert.equal(JSON.stringify(events), before);
});
test('heatmap uses only markers: significance threshold and marker cap apply to both', () => {
 const rows = Array.from({length: 6000}, (_, i) => ({...events[1], id:`stress:${i}`, significance:i}));
 const before = rows.map(e => e.id);
 const filters = parseFilters('?layers=wildfire&minSignificance=100');
 const result = deriveVisuals(rows, filters);
 assert.equal(result.markerCandidateCount, 5900);
 assert.equal(result.markers.length, 5000);
 assert.equal(result.markers[0].significance, 5999);
 assert.equal(result.markers.at(-1).significance, 1000);
 assert.equal(result.heatmap.length, 5000);
 assert(result.heatmap.every(point => point.weight === 1));
 assert.deepEqual(rows.map(e => e.id), before);
});
test('marker threshold validates URLs and includes its boundary', () => {
 for (const raw of ['', '-1', 'Infinity', 'oops']) assert.equal(parseFilters(`?minSignificance=${raw}`).minSignificance, 50);
 const filters = parseFilters('?layers=wildfire&minSignificance=55');
 assert.deepEqual(parseFilters(writeFilters('', filters)), filters);
 assert(deriveVisuals(events, filters).markers.some(e => e.significance === 55));
 assert.equal(parseFilters('?minSignificance=0').minSignificance, 0);
});
test('default product view covers tech, government, finance and society', () => {
 const result = deriveVisuals(events, parseFilters(''));
 assert.deepEqual([...new Set(result.markers.map(e => e.layerId))].sort(), ['finance','humanitarian','politics','technology']);
 const schema = JSON.parse(readFileSync(new URL('../../../packages/schema/event.schema.json', import.meta.url), 'utf8'));
 // Every schema layerId belongs to exactly one sidebar category.
 assert.deepEqual([...LAYER_IDS].sort(), [...schema.properties.layerId.enum].sort());
});

test('six categories partition the layers; category toggles open and close all subcategories', () => {
 assert.equal(CATEGORIES.length, 6);
 assert.equal(new Set(LAYER_IDS).size, LAYER_IDS.length);
 let filters = parseFilters('?layers=');
 assert(CATEGORIES.every(c => categoryState(filters.layers, c.id) === 'off'));
 filters = setCategoryEnabled(filters, 'hazards', true);
 assert.equal(categoryState(filters.layers, 'hazards'), 'on');
 assert(CATEGORIES.find(c => c.id === 'hazards').layers.every(id => filters.layers[id].enabled));
 assert.equal(categoryState(filters.layers, 'culture'), 'off');
 filters = setLayerEnabled(filters, 'volcano', false);
 assert.equal(categoryState(filters.layers, 'hazards'), 'partial');
 assert.deepEqual(parseFilters(writeFilters('', filters)), filters);
 const before = JSON.stringify(filters);
 const closed = setCategoryEnabled(filters, 'hazards', false);
 assert.equal(categoryState(closed.layers, 'hazards'), 'off');
 assert(CATEGORIES.find(c => c.id === 'hazards').layers.every(id => !closed.layers[id].enabled));
 assert.equal(JSON.stringify(filters), before);
 let single = setLayerEnabled(parseFilters('?layers='), 'food', true);
 assert.equal(categoryState(single.layers, 'culture'), 'partial');
 single = setLayerEnabled(single, 'food', false);
 assert.equal(categoryState(single.layers, 'culture'), 'off');
});
