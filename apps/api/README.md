# Hypothesis Globe API

Track C FastAPI for issues #2 and #9. Serves `GET /events` from Snowflake MART when
configured and healthy; otherwise last-good `data/snapshots` or `data/fixtures`.
Fixture mode needs **zero** Snowflake env.

## Run

Python 3.12+. Leave `SNOWFLAKE_ACCOUNT` unset for fixtures.

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 43124
```

Warm the warehouse before the pitch room fills:

```bash
curl http://127.0.0.1:43124/health
```

## Smoke

```bash
# Fixture mode (SNOWFLAKE_ACCOUNT unset)
curl http://127.0.0.1:43124/health
curl 'http://127.0.0.1:43124/events?fixture=1'
curl http://127.0.0.1:43124/events/usgs:us7000example
curl http://127.0.0.1:43124/events/usgs:us7000example/links

# Ingest stub (expects 401 without secret)
curl -i -X POST http://127.0.0.1:43124/ingest/run
curl -i -X POST http://127.0.0.1:43124/ingest/run \
  -H "Authorization: Bearer $INGEST_SECRET"
```

Bad Snowflake config still serves the globe from cache and names the problem in
`sourceStatus.snowflake` (`error` or `dark`) plus `/health.detail`.

## Env

| Variable | Required | Notes |
| --- | --- | --- |
| `CORS_ORIGIN` or `VITE_ORIGIN` | No | Defaults to `http://127.0.0.1:43123` (plus `localhost` twin) |
| `SNOWFLAKE_ACCOUNT` | No | Unset → fixtures. Set → optional connector path (ping + MART read) |
| `SNOWFLAKE_USER` | With account | Required when account is set |
| `SNOWFLAKE_PASSWORD` | With account | Required when account is set |
| `SNOWFLAKE_WAREHOUSE` | With account | Required when account is set |
| `SNOWFLAKE_DATABASE` | No | Defaults to `EVENTS` |
| `SNOWFLAKE_SCHEMA` | No | Defaults to `MART` |
| `SNOWFLAKE_ROLE` | No | Optional role |
| `INGEST_SECRET` | For ingest | Shared secret for `POST /ingest/run` (`Authorization: Bearer` or `X-Ingest-Secret`) |

## Behavior

- `GET /health` — `SELECT 1` warmup when Snowflake is configured; returns `lastIngestAt` (or `null` in fixture mode), `warehousePing`, and `detail`.
- `GET /events` — `sourceStatus` for `usgs` / `firms` / `snowflake` (`ok` \| `fixture` \| `error` \| `dark`). Event field names are not reshaped.
- Snowflake dark or misconfigured → last-good snapshot, else fixtures. Hard `503` only if no cache exists; `failingSource` names the problem.
- `POST /ingest/run` — auth gate only in this PR. Stub returns `status: noop` until track B loaders land. Do not click during the pitch.

Pinned: `fastapi[standard]==0.142.2`, `snowflake-connector-python==4.7.3`.
