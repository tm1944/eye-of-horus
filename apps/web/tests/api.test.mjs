import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Compile the actual browser loader; type-only fixture imports disappear.
const source = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { getEvents } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const fixtures = JSON.parse(readFileSync(new URL("../../../data/fixtures/events.json", import.meta.url), "utf8"));
const liveStatus = { usgs: "ok", firms: "unknown", tigerdata: "ok" };
const response = (events, nextCursor = null, sourceStatus = liveStatus) => Response.json({
  generatedAt: "2026-10-03T12:00:00Z", events, nextCursor, sourceStatus,
}, { headers: { "X-Data-Mode": "api" } });
afterEach(() => mock.restoreAll());

test("loads all pages and preserves the cancellation signal", async () => {
  const controller = new AbortController();
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    assert.equal(options.signal, controller.signal);
    return calls.length === 1 ? response(fixtures.slice(0, 1), "page+2=") : response(fixtures.slice(1));
  });
  const result = await getEvents(controller.signal);
  assert.deepEqual(result.data.events, fixtures);
  assert.deepEqual(calls, ["/api/events", "/api/events?cursor=page%2B2%3D"]);
  assert.equal(result.mode, "api");
});

test("restarts once on 409 and discards old partial data", async () => {
  const replies = [response(fixtures.slice(0, 1), "next"), new Response(null, { status: 409 }), response(fixtures.slice(1))];
  const calls = [];
  mock.method(globalThis, "fetch", async (url) => { calls.push(url); return replies.shift(); });
  assert.deepEqual((await getEvents()).data.events, fixtures.slice(1));
  assert.equal(calls[2], "/api/events");
});

test("does not retry an endlessly changing dataset", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response(null, { status: 409 }));
  await assert.rejects(getEvents(), /409/);
  assert.equal(fetch.mock.callCount(), 2);
});

test("labels API-served fallback fixtures as samples", async () => {
  mock.method(globalThis, "fetch", async () => response(fixtures, null, { usgs: "fixture", firms: "fixture", tigerdata: "dark" }));
  assert.equal((await getEvents()).mode, "fixture");
});

test("does not label unknown snapshot data as samples", async () => {
  mock.method(globalThis, "fetch", async () => response(fixtures, null, { usgs: "unknown", firms: "unknown", tigerdata: "fixture" }));
  assert.equal((await getEvents()).mode, "api");
});

test("names the failing source and rejects partial results", async () => {
  const replies = [response(fixtures.slice(0, 1), "next"), Response.json({ detail: { failingSource: "tigerdata" } }, { status: 503 })];
  mock.method(globalThis, "fetch", async () => replies.shift());
  await assert.rejects(getEvents(), /503.*tigerdata/);
});

test("rejects a repeated cursor instead of requesting forever", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => response(fixtures, "loop"));
  await assert.rejects(getEvents(), /repeated an event cursor/);
  assert.equal(fetch.mock.callCount(), 2);
});

test("does not request data after cancellation", async () => {
  const fetch = mock.method(globalThis, "fetch");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getEvents(controller.signal), { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 0);
});
