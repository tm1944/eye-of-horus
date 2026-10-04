# Hypothesis Globe API

Serves `GET /events` from TigerData `mart.event` when `DATABASE_URL` is set and the database answers. Otherwise it serves the last-good `data/snapshots` copy, then `data/fixtures`. Fixture mode needs no database URL.

## Run

Python 3.12+. Copy `.env.example` to `.env` at the repo root and leave `DATABASE_URL` empty for fixtures.

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 43124
```

```bash
curl http://127.0.0.1:43124/health
curl "http://127.0.0.1:43124/events?fixture=1"
curl http://127.0.0.1:43124/events/usgs:us7000example
curl http://127.0.0.1:43124/events/usgs:us7000example/links
```

## Env

Put secrets in the repo-root `.env`. That file is gitignored.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | For live data | TigerData Postgres URL. Unset means fixtures. |
| `FIRMS_MAP_KEY` | For FIRMS only | USGS and GDACS ingest run without it. |
| `INGEST_SECRET` | For ingest | Shared secret for `POST /ingest/run`. |
| `CORS_ORIGIN` or `VITE_ORIGIN` | No | Defaults to `http://127.0.0.1:43123`. |

Child output is discarded and never returned to the caller. Test the loader
standalone when diagnosing its failures. Do not trigger ingestion during the pitch.

- `GET /health` runs `SELECT 1` when `DATABASE_URL` is set and returns `database` (`ok`, `fixture`, `error`, or `dark`), `warmupMs`, and `lastIngestAt`.
- `GET /events` returns `sourceStatus.database`. A dark database falls back to the snapshot, then fixtures. A hard `503` happens only when no cache exists.
- `POST /ingest/run` requires `INGEST_SECRET`. It loads USGS and GDACS, and FIRMS when `FIRMS_MAP_KEY` is set.

Create the tables after `DATABASE_URL` is filled in:

```bash
python -m jobs.ingest.apply_schema
python -m jobs.ingest
```

Pinned: `fastapi[standard]==0.142.2`, `psycopg[binary]==3.2.13`.
