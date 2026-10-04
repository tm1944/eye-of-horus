import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/card-placement.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { placeCard } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
test('new cards fit around existing cards without mutating them, including over Earth center', () => {
 const preferred = {left:460,top:300,width:278,height:200};
 const first = placeCard(preferred, [], 1200, 800);
 assert.deepEqual(first, preferred);
 const original = {...first};
 const second = placeCard(preferred, [first], 1200, 800);
 assert(second);
 assert.deepEqual(first, original);
 assert(second.left+second.width+16<=first.left || first.left+first.width+16<=second.left || second.top+second.height+16<=first.top || first.top+first.height+16<=second.top);
});
test('full viewport waits for a released slot instead of overlapping', () => {
 const rect = {left:24,top:24,width:312,height:392};
 assert.equal(placeCard(rect,[rect],360,440),undefined);
 assert.deepEqual(placeCard(rect,[],360,440),rect);
});
