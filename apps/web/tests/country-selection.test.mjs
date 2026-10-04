import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/country-selection.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { countryContains, countryHeadlines, eventCountry } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const {features} = JSON.parse(readFileSync(new URL('../src/data/countries.geojson.json',import.meta.url)));
test('real country geometry selects mainland, islands, dateline parts and Antarctica', () => {
 for (const [id,lat,lng] of [['USA',38.9,-77.04],['GBR',51.5,-0.12],['JPN',35.7,139.7],['FJI',-16.5,179.4],['FJI',-16.3,-179.95],['ATA',-85,0]]) {
  assert(countryContains(features.find(f=>f.id===id),{lat,lng}),id);
 }
 assert(!countryContains(features.find(f=>f.id==='USA'),{lat:51.5,lng:-0.12}));
 assert(!features.some(f=>countryContains(f,{lat:0,lng:-30})));
});
test('polygon holes excluded and boundary included',()=>{
 const country={id:'test',properties:{name:'Test'},geometry:{type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[7,3],[7,7],[3,7],[3,3]]]}};
 assert(countryContains(country,{lat:2,lng:2}));
 assert(countryContains(country,{lat:0,lng:5}));
 assert(!countryContains(country,{lat:5,lng:5}));
});

test('country headlines merge selected countries once each, most significant first', () => {
 const a = { id: 'a', significance: 40 }, b = { id: 'b', significance: 90 }, c = { id: 'c', significance: 90 }, d = { id: 'd', significance: 10 };
 const result = countryHeadlines([{ name: 'One', events: [a, c, d] }, { name: 'Two', events: [b, a] }]);
 assert.deepEqual(result.map(item => item.event.id), ['b', 'c', 'a', 'd']);
 assert.equal(result.find(item => item.event.id === 'a').country, 'One');
 assert.equal(result.find(item => item.event.id === 'b').country, 'Two');
 assert.deepEqual(countryHeadlines([]), []);
});

test('country headlines filter to included events and list connected events first', () => {
 const ev = (id, significance, layer) => ({ id, significance, layer });
 const countries = [{ name: 'One', events: [ev('a', 90, 'on'), ev('b', 40, 'on'), ev('c', 80, 'off'), ev('d', 20, 'on')] }];
 const links = { b: 2, d: 1 };
 const result = countryHeadlines(countries, { include: e => e.layer === 'on', linkCount: id => links[id] ?? 0 });
 assert.deepEqual(result.map(item => item.event.id), ['b', 'd', 'a']);
 assert.deepEqual(result.map(item => item.links), [2, 1, 0]);
});

test('events get a country the same way everywhere, not only where points fall inside an outline', () => {
 const of = event => eventCountry(features, event)?.id;
 // Inland points keep the country under them, even when a stated country differs (a border fire).
 assert.equal(of({ lat: 39.8, lng: -100.5 }), 'USA');
 assert.equal(of({ lat: 38.9, lng: -77.04, countryIso3: 'GBR' }), 'USA');
 // Offshore with a stated country.
 assert.equal(of({ lat: 4.82, lng: 95.24, countryIso3: 'IDN' }), 'IDN');
 // Region and city centroids just off coarse coastlines, named in their location text.
 assert.equal(of({ lat: 31.4167, lng: 34.3333, attributes: { location: 'Gaza City, Israel (general), Israel' } }), 'PSX');
 assert.equal(of({ lat: 46.4639, lng: 30.7386, attributes: { location: "Odesa, Odes'ka Oblast, Ukraine" } }), 'UKR');
 assert.equal(of({ lat: 35.51, lng: 12.6, keywords: [{ text: 'Lampedusa', type: 'location' }, { text: 'Italy', type: 'location' }] }), 'ITA');
 assert.equal(of({ lat: -6.6, lng: 155.6, keywords: [{ text: '21 km NE of Arawa, Papua New Guinea', type: 'place' }] }), 'PNG');
 // No hints: the nearest coast within reach (offshore quakes), across the dateline too.
 assert.equal(of({ lat: 51.55, lng: 159.83 }), 'RUS');
 assert.equal(of({ lat: 54, lng: -4 }), 'GBR');
 assert.equal(of({ lat: -17, lng: -179.9 }), 'FJI');
 // Open ocean, or a place stated as a sea, has no country (not the nearest coast).
 assert.equal(of({ lat: 23.2, lng: -173.1 }), undefined);
 assert.equal(of({ lat: 56, lng: 18, attributes: { location: 'Baltic Sea, Oceans (general), Oceans' } }), undefined);
 // An edge on the far side of the world must not reach across it (Suriname vs the Celebes Sea).
 assert.notEqual(of({ lat: 3.59, lng: 122.93 }), 'SUR');
});
