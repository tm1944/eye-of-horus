# Hypothesis Globe API

FastAPI slice for issue #2. Serves `GET /events` from `data/fixtures` when `SNOWFLAKE_ACCOUNT` is unset or `?fixture=1`.

## Run

Python 3.12+. Leave `SNOWFLAKE_ACCOUNT` unset.

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 43124
```

## Smoke

```bash
curl http://127.0.0.1:43124/health
curl 'http://127.0.0.1:43124/events?fixture=1'
curl http://127.0.0.1:43124/events/usgs:us7000example
curl http://127.0.0.1:43124/events/usgs:us7000example/links
```

## Env

| Variable | Required | Notes |
| --- | --- | --- |
| `CORS_ORIGIN` or `VITE_ORIGIN` | No | Defaults to `http://127.0.0.1:43123` (plus `localhost` twin) |
| `SNOWFLAKE_ACCOUNT` | No | Unset → fixtures. Set without MART wiring → `501` unless `?fixture=1` |

Pinned: `fastapi[standard]==0.142.2`. No Snowflake or Gemini calls in this PR.
