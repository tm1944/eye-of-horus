-- Migration: add rationale and citations to MART.EVENT_LINK
-- Run after sql/001_init.sql has created the EVENT_LINK table.

ALTER TABLE MART.EVENT_LINK ADD COLUMN IF NOT EXISTS rationale  VARCHAR;
ALTER TABLE MART.EVENT_LINK ADD COLUMN IF NOT EXISTS citations  VARIANT;
