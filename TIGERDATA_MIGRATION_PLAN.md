# TigerData Migration Plan: Schema Update & Enrichment

## Current State

**Database:** TigerData (PostgreSQL + PostGIS + TimescaleDB)
- ✅ Schema applied (`001_init.sql`, `002_links_update.sql`, `003_events_update.sql`)
- ✅ Natural disaster data loaded (USGS, GDACS, FIRMS)
- ❌ Schema uses `entities` field (not `keywords`)
- ❌ Natural disasters not AI-enriched (no keywords extracted)

**Local Fixtures:**
- ✅ News events: `data/fixtures/events.json` (101 items, enriched with keywords)
- ✅ Links: `data/fixtures/links.json` (1 example link)
- ❌ Disasters: Not in fixtures (only in TigerData)

---

## Migration Goals

1. ✅ **Update schema:** `entities` → `keywords` everywhere
2. ✅ **Fetch disasters** from TigerData
3. ✅ **Enrich disasters** with keywords using Gemini
4. ✅ **Upload news events** to TigerData
5. ✅ **Create links** between news ↔ disasters
6. ✅ **Update TigerData** with enriched data

---

## Step 1: Schema Migration

### 1.1 Create SQL Migration

**File:** `sql/005_keywords_migration.sql`

```sql
-- Migration: Rename entities to keywords across all tables
-- This aligns natural disaster schema with news event schema

-- 1. Rename column in mart.event
ALTER TABLE mart.event 
  RENAME COLUMN entities TO keywords;

-- 2. Add comment for clarity
COMMENT ON COLUMN mart.event.keywords IS 
  'Searchable keywords/tags extracted from event. Format: [{"text": "...", "relevance": 0.0-1.0, "type": "topic|entity|..."}]';

-- 3. Update any existing data to match new format (if needed)
-- Current: entities jsonb (unknown format)
-- Target: keywords jsonb array of {text, relevance, type}

-- Note: If entities are currently empty [], no transformation needed
-- If entities have data, inspect first then write transformation query
```

### 1.2 Apply Migration

**Prerequisites:**
- Get `DATABASE_URL` from service owner
- Backup database first

**Command:**
```bash
# Backup first
pg_dump "$DATABASE_URL" > backup_before_keywords_migration.sql

# Apply migration
psql "$DATABASE_URL" -f sql/005_keywords_migration.sql

# Verify
psql "$DATABASE_URL" -c "\\d mart.event" | grep keywords
```

---

## Step 2: Fetch Natural Disaster Data

### 2.1 Create Fetch Script

**File:** `jobs/tigerdata/fetch_disasters.py`

```python
"""
Fetch natural disaster events from TigerData for local enrichment.
"""
import os
import json
import psycopg2
from datetime import datetime

DATABASE_URL = os.environ.get("DATABASE_URL")

def fetch_disasters():
    """Fetch all disaster events from mart.event."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    
    # Get all natural disaster events
    cur.execute("""
        SELECT 
            event_id,
            source,
            source_event_id,
            category,
            subtype,
            title,
            summary,
            info_url,
            occurred_at,
            updated_at,
            ended_at,
            lng,
            lat,
            alt_m,
            geo_precision,
            geo_source,
            significance,
            weight,
            country_iso3,
            keywords,  -- After migration, this was 'entities'
            raw_ref
        FROM mart.event
        WHERE category IN ('earthquake', 'wildfire', 'cyclone', 'flood', 'volcano', 'drought')
        ORDER BY occurred_at DESC
    """)
    
    columns = [desc[0] for desc in cur.description]
    disasters = []
    
    for row in cur.fetchall():
        event = dict(zip(columns, row))
        # Convert timestamps to ISO strings
        for field in ['occurred_at', 'updated_at', 'ended_at']:
            if event.get(field):
                event[field] = event[field].isoformat()
        disasters.append(event)
    
    cur.close()
    conn.close()
    
    return disasters

if __name__ == "__main__":
    print("Fetching natural disasters from TigerData...")
    disasters = fetch_disasters()
    
    output_path = "data/raw/disasters_from_tigerdata.json"
    os.makedirs("data/raw", exist_ok=True)
    
    with open(output_path, "w") as f:
        json.dump(disasters, f, indent=2, default=str)
    
    print(f"Fetched {len(disasters)} disasters")
    print(f"Saved to: {output_path}")
    
    # Show breakdown by category
    by_category = {}
    for d in disasters:
        cat = d['category']
        by_category[cat] = by_category.get(cat, 0) + 1
    
    print("\nBreakdown by category:")
    for cat, count in sorted(by_category.items()):
        print(f"  {cat}: {count}")
```

