-- Migration: expand MART.EVENT to support multi-source links, soft-delete, and deduplication
-- Run after sql/001_init.sql.

-- Replace single source_url with a VARIANT array of {url, source, label} objects
ALTER TABLE MART.EVENT ADD COLUMN IF NOT EXISTS links        VARIANT;
ALTER TABLE MART.EVENT DROP COLUMN IF EXISTS source_url;

-- Soft-delete support: set archived_at when event ages past 24h; hard-delete after 48h
ALTER TABLE MART.EVENT ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMP_TZ;

-- Deduplication: non-canonical duplicates carry a canonical_id pointing to the winner
ALTER TABLE MART.EVENT ADD COLUMN IF NOT EXISTS canonical_id VARCHAR;
