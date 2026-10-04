import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/globe-depth.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { globeClipPlanes } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
test('clip range preserves globe and atmosphere from close zoom to distant responsive fits', () => {
 for (const distance of [104, 112, 150, 400, 800, 2000]) {
  const { near, far } = globeClipPlanes(distance, 100, 0.12);
  assert(near > 0 && far > near);
  assert(near < distance - 100.18); // land, borders, and markers stay in front of near plane
  assert(far > distance + 112); // far-side atmosphere stays within range
  if (distance > 112) assert(near < distance - 112);
 }
});
test('zoom-out depth precision resolves closely spaced surface layers even with 16-bit depth', () => {
 const depth = (z,n,f) => f/(f-n) - f*n/((f-n)*z);
 for (const distance of [400,800,2000]) {
  const {near,far}=globeClipPlanes(distance,100,0.12);
  const globe=depth(distance-100,near,far);
  const land=depth(distance-100.1,near,far);
  assert((globe-land)*65535 > 4);
 }
});

test('clip range also holds relationship arcs that float above the atmosphere', () => {
 const arcPeak = 0.07 + 0.12; // relatedArcClearance + relatedArcRise in globe-config.ts
 // Camera above the arc peak: the peak on the camera side must stay beyond the near plane.
 for (const distance of [125, 150, 400, 800]) {
  const { near } = globeClipPlanes(distance, 100, arcPeak + 0.02);
  assert(near < distance - 100 * (1 + arcPeak), `arc peak in front of near plane at distance ${distance}`);
 }
 // Camera below the peak (close zoom): the near plane sits at its small floor.
 for (const distance of [104, 112]) assert.equal(globeClipPlanes(distance, 100, arcPeak + 0.02).near, 100 * 0.001);
 // The old atmosphere-only extent clipped it whenever the camera was beyond the arc peak.
 assert(globeClipPlanes(150, 100, 0.12).near > 150 - 100 * (1 + arcPeak));
});
