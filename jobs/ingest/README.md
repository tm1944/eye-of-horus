# Part D — News Event Ingest Pipeline

## What this module delivers

| File | Purpose |
| --- | --- |
| `run_ingest.py` | CLI entry point. Scrape → normalise → enrich → dedup → persist. |
| `normalize.py` | Maps raw scraper output to the shared Event schema shape. |
| `scrapers/gnews.py` | GNews top-headlines scraper (9 categories, 100 req/day free tier). |
| `scrapers/wikifeeds.py` | Wikipedia Featured Feed current-events scraper (~10 items/day, no key required). |

AI enrichment (`jobs/llm/enrich.py`) and deduplication (`jobs/llm/deduplicate.py`) are part of Part D but live in the `llm` package because they use Gemini.

---

## Setup

```bash
pip install -r jobs/ingest/requirements.txt
pip install -r jobs/llm/requirements.txt   # for AI enrichment
```

**Required environment variables**

| Variable | Required for | Notes |
| --- | --- | --- |
| `GNEWS_API_KEY` | GNews scraper | Without it, GNews is silently skipped |
| `GOOGLE_API_KEY` | Gemini enrichment + dedup | Without it, events are persisted without enrichment |
| `GOOGLE_GEOCODING_KEY` | Geocoding verification | Falls back to `GOOGLE_API_KEY` if unset |
| `SNOWFLAKE_*` | Live DB writes | Without them, new events are appended to `data/fixtures/events.json` |

---

## Running

```bash
# Default: all sources, last 24 hours
python -m jobs.ingest.run_ingest

# Preview what would be ingested (no writes)
python -m jobs.ingest.run_ingest --dry-run

# Only GNews, last 12 hours
python -m jobs.ingest.run_ingest --sources gnews --hours 12

# Only Wikifeeds
python -m jobs.ingest.run_ingest --sources wikifeeds
```

---

## Pipeline stages

```
Scrape (GNews + Wikifeeds)
  │
  ▼
Normalise → Event schema shape (lat/lng = None, geoSource = llm_hint)
  │
  ▼
URL dedup (drop exact-URL duplicates before hitting Gemini)
  │
  ▼
AI Enrich (jobs/llm/enrich.py)
  │  Gemini: placeText, layerId, summary, entities, significance
  │  Google Geocoding: placeText → lat/lng
  ▼
AI Dedup (jobs/llm/deduplicate.py)
  │  Stage 1: cheap blocking (time + geo/title)
  │  Stage 2: Gemini verification (confidence ≥ 0.8 to merge)
  │  Duplicates get canonicalId set; links[] arrays are merged
  ▼
Persist
  │  Snowflake: MERGE INTO MART.EVENT
  │  Fixture: append to data/fixtures/events.json
  ▼
Cleanup
   Soft-delete: set archived_at on events older than --hours
   Hard-delete: remove archived events older than 2× --hours
```

---

## Event schema changes (sql/003_events_update.sql)

Run this after `sql/001_init.sql`:

```sql
ALTER TABLE MART.EVENT ADD COLUMN IF NOT EXISTS links        VARIANT;
ALTER TABLE MART.EVENT DROP COLUMN IF EXISTS  source_url;
ALTER TABLE MART.EVENT ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMP_TZ;
ALTER TABLE MART.EVENT ADD COLUMN IF NOT EXISTS canonical_id VARCHAR;
```

`links` is a VARIANT array of `{url, source, label}` objects.  
`archived_at` is set by the pipeline when an event ages past the recency window.  
`canonical_id` is set on duplicate events to point to the winning canonical record.

---

## Data sources

### GNews
- 9 categories: general, world, nation, business, technology, entertainment, sports, science, health
- Free tier: 100 requests/day (9 per ingest run)
- No native coordinates — all events go through AI enrichment for geo
- `GNEWS_API_KEY` required

### Wikifeeds (Wikipedia Featured Feed)
- `https://en.wikipedia.org/api/rest_v1/feed/featured/{yyyy}/{mm}/{dd}`
- ~10 current-events stories per day, no API key required
- No native coordinates — all events go through AI enrichment for geo
- layerId defaults to `news`; Gemini enrichment assigns the specific layer

---

## Layer IDs (23 values)

`earthquake`, `wildfire`, `conflict`, `politics`, `terror`, `finance`, `humanitarian`,
`news`, `world`, `business`, `technology`, `science`, `health`, `environment`, `crime`,
`sports`, `entertainment`, `culture`, `fashion`, `travel`, `food`, `education`, `media`

GNews covers: `news`, `world`, `politics`, `business`, `technology`, `entertainment`, `sports`, `science`, `health`  
Wikifeeds + Gemini can surface any layer.  
Geo-political layers (`earthquake`, `wildfire`, `conflict`, etc.) come from the existing ingest pipeline (Student B).

---

## Dependencies on other team members

### Student B (Snowflake schema)
- Run `sql/003_events_update.sql` after `sql/001_init.sql` — adds `links VARIANT`, `archived_at`, `canonical_id`
- The `source_url` column is dropped in that migration

### Student C (FastAPI)
No new endpoints needed — the existing `/feed` and `/feed/pins` endpoints serve ingest output automatically once events are in the DB.

### Student A (Frontend)
No changes needed for the scraper pipeline.
