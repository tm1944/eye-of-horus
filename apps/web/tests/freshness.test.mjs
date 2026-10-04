import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/freshness.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { freshness, exactTime, isDateOnly } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const now = new Date('2026-10-04T15:30:00Z');
test('timed events count up from minutes to hours to days, then show the date', () => {
 assert.equal(freshness('2026-10-04T15:29:30Z', now), 'Just now');
 assert.equal(freshness('2026-10-04T15:28:00Z', now), '2 min ago');
 assert.equal(freshness('2026-10-04T12:10:00Z', now), '3 h ago');
 assert.equal(freshness('2026-10-03T12:10:00Z', now), 'Yesterday');
 assert.equal(freshness('2026-10-01T12:10:00Z', now), '3 days ago');
 assert.equal(freshness('2026-09-20T12:10:00Z', now), 'Sep 20');
 assert.equal(freshness('2025-09-20T12:10:00Z', now), 'Sep 20, 2025');
 assert.equal(freshness('2026-10-04T15:33:00Z', now), 'Just now', 'small clock skew is not "in the future"');
 assert.equal(freshness('2026-10-09T09:00:00Z', now), 'Oct 9');
 assert.equal(freshness('not a date', now), '');
});
test('date-only events (exactly midnight UTC) read as days, never hours', () => {
 assert.equal(isDateOnly(new Date('2026-10-04T00:00:00Z')), true);
 assert.equal(isDateOnly(new Date('2026-10-04T00:00:01Z')), false);
 assert.equal(freshness('2026-10-04T00:00:00Z', now), 'Today');
 assert.equal(freshness('2026-10-03T00:00:00Z', now), 'Yesterday');
 assert.equal(freshness('2026-09-30T00:00:00Z', now), 'Sep 30');
 assert.equal(exactTime('2026-10-03T00:00:00Z'), 'Oct 3, 2026', 'just the date, no time and no caveat');
 assert.match(exactTime('2026-10-03T12:10:00Z'), /^Oct 3, 2026, 12:10 PM UTC$/);
});
