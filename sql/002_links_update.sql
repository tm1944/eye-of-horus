-- Add link text columns when an older mart.event_link exists without them.
-- sql/001_init.sql already creates these columns on a fresh database.

ALTER TABLE mart.event_link ADD COLUMN IF NOT EXISTS rationale text;
ALTER TABLE mart.event_link ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]'::jsonb;