**Usage:**
```bash
export DATABASE_URL="postgresql://..."
python -m jobs.tigerdata.fetch_disasters
```

---

## Step 3: Enrich Natural Disasters with Keywords

### 3.1 Create Disaster Enrichment Module

**File:** `jobs/llm/enrich_disasters.py`

```python
"""
AI enrichment for natural disaster events.
Extracts keywords/tags for searchability and linking.
"""
import os
import json
import time
from google import genai

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
GEMINI_MODEL = "gemini-3.5-flash-lite"

DISASTER_ENRICH_PROMPT = """
You are analyzing a natural disaster event. Extract 8-15 searchable keywords.

EVENT:
  Type: {category}
  Title: {title}
  Summary: {summary}
  Location: {lat}, {lng}
  Country: {country_iso3}
  Significance: {significance}
  {detail_fields}

Extract keywords that capture:
- Disaster type and characteristics
- Location (country, region, city)
- Impact (casualties, damage, affected population)
- Related concepts (emergency response, evacuation, etc.)

Respond with JSON only:
{{
  "keywords": [
    {{"text": "keyword", "relevance": 0.0-1.0, "type": "topic|entity|concept|location|event"}}
  ]
}}

Guidelines:
- Include disaster type: "earthquake", "wildfire", "flood", etc.
- Include location: country, region, city names
- Include impact terms: "evacuation", "casualties", "damage"
- Include severity: "magnitude 7.2", "severe", "major"
- Relevance: 0.7-1.0 for core terms, 0.6+ for secondary
- Types: topic (themes), location (places), event (actions), concept (abstract)

Extract 8-15 keywords, most relevant first.
"""

def enrich_disaster(disaster: dict) -> dict:
    """
    Enrich a single disaster event with keywords.
    """
    if not GOOGLE_API_KEY:
        print(f"  SKIPPED: {disaster['event_id']} (no API key)")
        return disaster
    
    # Build detail fields string based on category
    detail_fields = _get_detail_fields(disaster)
    
    prompt = DISASTER_ENRICH_PROMPT.format(
        category=disaster.get('category', ''),
        title=disaster.get('title', ''),
        summary=disaster.get('summary', ''),
        lat=disaster.get('lat', ''),
        lng=disaster.get('lng', ''),
        country_iso3=disaster.get('country_iso3', 'Unknown'),
        significance=disaster.get('significance', ''),
        detail_fields=detail_fields
    )
    
    try:
        client = genai.Client(api_key=GOOGLE_API_KEY)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        result = json.loads(response.text.strip())
        
        keywords = result.get('keywords', [])
        disaster['keywords'] = keywords
        
        print(f"  ✓ {disaster['event_id']}: {len(keywords)} keywords")
        return disaster
        
    except Exception as e:
        print(f"  ✗ {disaster['event_id']}: {e}")
        return disaster

def _get_detail_fields(disaster: dict) -> str:
    """Extract category-specific detail fields for prompt."""
    category = disaster.get('category', '')
    
    if category == 'earthquake':
        return f"Magnitude: {disaster.get('magnitude', 'N/A')}, Depth: {disaster.get('depth_km', 'N/A')}km"
    elif category == 'wildfire':
        return f"Burned area: {disaster.get('burned_area_ha', 'N/A')} hectares"
    elif category == 'cyclone':
        return f"Max wind: {disaster.get('max_wind_kmh', 'N/A')} km/h, Storm: {disaster.get('storm_name', 'N/A')}"
    elif category == 'flood':
        return f"Severity: {disaster.get('severity_text', 'N/A')}"
    elif category == 'volcano':
        return f"VEI: {disaster.get('vei', 'N/A')}, Volcano: {disaster.get('volcano_name', 'N/A')}"
    elif category == 'drought':
        return f"Affected area: {disaster.get('affected_area_km2', 'N/A')} km²"
    
    return ""

def enrich_all_disasters(disasters: list[dict]) -> list[dict]:
    """
    Enrich all disasters with keywords.
    Respects rate limits (no geocoding, so faster).
    """
    print(f"Enriching {len(disasters)} disasters...")
    
    enriched = []
    for i, disaster in enumerate(disasters, 1):
        print(f"[{i}/{len(disasters)}] {disaster.get('title', '')[:50]}...")
        enriched_disaster = enrich_disaster(disaster)
        enriched.append(enriched_disaster)
        
        # Small delay to avoid rate limits
        if i < len(disasters):
            time.sleep(0.5)
    
    print(f"\nComplete: {len(enriched)} disasters enriched")
    return enriched

if __name__ == "__main__":
    import sys
    
    input_path = sys.argv[1] if len(sys.argv) > 1 else "data/raw/disasters_from_tigerdata.json"
    output_path = sys.argv[2] if len(sys.argv) > 2 else "data/enriched/disasters_enriched.json"
    
    with open(input_path) as f:
        disasters = json.load(f)
    
    enriched = enrich_all_disasters(disasters)
    
    os.makedirs("data/enriched", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(enriched, f, indent=2, default=str)
    
    print(f"\nSaved to: {output_path}")
```

