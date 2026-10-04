# Unified Data Pipeline Architecture

## Current State Analysis

### ✅ What Already Exists

**Natural Disaster Ingestion** (`jobs/ingest/run.py`):
- ✅ USGS earthquakes → TigerData
- ✅ GDACS (earthquakes, cyclones, floods, volcanoes, droughts, wildfires) → TigerData
- ✅ FIRMS wildfire hotspots → TigerData
- ✅ Direct database upload
- ⚠️ Minimal enrichment (just place name in `entities` field)

**News Ingestion** (`jobs/ingest/run_ingest.py`):
- ✅ GNews → JSON fixture
- ✅ Wikifeeds → JSON fixture
- ✅ AI enrichment (keywords, significance, geocoding)
- ✅ Deduplication
- ❌ Not uploaded to TigerData yet

**Linking** (`jobs/llm/links.py`):
- ✅ Event-to-event linking with Gemini
- ✅ Relations: `co_occurs`, `same_place`, `same_topic`, `reported_together`
- ✅ Writes to TigerData or fixture
- ⚠️ Only works on personalized feed (limited scope)

**API** (`apps/api/ingest_runner.py`):
- ✅ `POST /ingest/run` endpoint
- ✅ Runs configured command
- ✅ Used by contributors for natural disasters

---

## 🎯 Unified Pipeline Design

```
┌─────────────────────────────────────────────────────────────┐
│                    UNIFIED PIPELINE                          │
│              python -m jobs.pipeline                         │
│              POST /api/ingest/run                            │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   INGEST     │  │   INGEST     │  │   INGEST     │
│  DISASTERS   │  │    NEWS      │  │   (Future)   │
│              │  │              │  │              │
│ USGS, GDACS  │  │ GNews, Wiki  │  │   RSS, etc   │
│    FIRMS     │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
        │                  │
        ▼                  ▼
┌──────────────┐  ┌──────────────┐
│  NORMALIZE   │  │  NORMALIZE   │
│              │  │              │
│   To base    │  │   To base    │
│ event schema │  │ event schema │
└──────────────┘  └──────────────┘
        │                  │
        ▼                  ▼
┌──────────────┐  ┌──────────────┐
│   ENRICH     │  │   ENRICH     │
│              │  │              │
│  - Keywords  │  │  - Keywords  │
│  - Metadata  │  │  - Summary   │
│  (disaster-  │  │  - Geocode   │
│   specific)  │  │  - Dedup     │
└──────────────┘  └──────────────┘
        │                  │
        └──────────────────┼──────────────────┐
                           ▼                  ▼
                   ┌──────────────┐  ┌──────────────┐
                   │   UPLOAD     │  │     LINK     │
                   │              │  │              │
                   │  TigerData   │  │ News ↔ Dis.  │
                   │  mart.event  │  │ News ↔ News  │
                   └──────────────┘  └──────────────┘
```

---

## 📋 Pipeline Stages

### Stage 1: Ingestion
**Purpose:** Fetch raw data from sources

**Disaster Sources:**
- USGS: Recent significant earthquakes
- GDACS: Multi-disaster alert system
- FIRMS: Wildfire hotspot satellite data

**News Sources:**
- GNews: 90 articles (9 categories × 10 each)
- Wikifeeds: ~18 stories per day

### Stage 2: Normalization
**Purpose:** Convert to common schema

**Common Fields:**
- `event_id`, `source`, `category`, `title`, `summary`
- `occurred_at`, `lat`, `lng`, `significance`
- `geo_precision`, `geo_source`

**Type-Specific:**
- Disasters: magnitude, depth, alert_level, population
- News: links[], layerId, locationSpecificity

### Stage 3: Enrichment

#### 🎯 Disaster Enrichment: NOT NEEDED!

**Why disasters don't need keyword enrichment:**
- ✅ Category already in `mart.event.category` (earthquake, wildfire, etc.)
- ✅ Location already in structured fields (`lat`, `lng`, `country_iso3`, `place`)
- ✅ Time already in `occurred_at`
- ✅ All metadata in structured fields (magnitude, FRP, wind speed, etc.)
- ✅ Significance/severity already computed from alert systems

**Current entities field status:**
- USGS earthquakes: Just duplicates the `place` field
- GDACS disasters: Empty array
- FIRMS wildfires: Empty array

