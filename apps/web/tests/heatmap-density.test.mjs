import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { SphereGeometry } from 'three';
const source = readFileSync(new URL('../src/lib/heatmap-density.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { sphereGrid, densityField, heatmapSegments } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const W = 120, H = 60, BW = 6;
const geometry = new SphereGeometry(100, W, H);
const grid = sphereGrid(geometry.getAttribute('position').array, W, H);
const nearest = (lat, lng) => {
 let best = 0, bestDistance = Infinity;
 for (let i = 0; i < grid.lats.length; i++) {
  const d = (grid.lats[i] - lat) ** 2 + ((((grid.lngs[i] - lng) + 540) % 360) - 180) ** 2;
  if (d < bestDistance) { bestDistance = d; best = i; }
 }
 return best;
};

test('grid uses the three-globe lat/lng convention', () => {
 assert.equal(grid.lats.length, (W + 1) * (H + 1));
 assert.equal(Math.round(grid.lats[0]), 90);
 assert.equal(Math.round(grid.lats.at(-1)), -90);
 assert(grid.lngs.every(lng => lng >= -180 - 1e-9 && lng <= 180 + 1e-9));
});

test('density peaks at the point, is normalized, and vanishes beyond four bandwidths', () => {
 const field = densityField(grid, [{ lat: 30, lng: 45, weight: 1 }], BW);
 assert.equal(Math.max(...field), 1);
 assert.equal(field[nearest(30, 45)], 1);
 assert.equal(field[nearest(30, 45 + 40)], 0);
 assert.equal(field[nearest(-30, 45)], 0);
 assert.deepEqual([...densityField(grid, [], BW)].filter(Boolean), []);
});

test('spots wrap across the dateline and keep the seam column consistent', () => {
 const field = densityField(grid, [{ lat: 0, lng: 179, weight: 1 }], BW);
 assert(field[nearest(0, -178)] > 0, 'reaches across the dateline');
 for (let row = 0; row <= H; row++) assert.equal(field[row * (W + 1) + W], field[row * (W + 1)]);
});

test('local computation matches a brute-force great-circle kernel', () => {
 const points = [{ lat: 10, lng: 20, weight: 1 }, { lat: 12, lng: 24, weight: 2 }, { lat: 85, lng: -170, weight: 1 }];
 const field = densityField(grid, points, BW);
 const rad = Math.PI / 180, raw = new Float64Array(grid.lats.length);
 for (let i = 0; i < raw.length; i++) for (const p of points) {
  const a = grid.lats[i] * rad, b = p.lat * rad, dl = (grid.lngs[i] - p.lng) * rad;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((a - b) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(dl / 2) ** 2)));
  if (d < 4 * BW * rad) raw[i] += p.weight * Math.exp(-((d / (BW * rad)) ** 2) / 2);
 }
 const max = Math.max(...raw);
 for (let i = 0; i < raw.length; i++) assert(Math.abs(field[i] - Math.min(1, raw[i] * 1.5 / max)) < 1e-5, `vertex ${i}`);
});

test('segment count follows three-globe resolution rules', () => {
 assert.deepEqual(heatmapSegments(3), { widthSegments: 420, heightSegments: 210 });
 assert.deepEqual(heatmapSegments(1.5), { widthSegments: 840, heightSegments: 420 });
});
