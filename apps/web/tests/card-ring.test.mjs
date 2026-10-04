import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/card-ring.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { ringAnchor, hangsBelow, layoutRingCards, easeFactor } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const rad = d => d * Math.PI / 180;
// three-globe style: north is +y; the camera looks from +z at the globe centre.
const pole = [0, 1, 0], toCamera = [0, 0, 1];
const at = (lat, lon) => [Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat)), Math.cos(rad(lat)) * Math.cos(rad(lon))];
const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('the ring meets the pin at the left and right edges and rides highest facing the viewer', () => {
 const tilt = rad(25);
 for (const lon of [-90, 90]) assert(close(ringAnchor(at(20, lon), pole, toCamera, tilt, false, 0), at(20, lon)), `edge ${lon}`);
 const front = ringAnchor(at(20, 0), pole, toCamera, tilt, false, 0);
 assert(Math.abs(front[1] - (Math.sin(rad(20)) + Math.cos(rad(20)) * Math.sin(tilt))) < 1e-9, 'raised by the tilt at the centre');
 // Height above the pin grows smoothly toward the centre: an arch.
 const rise = lon => ringAnchor(at(20, lon), pole, toCamera, tilt, false, 0)[1] - at(20, lon)[1];
 assert(rise(0) > rise(30) && rise(30) > rise(60) && rise(60) > rise(85) && rise(85) > 0);
 // Hanging cards mirror it downwards.
 assert(ringAnchor(at(-30, 0), pole, toCamera, tilt, true, 0)[1] < at(-30, 0)[1]);
});

test('the ring is fixed to the viewer: turning the camera moves the high point with it', () => {
 const tilt = rad(25);
 const sideCamera = [1, 0, 0]; // now the front is at longitude 90
 const rise = (lon, cam) => ringAnchor(at(10, lon), pole, cam, tilt, false, 0)[1] - at(10, lon)[1];
 assert(rise(90, sideCamera) > rise(0, sideCamera));
 assert(Math.abs(rise(0, sideCamera)) < 1e-9, 'longitude 0 is now an edge');
 // Lift pushes the anchor off the surface; a camera over the pole falls back to straight up.
 assert(Math.abs(Math.hypot(...ringAnchor(at(0, 90), pole, toCamera, tilt, false, 0.05)) - 1.05) < 1e-9);
 assert(close(ringAnchor(at(10, 0), pole, [0, 1, 0], tilt, false, 0.1), at(10, 0).map(v => v * 1.1)));
});

test('cards sit above pins at or north of the split latitude, and hang below south of it', () => {
 assert.equal(hangsBelow(45, 30), false);
 assert.equal(hangsBelow(30, 30), false);
 assert.equal(hangsBelow(29.9, 30), true);
 assert.equal(hangsBelow(0, 30), true);
 assert.equal(hangsBelow(-40, 30), true);
});

test('cards open away from their pin, avoid each other, and hide when they cannot fit', () => {
 const bounds = { width: 1000, height: 800, pad: 20 };
 const card = (id, anchorX, anchorY, priority, below = false) => ({ id, anchorX, anchorY, width: 200, height: 60, below, priority });
 const placed = layoutRingCards([card('a', 500, 400, 9), card('b', 520, 400, 5), card('s', 500, 500, 1, true)], [], bounds, 10);
 assert.deepEqual(placed.get('a'), { left: 400, top: 330, width: 200, height: 60 }, 'above: bottom edge just over the anchor');
 assert.deepEqual(placed.get('b'), { left: 420, top: 260, width: 200, height: 60 }, 'pushed further up past a');
 assert.deepEqual(placed.get('s'), { left: 400, top: 510, width: 200, height: 60 }, 'below: top edge just under the anchor');
 // Screen edges clamp; a card pinned against the top edge with no room is hidden, not stacked.
 const edge = layoutRingCards([card('x', 10, 30, 9), card('y', 15, 30, 1)], [], bounds, 10);
 assert.deepEqual(edge.get('x'), { left: 20, top: 20, width: 200, height: 60 });
 assert.equal(edge.get('y'), null);
 // Fixed cards (the open details card) are obstacles too.
 const fixedOnly = layoutRingCards([card('z', 500, 400, 1)], [{ left: 380, top: 300, width: 300, height: 100 }], bounds, 10);
 assert.equal(fixedOnly.get('z').top, 300 - 10 - 60);
});

test('easing is frame-rate independent', () => {
 assert.equal(easeFactor(0, 140), 0);
 assert.equal(easeFactor(100, 0), 1);
 const twoSteps = 1 - (1 - easeFactor(8, 140)) ** 2;
 assert(Math.abs(twoSteps - easeFactor(16, 140)) < 1e-12);
});