**Conclusion:** The `entities`/`keywords` field adds NO value for disasters. All meaningful information is already in structured columns, making it redundant and wasteful.

**Decision:** Leave disasters as-is. Only enrich news events.

#### News Enrichment
**Current process (keep as-is):**
- Extract keywords (topics, entities, concepts)
- Generate summary
- Score significance
- Geocode location (OpenStreetMap)
- Deduplicate

### Stage 4: Upload to TigerData
**Purpose:** Persist enriched news data

**Schema Migration First:**
```sql
-- Rename entities → keywords (for news events)
-- Disasters can keep empty/null in this field
ALTER TABLE mart.event RENAME COLUMN entities TO keywords;
```

**Upload:**
- Disasters: Already uploaded in stage 1 (no enrichment needed)
- News: Insert new enriched events into mart.event

### Stage 5: Linking
**Purpose:** Create relationships

**Link Types:**

**News → Disaster:**
- `"reports_on"` - Article about this disaster
- `"mentions"` - Article mentions disaster
- `"analysis"` - Impact/aftermath analysis

**News ↔ News:**
- `"same_event"` - Same story, different source
- `"related_to"` - Related stories
- `"same_topic"` - Similar themes

**Process:**
1. Temporal + spatial filtering (cheap)
2. Keyword overlap check
3. Gemini verification (expensive)
4. Insert into `mart.event_link`

---

## 🏗️ New File Structure

```
jobs/
  pipeline.py                    # NEW: Master orchestrator
  
  ingest/
    run.py                       # EXISTS: Disasters → TigerData
    run_ingest.py                # EXISTS: News → JSON
    normalize.py                 # EXISTS: News normalization
    scrapers/
      gnews.py                   # EXISTS
      wikifeeds.py               # EXISTS
    __init__.py
    __main__.py
  
  llm/
    enrich.py                    # EXISTS: News enrichment
    deduplicate.py               # EXISTS: News dedup
    links.py                     # EXISTS: Event linking
    link_disasters.py            # NEW: News ↔ Disaster linking
    __init__.py
  
  tigerdata/
    upload.py                    # NEW: Upload enriched news
    client.py                    # Link to apps/api/tigerdata_client.py
    __init__.py
  
  __init__.py
```

---

## 🚀 Master Orchestrator

**File:** `jobs/pipeline.py`

