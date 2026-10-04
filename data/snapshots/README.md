# Last-good API snapshots

The API saves validated warehouse events to `events.json` and links to
`links.json`. Request filters and page size do not affect either snapshot.
Runtime JSON files are ignored by Git.

`meta.json` contains `lastIngestAt`, `savedAt`, and `eventCount`. Track B may also
write a `sourceStatus` object for `usgs` and `firms`; the API preserves it.
See [the API handoff](../../apps/api/README.md#health-and-source-status) for the
format. A successful warehouse read does not imply fresh sensor feeds.

Every file is replaced atomically. The files are not a transaction, so metadata
can lag if a write fails. Coordinate producer writes and use one API worker.

On warehouse failure, the API tries snapshots, then `data/fixtures/`. With no
warehouse configured or `fixture=1`, fixtures take priority. Invalid rows are
skipped using the shared schemas in `packages/schema/`.

Track B's #7 currently names `data/fixtures/events.json` as its output. Confirm
the producer path and metadata handoff before enabling live ingestion.
