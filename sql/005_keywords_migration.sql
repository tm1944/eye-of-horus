-- Rename entities column to keywords in mart.event
-- Safe to re-run (idempotent)
--
-- Apply with:
--   psql "$DATABASE_URL" -f sql/005_keywords_migration.sql
--
-- Context:
--   - News events will have populated keywords arrays
--   - Disasters will have empty arrays (no enrichment needed)
--   - All disaster data is in structured fields (category, magnitude, etc.)

-- Check if column exists before renaming
DO $$
BEGIN
    -- If entities column exists, rename it to keywords
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'mart'
          AND table_name = 'event'
          AND column_name = 'entities'
    ) THEN
        ALTER TABLE mart.event RENAME COLUMN entities TO keywords;
        RAISE NOTICE 'Renamed entities → keywords';
    ELSE
        RAISE NOTICE 'Column entities does not exist (already renamed or never existed)';
    END IF;

    -- Verify keywords column exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'mart'
          AND table_name = 'event'
          AND column_name = 'keywords'
    ) THEN
        RAISE EXCEPTION 'keywords column does not exist after migration';
    END IF;
END $$;

-- Update column comment
COMMENT ON COLUMN mart.event.keywords IS
  'Searchable keywords/tags extracted from event data. Populated for news events (topics, entities, concepts). Empty for disasters (use structured fields instead).';
