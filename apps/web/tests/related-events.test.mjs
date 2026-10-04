import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, CatmullRomCurve3 } from 'three';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/related-events.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText.replace('"three"', JSON.stringify(import.meta.resolve('three')));
const { floatingArc, indexLinks, otherEnd, arcSpecs, pickTarget, growProgress, retractProgress } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
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

const link = (id, sourceId, targetId) => ({ id, sourceId, targetId });
test('links are indexed under both ends, once each, including self links', () => {
 const ab = link('ab','a','b'), ca = link('ca','c','a'), aa = link('aa','a','a');
 const index = indexLinks([ab, ca, aa]);
 assert.deepEqual(index.get('a'), [ab, ca, aa]);
 assert.deepEqual(index.get('b'), [ab]);
 assert.deepEqual(index.get('c'), [ca]);
 assert.equal(otherEnd(ca,'a'),'c');
 assert.equal(otherEnd(ca,'c'),'a');
});

test('arcs fan out from shown origins to shown events only, each link drawn once', () => {
 const ab = link('ab','a','b'), ac = link('ac','a','c'), cb = link('cb','c','b'), aa = link('aa','a','a');
 const index = indexLinks([ab, ac, cb, aa]);
 const shown = new Set(['a','b','c']);
 const arcs = (origins, visible = shown) => arcSpecs(origins, index, visible).map(s => `${s.link.id}:${s.from}>${s.to}`);
 assert.deepEqual(arcs(['a']), ['ab:a>b','ac:a>c']);
 // The hovered origin adds its own links; the shared link keeps the selected origin's direction.
 assert.deepEqual(arcs(['a','c']), ['ab:a>b','ac:a>c','cb:c>b']);
 assert.deepEqual(arcs(['c','a']), ['ac:c>a','cb:c>b','ab:a>b']);
 // Filtered-out events are skipped, as are hidden or missing origins.
 assert.deepEqual(arcs(['a'], new Set(['a','b'])), ['ab:a>b']);
 assert.deepEqual(arcs(['a'], new Set(['b','c'])), []);
 assert.deepEqual(arcs([null, undefined, 'z']), []);
});

test('pins win over nearer arcs; anything behind the globe surface is ignored', () => {
 assert.deepEqual(pickTarget([{kind:'arc',id:'l1',distance:5},{kind:'pin',id:'p1',distance:9},{kind:'surface',distance:10}]), {kind:'pin',id:'p1'});
 assert.deepEqual(pickTarget([{kind:'arc',id:'l2',distance:7},{kind:'arc',id:'l1',distance:5},{kind:'surface',distance:10}]), {kind:'arc',id:'l1'});
 assert.equal(pickTarget([{kind:'surface',distance:10},{kind:'pin',id:'far',distance:150},{kind:'arc',id:'far',distance:160}]), null);
 assert.deepEqual(pickTarget([{kind:'arc',id:'sky',distance:40}]), {kind:'arc',id:'sky'});
 assert.equal(pickTarget([]), null);
});

test('arcs grow with an ease-out, wait out their stagger, and retract from where they were', () => {
 assert.equal(growProgress(-100, 600), 0);
 assert.equal(growProgress(0, 600), 0);
 assert.equal(growProgress(600, 600), 1);
 assert.equal(growProgress(900, 600), 1);
 assert(growProgress(300, 600) > .5, 'ease-out covers more than half the distance by half time');
 assert.equal(retractProgress(.4, 0, 300), .4);
 assert.equal(retractProgress(.4, 300, 300), 0);
 assert(retractProgress(1, 150, 300) > .5, 'ease-in leaves slowly');
});
