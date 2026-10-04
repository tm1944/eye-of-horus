import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/idle-spin.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { easeInOutCubic, clampViewLat, canSpin, spinUpFrame } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

test('easing starts slow, ends at full and clamps outside 0..1', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.ok(easeInOutCubic(0.1) < 0.1);
  assert.equal(easeInOutCubic(-1), 0);
  assert.equal(easeInOutCubic(2), 1);
});

test('view latitude stays within the tilt lock', () => {
  assert.equal(clampViewLat(70, 45), 45);
  assert.equal(clampViewLat(-80, 45), -45);
  assert.equal(clampViewLat(12, 45), 12);
});

test('rotation waits for the idle gap and never starts while held or with reduced motion', () => {
  const base = { held: false, reduced: false, lastInteraction: 0, idleMs: 10000 };
  assert.equal(canSpin({ ...base, now: 9999 }), false);
  assert.equal(canSpin({ ...base, now: 10000 }), true);
  assert.equal(canSpin({ ...base, now: 60000, held: true }), false);
  assert.equal(canSpin({ ...base, now: 60000, reduced: true }), false);
  assert.equal(canSpin({ ...base, lastInteraction: -Infinity, now: 0 }), true);
});

test('spin-up accelerates to full speed while easing tilt and zoom back', () => {
  const from = { lat: -40, altitude: 0.3 }, to = { lat: 30, altitude: 2 };
  const start = spinUpFrame(0, 4000, 4000, from, to);
  assert.equal(start.speed, 0);
  assert.deepEqual(start.view, from);
  assert.equal(start.returning, true);
  const mid = spinUpFrame(2000, 4000, 4000, from, to);
  assert.equal(mid.speed, 0.5);
  assert.ok(Math.abs(mid.view.lat + 5) < 1e-9 && Math.abs(mid.view.altitude - 1.15) < 1e-9);
  const end = spinUpFrame(5000, 4000, 4000, from, to);
  assert.equal(end.speed, 1);
  assert.deepEqual(end.view, to);
  assert.equal(end.returning, false);
});
