import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/country-selection.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { countryContains } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
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
