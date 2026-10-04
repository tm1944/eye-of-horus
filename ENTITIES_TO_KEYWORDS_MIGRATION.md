# Migration: Entities → Keywords

## Summary of Changes

We've migrated from **Named Entity Recognition (NER)** to **comprehensive keyword extraction** for better search, categorization, and API functionality.

---

## What Changed?

### Field Name
- **Old:** `entities`
- **New:** `keywords`

### Purpose
- **Old:** Extract WHO/WHERE (people, organizations, places only)
- **New:** Extract WHAT the article is about (topics, themes, concepts) + WHO/WHERE

### Format
**Old (Entities):**
```json
{
  "entities": [
    {"type": "person", "text": "President Biden", "confidence": 0.95},
    {"type": "org", "text": "Turkish Football Federation", "confidence": 0.98}
  ]
}
```

**New (Keywords):**
```json
{
  "keywords": [
    {"text": "corruption", "relevance": 0.95, "type": "topic"},
    {"text": "football", "relevance": 0.90, "type": "industry"},
    {"text": "Turkey", "relevance": 0.92, "type": "location"},
    {"text": "Turkish Football Federation", "relevance": 0.88, "type": "organization"},
    {"text": "sports governance", "relevance": 0.85, "type": "concept"},
    {"text": "arrest", "relevance": 0.80, "type": "event"}
  ]
}
```

---

## Files Changed

### 1. `jobs/llm/enrich.py`
- ✅ Updated prompt to extract keywords with examples
- ✅ Changed field from `entities` to `keywords`
- ✅ Updated logging to show top 3 keywords
- ✅ Extracts 8-15 keywords per event

### 2. `jobs/ingest/normalize.py`
- ✅ Changed initialization from `"entities": []` to `"keywords": []`
- ✅ Applied to both `normalize_gnews()` and `normalize_wikifeeds()`

### 3. `sql/004_location_specificity.sql`
- ✅ Added migration to rename column: `ALTER TABLE MART.EVENT RENAME COLUMN entities TO keywords`
- ✅ Includes optional separate table approach for better search performance

### 4. Documentation
- ✅ `ENRICHMENT_CHANGES.md` - Updated to explain keywords
- ✅ `KEYWORD_EXTRACTION_RESEARCH.md` - Full research on keyword extraction
- ✅ This file - Migration guide

---

## Keyword Types

| Type | Description | Examples |
|------|-------------|----------|
| `topic` | What article is about | "artificial intelligence", "climate change", "corruption" |
| `entity` | Specific items | "referee", "earthquake", "election" |
| `concept` | Abstract themes | "sports governance", "sustainability", "innovation" |
| `location` | Geographic places | "Turkey", "San Francisco", "Tokyo" |
| `technology` | Specific technologies | "GPT-5", "CRISPR", "blockchain" |
| `event` | Events or actions | "arrest", "summit", "protest", "merger" |
| `industry` | Relevant sectors | "healthcare", "finance", "technology", "sports" |
| `organization` | Named organizations | "OpenAI", "NATO", "Turkish Football Federation" |
| `person` | Named individuals | "President Biden", "Elon Musk" |

---

## API Benefits

### Old (Entities Only)
```
GET /feed?search=corruption
❌ No results (entities don't capture topics)

GET /feed?entity=Turkey
✅ Works (but limited to named entities)
```

### New (Keywords)
```
GET /feed?search=corruption
✅ Finds all corruption-related articles

GET /feed?keywords=artificial+intelligence
✅ Finds all AI articles

GET /feed?location=Turkey&topic=corruption
✅ Multi-faceted filtering

GET /feed?industry=healthcare&concept=innovation
✅ Complex queries
```

---

## Database Migration

### Option 1: Rename Column (Simple)
```sql
-- If using VARIANT array storage
ALTER TABLE MART.EVENT RENAME COLUMN entities TO keywords;
```

### Option 2: Separate Table (Better for Search)
```sql
-- For production - better indexing and search performance
CREATE TABLE MART.EVENT_KEYWORD (
  event_id VARCHAR NOT NULL,
  keyword TEXT NOT NULL,
  relevance FLOAT NOT NULL,
  type VARCHAR(20) NOT NULL,
  created_at TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, keyword),
  FOREIGN KEY (event_id) REFERENCES MART.EVENT(id)
);

CREATE INDEX idx_keyword ON MART.EVENT_KEYWORD(keyword);
CREATE INDEX idx_type ON MART.EVENT_KEYWORD(type);
CREATE INDEX idx_relevance ON MART.EVENT_KEYWORD(relevance);
```

**Recommendation:** Start with Option 1, migrate to Option 2 when scaling search.

---

## Example Output

### Before (Entities)
```
[enrich] 1. gnews:abc123
         Title: Turkey football ref chief jailed...
         - entities: 2 extracted
```

### After (Keywords)
```
[enrich] 1. gnews:abc123
         Title: Turkey football ref chief jailed...
         - keywords: 8 extracted (corruption, football, Turkey...)
```

Shows top 3 keywords in parentheses for quick visibility.

---

## LLM Prompt Changes

### Old Prompt
```
entities (array): Extract named entities mentioned
- Format: {"type": "place|org|person|event", "text": "...", "confidence": 0.0-1.0}
```

### New Prompt
```
keywords (array): Extract 8-15 relevant keywords for search and categorization

Guidelines:
- Include diverse mix: broad topics (2-3) + specific terms (5-7) + named entities (3-5)
- Types: topic, entity, concept, location, technology, event, industry, organization, person
- Avoid generic words: "news", "article", "report", "story", "today"
- Include what the article is ABOUT, not just what's mentioned
- Relevance 0.6-1.0 (only include if central or highly relevant)

Examples:
[3 worked examples provided in prompt - see enrich.py]
```

---

## Testing Checklist

- [ ] Run migration SQL on database
- [ ] Clear existing events: `echo "[]" > data/fixtures/events.json`
- [ ] Run fresh ingestion: `python -m jobs.ingest.run_ingest`
- [ ] Enable AI enrichment: Set `GOOGLE_API_KEY` in `.env`
- [ ] Run enrichment on sample events (3-5 events)
- [ ] Verify keyword extraction quality
- [ ] Check logging shows keywords correctly
- [ ] Full ingestion with all 101 events
- [ ] Update API to support keyword filtering
- [ ] Test keyword search endpoints

---

## Rollback Plan

If you need to rollback:

```sql
-- Rollback database change
ALTER TABLE MART.EVENT RENAME COLUMN keywords TO entities;
```

```bash
# Rollback code (git)
git checkout HEAD -- jobs/llm/enrich.py
git checkout HEAD -- jobs/ingest/normalize.py
```

---

## Next Steps

1. ✅ Code updated
2. ✅ Documentation updated
3. ⏳ Run database migration
4. ⏳ Test on sample events
5. ⏳ Run full enrichment
6. ⏳ Update API to support keyword filtering
7. ⏳ Add keyword search endpoints
8. ⏳ Build user interest matching based on keywords
