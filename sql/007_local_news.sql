-- Local news by country: publishers, their RSS feeds, and every feed item seen.
-- Safe to re-run (idempotent).
--
-- Apply with:
--   psql "$DATABASE_URL" -f sql/007_local_news.sql
--
-- Filled by jobs/news/directory.py (publishers + feeds) and jobs/ingest/rss.py (items).
-- Items wait in raw.feed_item as 'pending' until enrichment (summary, geocode, category, and
-- the locality check: is the story about the publisher's own country?) promotes them into
-- mart.event or rejects them.

CREATE TABLE IF NOT EXISTS mart.publisher (
  publisher_id   text PRIMARY KEY,                    -- 'pub:yle.fi'
  name           text NOT NULL,
  domain         text NOT NULL UNIQUE,
  country_iso3   text NOT NULL,                       -- where the outlet is based: "news from X"
  languages      text[] NOT NULL DEFAULT '{}',
  scope          text NOT NULL DEFAULT 'national',    -- national | regional | local
  directory      text NOT NULL,                       -- awesome-rss | mediacloud | wikidata | manual
  status         text NOT NULL DEFAULT 'approved',    -- candidate | approved | rejected | paused
  vetting        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mart.feed (
  feed_url        text PRIMARY KEY,
  publisher_id    text NOT NULL REFERENCES mart.publisher (publisher_id) ON DELETE CASCADE,
  title           text,
  etag            text,                               -- conditional GET
  last_modified   text,
  last_fetched_at timestamptz,
  last_item_at    timestamptz,
  last_status     text,                               -- ok | not_modified | error: …
  error_count     integer NOT NULL DEFAULT 0,         -- consecutive failures; paused past a limit
  poll_minutes    integer NOT NULL DEFAULT 60
);
CREATE INDEX IF NOT EXISTS feed_publisher ON mart.feed (publisher_id);

CREATE TABLE IF NOT EXISTS raw.feed_item (
  item_id        text PRIMARY KEY,                    -- sha1 of the canonical article URL
  feed_url       text NOT NULL REFERENCES mart.feed (feed_url) ON DELETE CASCADE,
  publisher_id   text NOT NULL,
  country_iso3   text NOT NULL,                       -- the publisher's country, copied for queries
  url            text NOT NULL,
  title          text NOT NULL,
  summary        text,
  image_url      text,
  language       text,
  published_at   timestamptz,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'pending',     -- pending | ingested | rejected | duplicate
  verdict        jsonb                                -- enrichment / locality result, kept for audit
);
CREATE INDEX IF NOT EXISTS feed_item_pending ON raw.feed_item (status, country_iso3, published_at DESC);
