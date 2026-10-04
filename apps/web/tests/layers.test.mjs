import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Compile this pure module in memory so tests also work on Node 20.9+.
const source = readFileSync(new URL('../src/lib/layers.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { CATEGORIES, CATEGORY_OF, DEFAULT_CATEGORIES, LAYER_IDS, defaultLayers, parseFilters, writeFilters, deriveVisuals, categoryState, setCategoryEnabled, setLayerEnabled, parseTab, writeTab, headlineFeed } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const events = JSON.parse(readFileSync(new URL('./fixtures/events.json', import.meta.url), 'utf8'));
test('all 30 layers persist; politics, economy and security start fully on, hazards off', () => {
 const layers = defaultLayers();
 assert.equal(Object.keys(layers).length, 30);
 assert.deepEqual(DEFAULT_CATEGORIES, ['security', 'politics', 'economy']);
 for (const id of DEFAULT_CATEGORIES) assert.equal(categoryState(layers, id), 'on');
 assert.equal(categoryState(layers, 'hazards'), 'off');
 assert.equal(categoryState(layers, 'culture'), 'off');
 assert.equal(categoryState(layers, 'society'), 'off');
 assert.equal(CATEGORIES.at(-1).id, 'hazards', 'Natural Hazards is last in the rail');
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
test('start is inclusive, end exclusive; the heatmaps mirror the markers', () => {
 const row = events[0];
 const filters = parseFilters(`?layers=earthquake&t=${row.occurredAt},2026-10-03T12:04:12Z`);
 const result = deriveVisuals(events, filters);
 assert.deepEqual(result.markers.map(e=>e.id), [row.id]);
 assert.deepEqual(result.heatmaps, [{ id: 'hazards', points: [{ lat: row.lat, lng: row.lng, weight: 1 }] }]);
 filters.time = { startIso:'2026-10-03T00:00:00Z',endIso:row.occurredAt };
 assert(!deriveVisuals([row], filters).visible.length);
});
test('disabled layers clear markers and heatmaps without mutating source data', () => {
 const before = JSON.stringify(events);
 const filters = parseFilters('?layers=wildfire&minSignificance=0');
 let result = deriveVisuals(events, filters);
 assert(result.markers.length > 0);
 assert.equal(result.heatmaps.flatMap(h => h.points).length, result.markers.length);
 filters.layers.wildfire.enabled = false;
 result = deriveVisuals(events, filters);
 assert.equal(result.markers.length, 0);
 assert.deepEqual(result.heatmaps, []);
 assert.equal(JSON.stringify(events), before);
});
test('heatmaps use only markers: significance threshold and marker cap apply to both', () => {
 const rows = Array.from({length: 6000}, (_, i) => ({...events[1], id:`stress:${i}`, significance:i}));
 const before = rows.map(e => e.id);
 const filters = parseFilters('?layers=wildfire&minSignificance=100');
 const result = deriveVisuals(rows, filters);
 assert.equal(result.markerCandidateCount, 5900);
 assert.equal(result.markers.length, 5000);
 assert.equal(result.markers[0].significance, 5999);
 assert.equal(result.markers.at(-1).significance, 1000);
 assert.equal(result.heatmaps.flatMap(h => h.points).length, 5000);
 assert(result.heatmaps.flatMap(h => h.points).every(point => point.weight === 1));
 assert.deepEqual(rows.map(e => e.id), before);
});
test('marker threshold validates URLs and includes its boundary', () => {
 for (const raw of ['', '-1', 'Infinity', 'oops']) assert.equal(parseFilters(`?minSignificance=${raw}`).minSignificance, 50);
 const filters = parseFilters('?layers=wildfire&minSignificance=55');
 assert.deepEqual(parseFilters(writeFilters('', filters)), filters);
 assert(deriveVisuals(events, filters).markers.some(e => e.significance === 55));
 assert.equal(parseFilters('?minSignificance=0').minSignificance, 0);
});
test('default product view shows politics, economy and security only', () => {
 const result = deriveVisuals(events, parseFilters(''));
 const shown = new Set(result.markers.map(e => e.layerId));
 for (const id of ['finance','politics','technology','conflict']) assert(shown.has(id), id);
 assert([...shown].every(id => DEFAULT_CATEGORIES.includes(CATEGORY_OF.get(id))));
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

test('the tab lives in the URL beside the filters; headlines is the default and leaves no parameter', () => {
 assert.equal(parseTab(''), 'headlines');
 assert.equal(parseTab('?tab=explore&layers=news'), 'explore');
 assert.equal(parseTab('?tab=feed'), 'feed');
 assert.equal(writeTab('', 'feed'), 'tab=feed');
 assert.equal(parseTab('?tab=nonsense'), 'headlines');
 assert.equal(writeTab('?layers=news', 'explore'), 'layers=news&tab=explore');
 assert.equal(writeTab('?layers=news&tab=explore', 'headlines'), 'layers=news');
 // Filter updates keep the tab.
 assert.equal(parseTab(`?${writeFilters('?tab=explore', parseFilters(''))}`), 'explore');
});

test('headlines rank by significance, cap each category, then fill any empty slots', () => {
 const e = (id, layerId, significance) => ({ id, layerId, significance });
 const rows = [e('c1','conflict',100), e('c2','crime',99), e('c3','terror',98), e('c4','protest',97), e('p1','politics',60), e('f1','finance',50), e('s1','sports',10)];
 assert.deepEqual(headlineFeed(rows, 5, 3).map(r => r.id), ['c1','c2','c3','p1','f1']);
 // Too few other categories: the capped category fills the remaining slots.
 assert.deepEqual(headlineFeed(rows, 7, 3).map(r => r.id), ['c1','c2','c3','c4','p1','f1','s1']);
 assert.deepEqual(headlineFeed(rows.slice(0, 4), 4, 2).map(r => r.id), ['c1','c2','c3','c4']);
 assert.deepEqual(headlineFeed([], 5, 3), []);
 assert.equal(rows[0].id, 'c1', 'input is not reordered');
});

test('heatmaps split markers by category, each holding only its own layers', () => {
 const filters = parseFilters('?layers=politics,finance,technology,wildfire,conflict&minSignificance=0');
 const result = deriveVisuals(events, filters);
 assert(result.heatmaps.length > 1);
 assert.equal(new Set(result.heatmaps.map(h => h.id)).size, result.heatmaps.length);
 for (const heatmap of result.heatmaps) {
  const expected = result.markers.filter(e => CATEGORY_OF.get(e.layerId) === heatmap.id);
  assert.deepEqual(heatmap.points, expected.map(e => ({ lat: e.lat, lng: e.lng, weight: 1 })));
 }
});
