import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, CatmullRomCurve3 } from 'three';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/related-events.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText.replace('"three"', JSON.stringify(import.meta.resolve('three')));
const { floatingArc, placeholderRelatedEvents, setConnection, clearSourceConnections, connectTree, pruneBranch } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
test('demo links are stable, unique, exclude self, and handle sparse data', () => {
 const a = {id:'a'}, b = {id:'b'}, c = {id:'c'}, d = {id:'d'};
 assert.deepEqual(placeholderRelatedEvents(a, [d,c,b,a,b]), [b,c,d]);
 assert.deepEqual(placeholderRelatedEvents(a, [a]), []);
 assert.deepEqual(placeholderRelatedEvents(a, []), []);
 assert.deepEqual(placeholderRelatedEvents(a, [a,b]), [b]);
});
test('floating arcs clear raised surfaces and retain elevated endpoints, including antipodes', () => {
 const a = new Vector3(0,0,100);
 for (const b of [new Vector3(100,0,0), new Vector3(0,0,-100), a.clone(), new Vector3(.00001,0,-100)]) {
  const points = floatingArc(a,b,100,.07,.12);
  assert(points[0].distanceTo(a.clone().normalize().multiplyScalar(107)) < 1e-6);
  assert(points.at(-1).distanceTo(b.clone().normalize().multiplyScalar(107)) < .001);
  const curve = new CatmullRomCurve3(points);
  for(let i=0;i<=512;i++) {
   const p=curve.getPoint(i/512);
   assert(Number.isFinite(p.length()));
   assert(p.length()-.3 > 100*(1+.025+.016));
  }
 }
});

test('multiple directed connections deduplicate and clear only the requested source', () => {
 const a={id:'a'},b={id:'b'},c={id:'c'},d={id:'d'};
 let links=setConnection([],a,b,true);
 links=setConnection(links,a,c,true);
 links=setConnection(links,d,b,true);
 assert.equal(links.length,3);
 assert.equal(setConnection(links,a,b,true).length,3);
 const removed=setConnection(links,a,b,false);
 assert.deepEqual(removed.map(link=>[link.source.id,link.target.id]),[['a','c'],['d','b']]);
 assert.deepEqual(clearSourceConnections(links,'a').map(link=>[link.source.id,link.target.id]),[['d','b']]);
 assert.equal(links.length,3);
 assert.equal(setConnection(links,a,a,true).length,3);
});

test('tree branch removal cascades but preserves the root and sibling branches', () => {
 const a={id:'a'},b={id:'b'},c={id:'c'},d={id:'d'},e={id:'e'};
 let links=connectTree([],a,a,b);
 links=connectTree(links,a,b,c);
 links=connectTree(links,a,a,d);
 links=connectTree(links,a,c,e);
 assert.equal(links.length,4);
 assert.equal(connectTree(links,a,e,a),links);
 assert.equal(connectTree(links,a,d,c),links);
 const pruned=pruneBranch(links,'b');
 assert.deepEqual([...pruned.removed].sort(),['b','c','e']);
 assert.deepEqual(pruned.links.map(l=>[l.source.id,l.target.id]),[['a','d']]);
 assert.equal(pruneBranch(links,'a').links.length,0);
 assert.equal(links.length,4);
});
