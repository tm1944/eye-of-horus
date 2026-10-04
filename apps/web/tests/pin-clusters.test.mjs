import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/pin-clusters.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { clusterScreenPins, angularSpread, spreadAltitude, pickSpotlight } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const pin = (id, x, y, lat = x, lng = y) => ({ id, x, y, lat, lng });
test('pins within the radius of a leader join it; distant pins lead their own cluster', () => {
 const clusters = clusterScreenPins([pin('a',100,100), pin('b',120,100), pin('c',300,300), pin('d',127,100)], 28);
 assert.deepEqual(clusters.map(c => [c.key, c.ids]), [['a',['a','b','d']], ['c',['c']]]);
 assert.equal(clusters[0].x, 100, 'the leader keeps its own position');
 // Joining is measured from the leader, so chains do not snowball across the screen.
 assert.deepEqual(clusterScreenPins([pin('a',0,0), pin('b',25,0), pin('c',50,0)], 28).map(c => c.ids), [['a','b'],['c']]);
});
test('neighbouring grid cells are searched, and identical coordinates always group', () => {
 assert.deepEqual(clusterScreenPins([pin('a',27,27), pin('b',29,29)], 28).map(c => c.ids), [['a','b']]);
 const same = clusterScreenPins([pin('a',10,10,5,5), pin('b',10,10,5,5), pin('c',12,10,6,5)], 28);
 assert.deepEqual(same.map(c => [c.ids, c.colocated]), [[['a','b','c'], false]]);
 assert.equal(clusterScreenPins([pin('a',10,10,5,5), pin('b',10,10,5,5)], 28)[0].colocated, true);
 assert.deepEqual(clusterScreenPins([], 28), []);
});
test('angular spread finds the centre and the farthest member, across the antimeridian', () => {
 const { center, angle } = angularSpread([{lat:0,lng:179},{lat:0,lng:-179}]);
 assert(Math.abs(Math.abs(center.lng) - 180) < 1e-9);
 assert(Math.abs(angle - Math.PI / 180) < 1e-9);
 assert.equal(angularSpread([{lat:10,lng:20},{lat:10,lng:20}]).angle, 0);
});
test('zooming to spread a cluster always closes in, but never past the minimum altitude', () => {
 const wide = spreadAltitude({ angle: 0.2, targetPx: 120, focalPx: 900, currentAltitude: 3, minAltitude: 0.04 });
 assert(Math.abs(wide - (Math.cos(0.2) - 1 + 900 * Math.sin(0.2) / 120)) < 1e-9);
 assert.equal(spreadAltitude({ angle: 0.2, targetPx: 120, focalPx: 900, currentAltitude: 1, minAltitude: 0.04 }), 0.75, 'at least a 25% step in');
 assert.equal(spreadAltitude({ angle: 0.0001, targetPx: 120, focalPx: 900, currentAltitude: 1, minAltitude: 0.04 }), 0.04);
});
test('spotlight picks the most significant central, front-facing event not shown recently', () => {
 const c = (id, significance, x, y, front = true) => ({ id, significance, x, y, front });
 const all = [c('edge',99,10,10), c('back',98,500,400,false), c('top',90,500,400), c('next',80,450,350)];
 assert.equal(pickSpotlight(all, 1000, 800, new Set()), 'top');
 assert.equal(pickSpotlight(all, 1000, 800, new Set(['top'])), 'next');
 assert.equal(pickSpotlight(all, 1000, 800, new Set(['top','next'])), null);
});