**Usage:**
```bash
export GOOGLE_API_KEY="..."
python -m jobs.llm.enrich_disasters data/raw/disasters_from_tigerdata.json
```

---

## Step 4: Upload to TigerData

### 4.1 Create Upload Scripts

**File:** `jobs/tigerdata/upload_news_events.py`

```python
"""
Upload enriched news events to TigerData mart.event.
"""
import os
import json
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL")

def upload_news_events(events: list[dict]):
    """Upload news events to mart.event table."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    
    for event in events:
        # Extract source_event_id from id (e.g., "gnews:abc123" -> "abc123")
        source_event_id = event['id'].split(':', 1)[1] if ':' in event['id'] else event['id']
        
        # Get first link URL as info_url
        info_url = event['links'][0]['url'] if event.get('links') else None
        
        cur.execute("""
            INSERT INTO mart.event (
                event_id, source, source_event_id, category, subtype,
                title, summary, info_url,
                occurred_at, updated_at, ended_at,
                lng, lat, alt_m, geo_precision, geo_source,
                significance, weight, country_iso3, keywords, raw_ref
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s
            )
            ON CONFLICT (source, source_event_id) DO UPDATE SET
                updated_at = EXCLUDED.updated_at,
                summary = EXCLUDED.summary,
                keywords = EXCLUDED.keywords,
                significance = EXCLUDED.significance
        """, (
            event['id'],
            event['source'],
            source_event_id,
            event['layerId'],  # Maps to category
            None,  # subtype
            event['title'],
            event.get('summary'),
            info_url,
            event.get('occurredAt'),
            event.get('updatedAt'),
            None,  # ended_at
            event.get('lng'),
            event.get('lat'),
            event.get('altM'),
            event.get('geoPrecision'),
            event.get('geoSource'),
            event.get('significance'),
            event.get('weight'),
            None,  # country_iso3 - could derive
            json.dumps(event.get('keywords', [])),
            event.get('rawRef')
        ))
    
    conn.commit()
    cur.close()
    conn.close()
    
    print(f"Uploaded {len(events)} news events")

if __name__ == "__main__":
    with open("data/fixtures/events.json") as f:
        news_events = json.load(f)
    
    upload_news_events(news_events)
```

**File:** `jobs/tigerdata/upload_disaster_keywords.py`

```python
"""
Update disaster events in TigerData with enriched keywords.
"""
import os
import json
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL")

def upload_disaster_keywords(disasters: list[dict]):
    """Update keywords field for disaster events."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    
    for disaster in disasters:
        cur.execute("""
            UPDATE mart.event
            SET keywords = %s
            WHERE event_id = %s
        """, (
            json.dumps(disaster.get('keywords', [])),
            disaster['event_id']
        ))
    
    conn.commit()
    cur.close()
    conn.close()
    
    print(f"Updated {len(disasters)} disaster events with keywords")

if __name__ == "__main__":
    import sys
    
    input_path = sys.argv[1] if len(sys.argv) > 1 else "data/enriched/disasters_enriched.json"
    
    with open(input_path) as f:
        disasters = json.load(f)
    
    upload_disaster_keywords(disasters)
```

---

## Step 5: Execution Plan

### Prerequisites

1. **Get TigerData credentials:**
   ```bash
   # Get DATABASE_URL from service owner
   export DATABASE_URL="postgresql://user:pass@host:port/dbname"
   ```

2. **Install dependencies:**
   ```bash
   pip install psycopg2-binary google-genai
   ```

3. **Set API keys:**
   ```bash
   export GOOGLE_API_KEY="..."
   ```

### Execution Steps

