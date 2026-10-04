-- Migration: Add location specificity tracking and keywords
-- Run this after 003_events_update.sql

-- Add locationSpecificity column to track how precise the location is
ALTER TABLE MART.EVENT ADD COLUMN IF NOT EXISTS location_specificity VARCHAR(20);

-- Valid values: 'global', 'continent', 'country', 'region', 'city', 'precise'
-- This tracks how specific the AI was able to determine the event location:
--   - 'global': No specific location (e.g., scientific discovery, tech product)
--   - 'continent': Only continent known (rare)
--   - 'country': Narrowed to country only
--   - 'region': Narrowed to state/province/region
--   - 'city': Narrowed to city/town
--   - 'precise': Specific building/street/venue

-- Update geo_precision to match location_specificity for consistency
-- (geo_precision was previously hardcoded to 'city', now it reflects actual specificity)

-- Rename entities column to keywords (if using VARIANT approach)
-- Keywords are searchable tags/topics extracted from the article
-- Format: [{"text": "keyword", "relevance": 0.0-1.0, "type": "topic|entity|..."}]
ALTER TABLE MART.EVENT RENAME COLUMN entities TO keywords;

-- Alternative: If you want a separate table for better search performance
-- (Uncomment if you prefer indexed keyword search over VARIANT)
/*
CREATE TABLE IF NOT EXISTS MART.EVENT_KEYWORD (
  event_id VARCHAR NOT NULL,
  keyword TEXT NOT NULL,
  relevance FLOAT NOT NULL,
  type VARCHAR(20) NOT NULL,
  created_at TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, keyword),
  FOREIGN KEY (event_id) REFERENCES MART.EVENT(id)
);

CREATE INDEX IF NOT EXISTS idx_keyword ON MART.EVENT_KEYWORD(keyword);
CREATE INDEX IF NOT EXISTS idx_type ON MART.EVENT_KEYWORD(type);
CREATE INDEX IF NOT EXISTS idx_relevance ON MART.EVENT_KEYWORD(relevance);
*/
