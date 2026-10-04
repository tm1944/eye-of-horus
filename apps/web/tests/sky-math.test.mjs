import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/sky-math.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { gmstDegrees, subStellarPoint, skyDirection, bvColor, magnitudeWeight } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const catalog = JSON.parse(readFileSync(new URL('../src/data/bright-stars.json', import.meta.url), 'utf8'));
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);

test('sidereal time matches published values', () => {
  near(gmstDegrees(new Date('2000-01-01T12:00:00Z')), 280.46061837, 1e-6); // J2000.0 definition
  // Meeus, Astronomical Algorithms, example 12.a: 1987-04-10 0h UT → 13h10m46.3668s
  near(gmstDegrees(new Date('1987-04-10T00:00:00Z')), 15 * (13 + 10 / 60 + 46.3668 / 3600), 1e-3);
});

test('a star is overhead where local sidereal time equals its right ascension', () => {
  const gmst = 100;
  const { lat, lng } = subStellarPoint(101.29, -16.72, gmst); // Sirius
  near(lat, -16.72, 1e-9);
  near(lng, 1.29, 1e-9);
  near(subStellarPoint(10, 0, 350).lng, 20, 1e-9); // wraps into −180..180
});

test('directions follow three-globe axes', () => {
  const [x0, y0, z0] = skyDirection(0, 0);
  near(x0, 0, 1e-12); near(y0, 0, 1e-12); near(z0, 1, 1e-12);
  const [x1, , z1] = skyDirection(0, 90);
  near(x1, 1, 1e-12); near(z1, 0, 1e-12);
  near(skyDirection(90, 0)[1], 1, 1e-12);
});

test('colors run from blue-white to orange and desaturate toward white', () => {
  const [hotR, , hotB] = bvColor(-0.3, 1), [coolR, , coolB] = bvColor(1.6, 1);
  assert.ok(hotB > hotR && coolR > coolB);
  assert.deepEqual(bvColor(1.6, 0), [1, 1, 1]);
});

test('magnitude weight spans Sirius to the cutoff', () => {
  near(magnitudeWeight(-1.46, 5), 1, 1e-12);
  near(magnitudeWeight(5, 5), 0, 1e-12);
  near(magnitudeWeight(6, 5), 0, 1e-12);
});

test('catalog is brightest-first with real positions', () => {
  const [ra, dec, vmag] = catalog.stars.slice(0, 3);
  assert.equal(catalog.fields.join(), 'raDeg,decDeg,vmag,bv');
  near(ra, 101.29, 0.02); near(dec, -16.72, 0.02); near(vmag, -1.46, 0.01); // Sirius
  assert.ok(catalog.stars.length / 4 > 9000);
  for (let i = 6; i < catalog.stars.length; i += 4) assert.ok(catalog.stars[i] >= catalog.stars[i - 4]);
});