```bash
# Step 1: Backup database
pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d_%H%M%S).sql

# Step 2: Apply schema migration (entities → keywords)
psql "$DATABASE_URL" -f sql/005_keywords_migration.sql

# Step 3: Fetch natural disasters from TigerData
python -m jobs.tigerdata.fetch_disasters

# Step 4: Enrich disasters with keywords
python -m jobs.llm.enrich_disasters

# Step 5: Upload enriched disaster keywords
python -m jobs.tigerdata.upload_disaster_keywords

# Step 6: Upload news events
python -m jobs.tigerdata.upload_news_events

# Step 7: Verify
psql "$DATABASE_URL" -c "SELECT category, COUNT(*) FROM mart.event GROUP BY category;"
```

---

## Step 6: Validation

### 6.1 Check Schema
```bash
psql "$DATABASE_URL" -c "\\d mart.event"
# Should show 'keywords' column, not 'entities'
```

### 6.2 Check Data
```sql
-- Count by category
SELECT category, COUNT(*) FROM mart.event GROUP BY category;

-- Sample disaster with keywords
SELECT event_id, title, keywords
FROM mart.event
WHERE category = 'earthquake'
LIMIT 1;

-- Sample news event
SELECT event_id, title, keywords
FROM mart.event
WHERE category = 'politics'
LIMIT 1;

-- Check keywords not null
SELECT category, 
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE keywords IS NOT NULL AND keywords != '[]'::jsonb) as with_keywords
FROM mart.event
GROUP BY category;
```

---

## Expected Results

### Natural Disasters (Enriched)
```json
{
  "event_id": "usgs:us7000example",
  "category": "earthquake",
  "title": "M 6.2 - 15 km SW of Napa, California",
  "keywords": [
    {"text": "earthquake", "relevance": 1.0, "type": "event"},
    {"text": "magnitude 6.2", "relevance": 0.95, "type": "concept"},
    {"text": "Napa", "relevance": 0.90, "type": "location"},
    {"text": "California", "relevance": 0.88, "type": "location"},
    {"text": "seismic activity", "relevance": 0.82, "type": "topic"},
    {"text": "emergency response", "relevance": 0.75, "type": "concept"}
  ]
}
```

### News Events (Already Enriched)
```json
{
  "event_id": "gnews:abc123",
  "category": "politics",
  "title": "Turkey football ref chief jailed...",
  "keywords": [
    {"text": "corruption", "relevance": 0.95, "type": "topic"},
    {"text": "Turkey", "relevance": 0.92, "type": "location"},
    ...
  ]
}
```

---

## Cost & Performance Estimates

**Natural Disasters:**
- Assume ~100-500 disaster events
- Gemini calls: 1 per disaster
- No geocoding needed (already have coordinates)
- Time: ~5-10 minutes (0.5 sec delay per event)
- Cost: ~$0.10-0.50

**Database Operations:**
- Schema migration: < 1 second
- Upload news: < 10 seconds (101 events)
- Update disasters: < 30 seconds (100-500 events)

**Total Time:** ~15-20 minutes
**Total Cost:** < $1.00

---

## Rollback Plan

If anything goes wrong:

```bash
# Restore from backup
psql "$DATABASE_URL" < backup_YYYYMMDD_HHMMSS.sql

# Or revert schema only
psql "$DATABASE_URL" -c "ALTER TABLE mart.event RENAME COLUMN keywords TO entities;"
```

---

## Next Steps After Migration

1. ✅ **Create linking workflow** (News ↔ Disasters)
2. ✅ **Update API** to serve enriched data
3. ✅ **Test `/events`, `/feed`, `/feed/pins`** endpoints
4. ✅ **Update frontend** to display keywords
5. ✅ **Implement link visualization** on globe hover

---

## Summary

| Step | Script | Time | Cost |
|------|--------|------|------|
| 1. Schema migration | `sql/005_keywords_migration.sql` | 1s | $0 |
| 2. Fetch disasters | `jobs/tigerdata/fetch_disasters.py` | 30s | $0 |
| 3. Enrich disasters | `jobs/llm/enrich_disasters.py` | 10min | $0.50 |
| 4. Upload disaster keywords | `jobs/tigerdata/upload_disaster_keywords.py` | 30s | $0 |
| 5. Upload news events | `jobs/tigerdata/upload_news_events.py` | 10s | $0 |
| **TOTAL** | | **~15min** | **<$1** |

**Ready to start?** Let me know and I'll create all the scripts!
