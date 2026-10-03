# Hypothesis Globe API

Track C serves events and links from TigerData MART, with snapshots and bundled
fixtures as fallback. It also reports data availability and runs a configured
Track B ingestion command.

## Run

Use Python 3.12+. Leave `DATABASE_URL` unset for fixtures.

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 43124
```

To load the ignored repository-local configuration, add
`--env-file ../../.env.local` to the `uvicorn` command. It holds the supplied
FIRMS key under `FIRMS_MAP_KEY`; the API passes its environment to the ingestion
process. The API itself does not call FIRMS. Keep this file local and never put
these values in `VITE_*` variables.

## Verify

```bash
python -m unittest discover -s tests -v
curl http://127.0.0.1:43124/health
curl 'http://127.0.0.1:43124/events?fixture=1'
curl http://127.0.0.1:43124/events/usgs:us7000example
curl http://127.0.0.1:43124/events/usgs:us7000example/links
```

Tests use temporary caches, simulated warehouse responses, and real local child
processes for ingestion. They need no credentials and make no external requests.
Call `/health` before the demo to warm the warehouse and check event availability.

## Environment

| Variable | Purpose |
| --- | --- |
| `CORS_ORIGIN` or `VITE_ORIGIN` | Comma-separated allowed origins; default `http://127.0.0.1:43123` and its localhost equivalent |
| `DATABASE_URL` | Unset means fixtures; set enables warehouse reads |
| `FIRMS_MAP_KEY` | NASA FIRMS credential for Track B's loader; server-side only |
| `INGEST_SECRET` | Shared secret accepted through `Authorization: Bearer` or `X-Ingest-Secret` |
| `INGEST_COMMAND` | JSON array of executable and arguments, configured on the server |
| `INGEST_TIMEOUT_SECONDS` | Loader timeout, default 60; allowed range 1 to 300 |

## Event and link reads

The database adapter uses Psycopg 3 with TLS required, a five-second connection
timeout and a ten-second statement timeout. Supply the TigerData PostgreSQL
connection URL in `DATABASE_URL`. See [TigerData's Python guide](https://www.tigerdata.com/learn/building-python-apps-with-postgresql-and-psycopg3)
and [Psycopg usage](https://www.psycopg.org/psycopg3/docs/basic/usage.html).
Driver exception text and connection credentials are never included in API errors.

The proposed Track B read contract is `mart.event`, `mart.event_link`, and
`raw.ingest_batch` with a `pulled_at` timestamp. Event/Link columns may use the
shared camelCase names or their snake_case forms. `entities` should be JSONB;
Psycopg decodes it as JSON. These table names still need confirmation against
Track B's TigerData DDL. The API creates no database objects.

This pivot changes `sourceStatus.snowflake` and `/health.snowflake` to
`sourceStatus.tigerdata` and `/health.tigerdata`. Track A must use the new keys.
The existing `warehousePing` field stays unchanged for now.

`GET /events` accepts `types`, `start`, `end`, `minSignificance`, `limit`, `cursor`,
and `fixture=1`. `start` is inclusive; `end` is exclusive. Both require a timezone.
Invalid timestamps and reversed ranges return `422`. The default page size is
2,000; the maximum is 8,000.

Follow `nextCursor` with the same filters until it is `null`. A cursor refers to
the current filtered dataset. If that dataset changes, the API returns `409`;
restart without a cursor. Invalid cursors return `422`.

The API loads the complete weekend dataset before filtering and pagination, so
small requests do not shrink the fallback snapshot. This design assumes Track B
keeps the MART dataset suitable for the demo. Larger datasets will need SQL
filtering and a separate snapshot exporter.

`GET /events/{id}` returns one event. `GET /events/{id}/links` reads
`MART.EVENT_LINK` when live events are available. Successful link reads refresh
`data/snapshots/links.json`; failures use cached links, then fixtures. Unknown
event IDs return `404`. Event and link fields retain their shared schema names.

Live and cached rows must match `packages/schema/*.schema.json`. Invalid live
rows never overwrite the last-good snapshot. Invalid caches are skipped. If no
usable fallback exists, the API returns `503` naming the failing source.
A successful query with zero rows is a valid empty dataset, not an outage. It
returns no events and replaces the event snapshot with an empty array. The map
should show its empty state rather than display old events as current ones.

## Health and source status

`GET /health` runs `SELECT 1`, reads the last ingest time, and checks that
`MART.EVENT` is readable and matches the Event schema. It returns `ok`,
`warehousePing`, `tigerdata`, `lastIngestAt`, `dataSource`, `sourceStatus`, and
`detail`. `ok` means events are available from the warehouse or a valid cache.
A warehouse failure can therefore return `ok: true` with `tigerdata: error` and
`dataSource: fixture` or `snapshot`. `usingFixtures` is true only for fixtures.
This check does not prove that all source feeds are fresh or link data is valid.

`sourceStatus` reports `usgs`, `firms`, and `tigerdata`. Bundled sensor data is
`fixture`. Warehouse/snapshot sensor status uses the producer's last report in
`data/snapshots/meta.json`, or `unknown` if absent. It is not inferred from a
successful warehouse connection. Track B can publish this metadata atomically:

```json
{
  "lastIngestAt": "2026-10-03T14:00:00Z",
  "sourceStatus": { "usgs": "ok", "firms": "error" }
}
```

Allowed producer statuses are `ok`, `error`, `dark`, and `unknown`. API snapshot
refreshes preserve these fields and add `savedAt` and `eventCount`. Each file is
replaced atomically; events, links, and metadata are not one transaction. Use a
single API worker for the weekend setup and coordinate producer writes.

## Ingestion handoff

`POST /ingest/run` authenticates first, then executes `INGEST_COMMAND` from the
repository root with the server's environment. It accepts no command or arguments
from the request. The command runs without a shell. Configure it using Track B's
actual executable and arguments once that loader is available.

The loader must exit zero on success and nonzero on failure. It owns writing
normalized events to TigerData or the agreed local file and publishing metadata.
The API does not invent a last-ingest timestamp when the loader omits it.

- `200` with `status: completed` means the configured process exited successfully.
- `401` means the secret is missing or incorrect.
- `409` means another ingestion process is running in this API worker.
- `502` means the loader exited unsuccessfully.
- `503` means the command is absent, invalid, or could not start.
- `504` means the loader exceeded its timeout. Loaders should not spawn detached jobs.

Child output is discarded and never returned to the caller. Test the loader
standalone when diagnosing its failures. Do not trigger ingestion during the pitch.

## Remaining team checks

Track B must confirm the DDL, credentials, loader command, and snapshot path.
The supplied FIRMS key supports both Global and US/Canada, with the stated
budget of 5,000 transactions per 10 minutes. Track B must enforce that shared
budget and downsample before serving map data; no FIRMS requests were made here.
Issue #7 currently names `data/fixtures/events.json`; the API writes last-good
warehouse reads to `data/snapshots/`. Both paths are supported, but fixture mode
labels fixture data accordingly. Track D must supply actual EventLink rows in
MART or matching local JSON. Track A must handle pagination, degraded health,
and `unknown` source status. Live services still need an integration run.
