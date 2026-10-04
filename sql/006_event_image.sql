-- Article thumbnail for news events, shown in headline and detail cards.
-- Safe to re-run (idempotent).
--
-- Apply with:
--   psql "$DATABASE_URL" -f sql/006_event_image.sql
--
-- Filled at ingest (GNews `image`, Wikipedia page thumbnail) and, for rows ingested
-- before this column existed, by jobs/ingest/backfill_images.py. Null when the source
-- has no image; the API exposes it as `imageUrl`.

ALTER TABLE mart.event ADD COLUMN IF NOT EXISTS image_url text;