```python
"""
Unified data pipeline for Hypothesis Globe.

Runs complete ingestion → enrichment → upload → linking pipeline.

Usage:
    # Full pipeline
    python -m jobs.pipeline
    
    # Run specific stages only
    python -m jobs.pipeline --ingest            # Only ingestion
    python -m jobs.pipeline --enrich            # Only enrichment
    python -m jobs.pipeline --upload            # Only upload
    python -m jobs.pipeline --link              # Only linking
    
    # Combine stages
    python -m jobs.pipeline --enrich --upload   # Enrich then upload
    python -m jobs.pipeline --ingest --enrich   # Ingest then enrich
    
    # Data type filters (combine with stage flags)
    python -m jobs.pipeline --disasters-only    # Only disaster data
    python -m jobs.pipeline --news-only         # Only news data
    python -m jobs.pipeline --enrich --disasters-only  # Enrich disasters only
"""

import argparse
import json
import sys
from pathlib import Path

def run_pipeline(
    run_ingest=True,
    run_enrich=True, 
    run_upload=True,
    run_link=True,
    disasters_only=False,
    news_only=False
):
    """Run the data pipeline with configurable stages."""
    
    results = {
        "disasters_ingest": None,
        "news_ingest": None,
        "disasters_enrich": None,
        "news_upload": None,
        "linking": None
    }
    
    process_disasters = not news_only
    process_news = not disasters_only
    
    # Stage 1: Ingestion
    if run_ingest:
        if process_disasters:
            print("\n=== Stage 1A: Ingesting Natural Disasters ===")
            from jobs.ingest.run import run_ingest as run_disaster_ingest
            results["disasters_ingest"] = run_disaster_ingest()
            print(json.dumps(results["disasters_ingest"], indent=2))
        
        if process_news:
            print("\n=== Stage 1B: Ingesting News ===")
            from jobs.ingest.run_ingest import main as run_news_ingest
            # This writes to data/fixtures/events.json and enriches
            run_news_ingest()
            results["news_ingest"] = {"status": "complete", "output": "data/fixtures/events.json"}
    
    # Stage 2: Enrichment
    if run_enrich:
        # Disasters don't need enrichment (all data already structured)
        if process_disasters:
            print("\n=== Note: Disasters don't need enrichment ===")
            print("All disaster data is already in structured fields (category, magnitude, etc.)")
        
        # News enrichment happens during ingestion (run_ingest.py)
        if process_news and not run_ingest:
            print("\n=== Note: News enrichment is part of news ingestion ===")
            print("If you want to re-enrich news, re-run with --ingest --news-only")
    
    # Stage 3: Upload
    if run_upload:
        if process_news:
            print("\n=== Stage 3: Uploading News to TigerData ===")
            from jobs.tigerdata.upload import upload_news_events
            results["news_upload"] = upload_news_events()
        
        # Disasters already uploaded during ingestion
        if process_disasters and not run_ingest:
            print("\n=== Note: Disasters uploaded during ingestion ===")
    
    # Stage 4: Linking
    if run_link:
        print("\n=== Stage 4: Generating Event Links ===")
        from jobs.llm.link_disasters import link_all_events
        results["linking"] = link_all_events()
    
    print("\n=== Pipeline Complete ===")
    print(json.dumps(results, indent=2, default=str))
    
    return results

def main():
    parser = argparse.ArgumentParser(
        description="Unified Hypothesis Globe data pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m jobs.pipeline                           # Full pipeline
  python -m jobs.pipeline --enrich --upload         # Skip ingestion, just enrich & upload
  python -m jobs.pipeline --enrich --disasters-only # Enrich disasters only
  python -m jobs.pipeline --link                    # Just run linking
        """
    )
    
    # Stage selection (if none specified, run all)
    parser.add_argument("--ingest", action="store_true", help="Run ingestion stage")
    parser.add_argument("--enrich", action="store_true", help="Run enrichment stage")
    parser.add_argument("--upload", action="store_true", help="Run upload stage")
    parser.add_argument("--link", action="store_true", help="Run linking stage")
    
    # Data type filters
    parser.add_argument("--disasters-only", action="store_true", help="Only process disaster data")
    parser.add_argument("--news-only", action="store_true", help="Only process news data")
    
    args = parser.parse_args()
    
    # If no stage flags specified, run all stages
    any_stage_specified = args.ingest or args.enrich or args.upload or args.link
    run_ingest = args.ingest if any_stage_specified else True
    run_enrich = args.enrich if any_stage_specified else True
    run_upload = args.upload if any_stage_specified else True
    run_link = args.link if any_stage_specified else True
    
    try:
        run_pipeline(
            run_ingest=run_ingest,
            run_enrich=run_enrich,
            run_upload=run_upload,
            run_link=run_link,
            disasters_only=args.disasters_only,
            news_only=args.news_only
        )
    except Exception as e:
        print(f"\nPipeline failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
```

---

## 🔧 Usage

### Command Line

```bash
# Full pipeline (all stages, all data types)
python -m jobs.pipeline

# ============================================
# Run specific stages only
# ============================================

# Only ingestion (fetch from APIs)
python -m jobs.pipeline --ingest

# Only enrichment (AI keyword extraction)
python -m jobs.pipeline --enrich

# Only upload (push to TigerData)
python -m jobs.pipeline --upload

# Only linking (create relationships)
python -m jobs.pipeline --link

# ============================================
# Combine multiple stages
# ============================================

# Skip ingestion, run enrichment + upload
python -m jobs.pipeline --enrich --upload

# Just ingest and enrich (no upload or linking)
python -m jobs.pipeline --ingest --enrich

# Enrich and link (assumes data already in DB)
python -m jobs.pipeline --enrich --link

# ============================================
# Filter by data type
# ============================================

# Only process disasters
python -m jobs.pipeline --disasters-only

# Only process news
python -m jobs.pipeline --news-only

# Enrich disasters only (skip news)
python -m jobs.pipeline --enrich --disasters-only

# Upload news only (skip disasters)
python -m jobs.pipeline --upload --news-only

# Full pipeline but only for disasters
python -m jobs.pipeline --disasters-only

# ============================================
# Common workflows
# ============================================

# Re-enrich all existing data (no new ingestion)
python -m jobs.pipeline --enrich

# Re-link all events (assumes enriched data exists)
python -m jobs.pipeline --link

# Ingest disasters, skip everything else
python -m jobs.pipeline --ingest --disasters-only

# Full news pipeline: ingest → enrich → upload → link
python -m jobs.pipeline --news-only
```

