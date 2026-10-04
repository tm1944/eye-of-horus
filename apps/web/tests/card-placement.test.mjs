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
test('outside-Earth space wins over a shorter connector, while neighbors stay fixed', () => {
 const preferred = {left:460,top:300,width:200,height:150};
 const occupied = [{left:24,top:24,width:200,height:150}];
 const snapshot = JSON.stringify(occupied);
 const globe = {x:600,y:400,radius:240};
 const placed = placeCard(preferred,occupied,1200,800,24,16,globe);
 assert(placed);
 const x=Math.max(placed.left,Math.min(placed.left+placed.width,globe.x));
 const y=Math.max(placed.top,Math.min(placed.top+placed.height,globe.y));
 assert(Math.hypot(x-globe.x,y-globe.y)>=globe.radius+16);
 assert.equal(JSON.stringify(occupied),snapshot);
});
test('Earth preference remains soft when only free space is over the globe', () => {
 assert(placeCard({left:24,top:24,width:200,height:200},[],260,260,24,16,{x:130,y:130,radius:125}));
});
test('strict central circle stays clear while the outer Earth area can hold cards', () => {
 const globe={x:600,y:400,radius:120,strict:true};
 const preferred={left:760,top:350,width:200,height:80};
 assert.deepEqual(placeCard(preferred,[],1200,800,24,16,globe),preferred);
 assert.equal(placeCard({left:24,top:24,width:200,height:200},[],260,260,24,16,{x:130,y:130,radius:65,strict:true}),undefined);
});
