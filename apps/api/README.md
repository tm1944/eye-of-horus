# Hypothesis Globe API

Serves `GET /events` from TigerData `mart.event` when `DATABASE_URL` is set and the database answers. Otherwise it serves the last-good `data/snapshots` copy, then `data/fixtures`. Fixture mode needs no database URL.

## Run

Python 3.12+. Copy `.env.example` to `.env` at the repo root and leave `DATABASE_URL` empty for fixtures.

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
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

Put secrets in the repo-root `.env`. That file is gitignored. Process variables take precedence, then `.env`, then legacy `.env.local`. Restart the API after changing configuration. GitHub Actions secrets are available to configured workflows, not automatically to this local process.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | For live data | TigerData Postgres URL. Unset means fixtures. |
| `FIRMS_MAP_KEY` | For FIRMS only | USGS and GDACS ingest run without it. |
| `INGEST_SECRET` | For ingest | Shared secret for `POST /ingest/run`. |
| `INGEST_COMMAND` | No | JSON argument array override; defaults to `python -m jobs.ingest` when the database is configured. |
| `INGEST_TIMEOUT_SECONDS` | No | Default 60, allowed 1–300 seconds. |
| `CORS_ORIGIN` or `VITE_ORIGIN` | No | Defaults to `http://127.0.0.1:43123`. |

Child output is discarded and never returned to the caller. Test the loader
standalone when diagnosing its failures. Do not trigger ingestion during the pitch.

- `GET /health` runs `SELECT 1` when `DATABASE_URL` is set and returns `database` (`ok`, `fixture`, `error`, or `dark`), `warmupMs`, and `lastIngestAt`.
- `GET /events` returns `sourceStatus.database`. A dark database falls back to the snapshot, then fixtures. A hard `503` happens only when no cache exists.
- `POST /ingest/run` requires `INGEST_SECRET`. It loads USGS and GDACS, and FIRMS when `FIRMS_MAP_KEY` is set.

The shared database already has its schema and loaded events. Do not apply the schema or reload sources just to run the app. Get its connection URL from the service owner and set `DATABASE_URL` locally.

`/health` also reports `dataSource`, `usingFixtures`, and `sourceStatus`. A usable fallback can report `ok: true` while `database` reports an outage. Sensor status is `unknown` unless producer metadata is available; fixtures report `fixture`.

Live events and links are schema-validated before replacing atomic snapshots. Reads load the complete dataset before filtering and pagination. This preserves fallback data but assumes a demo-sized dataset. Database connections require TLS, have a five-second connection timeout, and use a ten-second statement timeout.

The ingestion runner rejects concurrent runs within one API process, enforces a timeout, and discards child output. Responses are 401 for invalid authentication, 409 when busy, 502 for loader failure, 503 for missing configuration, and 504 for timeout. Run one API worker for this demo.

Run tests with `python -m unittest discover -s tests -v` from `apps/api`.