### API Endpoint

**Configure in `.env`:**
```bash
INGEST_COMMAND='["python", "-m", "jobs.pipeline"]'
```

**Trigger:**
```bash
POST /api/ingest/run
Authorization: Bearer <INGEST_SECRET>
```

---

## 📊 Environment Variables

```bash
# Database
DATABASE_URL="postgresql://..."          # TigerData connection

# API Keys
GOOGLE_API_KEY="..."                     # Gemini AI enrichment
GNEWS_API_KEY="..."                      # GNews articles
FIRMS_MAP_KEY="..."                      # NASA FIRMS (optional)

# API
INGEST_SECRET="..."                      # Auth for /ingest/run
INGEST_COMMAND='["python", "-m", "jobs.pipeline"]'
INGEST_TIMEOUT_SECONDS="600"             # 10 minutes for full pipeline
```

---

## ⚙️ Implementation Priority

### Phase 1: Inspect & Design ✅ COMPLETE
- [x] Fetch sample disaster data from TigerData
- [x] Analyze structure of each disaster type
- [x] **Decision: Disasters don't need enrichment!**
  - All meaningful data already in structured fields
  - Keywords would be redundant with category, place, magnitude, etc.

### Phase 2: Schema Migration (5 minutes)
- [ ] Create `sql/005_keywords_migration.sql`
- [ ] Rename `entities` → `keywords` in mart.event
- [ ] Leave empty/null for disasters (no enrichment needed)
- [ ] Apply to TigerData
- [ ] Verify with sample queries

### Phase 3: News Upload (1 hour)
- [ ] Create `jobs/tigerdata/upload.py`
- [ ] Map news schema → mart.event schema
- [ ] Upload 101 enriched news events
- [ ] Verify in database

### Phase 4: Enhanced Linking (2-3 hours)
- [ ] Create `jobs/llm/link_disasters.py`
- [ ] Extend existing `links.py` logic
- [ ] Add news → disaster linking
- [ ] Add filtering logic
- [ ] Batch process and upload links

### Phase 5: Unified Orchestrator (1 hour)
- [ ] Create `jobs/pipeline.py`
- [ ] Integrate all stages
- [ ] Add CLI arguments
- [ ] Test end-to-end
- [ ] Update `INGEST_COMMAND` config

---

## 🎯 Success Criteria

**After running `python -m jobs.pipeline`:**

1. ✅ All disasters in TigerData (no keyword enrichment needed)
2. ✅ All 101 news events in TigerData with keywords
3. ✅ Links created between related news articles
4. ✅ Links created between news → disasters (where applicable)
5. ✅ API endpoints serve enriched data
6. ✅ Single command runs entire pipeline
7. ✅ API endpoint triggers full pipeline

---

## 💰 Cost Estimate

**Gemini API Calls:**
- News enrichment: ~90-100 events × 1 call = already done during ingestion (~$0.10)
- News ↔ disaster linking: ~101 news × 5 candidates = 505 calls (~$0.50)
- News ↔ news linking: ~101 × 10 pairs = 1,010 calls (~$1.00)

**Total: ~$1.60 per full pipeline run** (reduced from $2.00!)

**Time: ~10-15 minutes** (faster without disaster enrichment)

---

## 🔄 Future Enhancements

1. **Incremental Updates**
   - Only enrich new/updated events
   - Skip unchanged data

2. **More Sources**
   - RSS feeds
   - NewsAPI
   - Twitter/X
   - Reddit

3. **Better Linking**
   - Semantic similarity (embeddings)
   - Entity coreference
   - Temporal reasoning

4. **Real-time Pipeline**
   - Webhook triggers
   - Stream processing
   - Live updates

---

## 📋 Next Steps

**I can create:**
1. Sample disaster data inspection script
2. Disaster enrichment module (`enrich_disasters.py`)
3. News upload module (`tigerdata/upload.py`)
4. Enhanced linking module (`link_disasters.py`)
5. Master orchestrator (`pipeline.py`)
6. All necessary SQL migrations

**Which would you like me to start with?**

Recommended order:
1. **Inspect disaster data first** (understand what we're working with)
2. Design enrichment strategy (based on actual data)
3. Implement pieces
4. Integrate into unified pipeline
