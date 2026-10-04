# Schema Audit: Natural Disasters vs News Events + Linking Plan

## 📊 Schema Comparison

### A. Natural Disaster Events (`mart.event` + specific tables)

**Base Table: `mart.event`**
```sql
event_id text PRIMARY KEY
source text NOT NULL                    -- "usgs", "gdacs", "firms"
source_event_id text NOT NULL          -- Original ID from source
category text NOT NULL                  -- "earthquake", "wildfire", "cyclone", etc.
subtype text
title text NOT NULL
summary text
info_url text                          -- Link back to source
occurred_at timestamptz NOT NULL
updated_at timestamptz
ended_at timestamptz                   -- Natural disasters have duration
lng double precision NOT NULL
lat double precision NOT NULL
alt_m double precision
geo_precision text NOT NULL
geo_source text NOT NULL               -- "native" (from source)
significance double precision NOT NULL
weight double precision
country_iso3 text
entities jsonb NOT NULL DEFAULT '[]'   -- Currently using this field
raw_ref text
ingested_at timestamptz NOT NULL
```

**Detail Tables** (one per disaster type):
- `mart.earthquake` - magnitude, depth, tsunami, alert level, population affected
- `mart.wildfire` - hotspot count, FRP, burned area, satellite data
- `mart.cyclone` - wind speed, storm class, population at risk
- `mart.flood` - severity score, affected areas
- `mart.volcano` - VEI, volcano name, severity
- `mart.drought` - affected area, drought index

**Linking Table** (already exists!):
```sql
mart.event_link
  link_id text PRIMARY KEY
  source_id text NOT NULL              -- One event ID
  target_id text NOT NULL              -- Another event ID
  relation text NOT NULL               -- Type of relationship
  confidence double precision NOT NULL
  rationale text                       -- Why they're linked
  citations jsonb NOT NULL             -- Evidence/sources
  model text                           -- Which model made the link
```

---

### B. News Events (Current JSON Fixture)

**Current News Event Fields:**
```json
{
  "id": "gnews:abc123",
  "source": "gnews" | "wikifeeds",
  "title": "...",
  "summary": "...",
  "layerId": "politics|sports|technology|...",
  "occurredAt": "2026-10-03T12:00:00Z",
  "updatedAt": "2026-10-03T12:00:00Z",
  "lat": 53.4425,
  "lng": -2.2325,
  "altM": null,
  "geoPrecision": "city|region|country|...",
  "geoSource": "openstreetmap|llm_hint",
  "locationSpecificity": "global|continent|country|region|city|precise",
  "weight": 1.0,
  "significance": 35,
  "keywords": [
    {"text": "...", "relevance": 0.95, "type": "topic|entity|..."}
  ],
  "links": [
    {"url": "...", "source": "...", "label": "..."}
  ],
  "rawRef": null
}
```

---

## 🔍 What's the Same?

| Field | Natural Disasters | News Events | Notes |
|-------|------------------|-------------|-------|
| **ID** | `event_id` | `id` | Primary key |
| **Source** | `source` | `source` | Origin system |
| **Title** | `title` | `title` | Event headline |
| **Summary** | `summary` | `summary` | Description |
| **Time** | `occurred_at` | `occurredAt` | When it happened |
| **Updated** | `updated_at` | `updatedAt` | Last modified |
| **Location** | `lat`, `lng`, `alt_m` | `lat`, `lng`, `altM` | Coordinates |
| **Geo Meta** | `geo_precision`, `geo_source` | `geoPrecision`, `geoSource` | Location metadata |
| **Importance** | `significance` | `significance` | 0-100 score |
| **Weight** | `weight` | `weight` | Relevance weight |

---

## ❌ What's Different?

| Field | Natural Disasters | News Events | Migration Needed? |
|-------|------------------|-------------|-------------------|
| **Category** | `category` (earthquake, wildfire, etc.) | `layerId` (politics, sports, etc.) | ✅ Rename on insert |
| **Subtype** | `subtype` (optional) | ❌ None | ❌ Add if needed |
| **Source URL** | `info_url` | `links[]` array | ✅ Extract first link |
| **End Time** | `ended_at` | ❌ None | ❌ News are point-in-time |
| **Country** | `country_iso3` | ❌ None | ⚠️ Could derive from coords |
| **Tags/Keywords** | ❌ None (has `entities` jsonb) | `keywords[]` array | ⚠️ **CONFLICT** - see below |
| **Location Specificity** | ❌ None | `locationSpecificity` | ⚠️ New field we added |
| **Detail Tables** | ✅ Yes (earthquake, wildfire, etc.) | ❌ None | ❌ Not needed for news |
| **Ingested Time** | `ingested_at` (auto) | ❌ None | ✅ Add on insert |

---

## ⚠️ Critical Issue: `entities` Field Conflict

**Problem:** The natural disaster schema uses `entities` (jsonb) for something, but we renamed it to `keywords` for news events.

**Current State:**
- Natural disasters: `entities jsonb NOT NULL DEFAULT '[]'`
- News events: `keywords` array with `{text, relevance, type}`

**Questions:**
1. What is `entities` used for in natural disasters? (Need to check)
2. Should news events use `entities` to match the schema?
3. Or should we update natural disaster schema to use `keywords`?

**Recommendation:** Let me check if `entities` is actually used in natural disasters first.

---

## 📋 What's Missing from News Events for Database?

To insert news events into `mart.event`, we need:

1. ✅ **event_id** - We have `id`
2. ✅ **source** - We have `source`
3. ⚠️ **source_event_id** - Need to extract from `id` (e.g., "gnews:abc123" → "abc123")
4. ✅ **category** - We have `layerId` (just rename)
5. ❌ **subtype** - Could add based on keywords (optional)
6. ✅ **title** - We have `title`
7. ✅ **summary** - We have `summary`
8. ⚠️ **info_url** - Extract from `links[0].url`
9. ✅ **occurred_at** - We have `occurredAt`
10. ✅ **updated_at** - We have `updatedAt`
11. ❌ **ended_at** - NULL for news (point-in-time events)
12. ✅ **lng, lat, alt_m** - We have them
13. ✅ **geo_precision** - We have `geoPrecision`
14. ✅ **geo_source** - We have `geoSource`
15. ✅ **significance** - We have `significance`
16. ✅ **weight** - We have `weight`
17. ⚠️ **country_iso3** - Could derive from coordinates or keywords
18. ⚠️ **entities** - We have `keywords` (need to decide on field name)
19. ✅ **raw_ref** - We have `rawRef`
20. ❌ **ingested_at** - Add timestamp on insert

---

## 🔗 Linking Plan: News ↔ Natural Disasters

### Goal
Create connections between:
1. **News articles ↔ Natural disasters** (articles about the disaster)
2. **News articles ↔ News articles** (related stories)

### Existing Infrastructure

**Already exists:** `mart.event_link` table
```sql
link_id text PRIMARY KEY
source_id text NOT NULL       -- Event ID 1
target_id text NOT NULL       -- Event ID 2
relation text NOT NULL        -- "reports_on", "related_to", etc.
confidence double precision   -- 0.0-1.0
rationale text                -- Why linked
citations jsonb               -- Evidence
model text                    -- "gemini-3.5-flash"
```

### Relation Types

**For News → Disaster Links:**
- `"reports_on"` - News article reports on this disaster
- `"mentions"` - News article mentions the disaster
- `"analysis"` - News article analyzes the disaster
- `"aftermath"` - News article covers aftermath/recovery

**For News ↔ News Links:**
- `"related_to"` - General relatedness
- `"follows_up"` - Follow-up story
- `"same_event"` - Different sources covering same event (our deduplication)
- `"same_topic"` - Similar topic/theme

---

## 🤖 Gemini Workflow Plan

### Phase 1: Link News → Disasters

**Input:** 
- All news events (101 currently)
- All natural disaster events (from USGS, GDACS, FIRMS)

**Process:**

#### Step 1: Temporal + Spatial Filtering (Cheap)
```python
def find_candidate_disaster_matches(news_event, disasters):
    """
    Quick filter before hitting Gemini.
    """
    candidates = []
    
    for disaster in disasters:
        # Time window: news within 14 days after disaster
        if news_within_14_days_after(news_event, disaster):
            # Geographic proximity or keyword match
            if (
                distance_km(news_event, disaster) < 500 or
                disaster_keywords_in_news(news_event, disaster)
            ):
                candidates.append(disaster)
    
    return candidates
```

**Filters:**
- **Time:** News article within 2 weeks after disaster occurred
- **Space:** Within 500km OR disaster location mentioned in news keywords/title
- **Keywords:** News contains disaster-related terms: "earthquake", "wildfire", "flood", etc.

#### Step 2: Gemini Verification (Expensive)
```python
prompt = f"""
Does this news article report on or discuss this natural disaster?

NEWS ARTICLE:
  Title: {news.title}
  Summary: {news.summary}
  Date: {news.occurredAt}
  Location: {news.lat}, {news.lng}
  Keywords: {[kw['text'] for kw in news.keywords[:10]]}
  Source URL: {news.links[0]['url']}

NATURAL DISASTER:
  Type: {disaster.category}
  Title: {disaster.title}
  Date: {disaster.occurred_at}
  Location: {disaster.lat}, {disaster.lng}
  Magnitude/Severity: {disaster.significance}

Respond with JSON only:
{{
  "is_related": true/false,
  "relation_type": "reports_on|mentions|analysis|aftermath|none",
  "confidence": 0.0-1.0,
  "rationale": "one sentence explaining why they are/aren't related"
}}

Guidelines:
- "reports_on": Article is specifically about this disaster
- "mentions": Article mentions the disaster in passing
- "analysis": Article analyzes the disaster's impact
- "aftermath": Article covers recovery/aftermath
- "none": No meaningful connection

Only link if confidence >= 0.7
"""
```

**Thresholds:**
- Confidence >= 0.7 to create link
- Relation type determines link strength in UI

#### Step 3: Insert Links
```sql
INSERT INTO mart.event_link (link_id, source_id, target_id, relation, confidence, rationale, citations, model)
VALUES (
  'link:' || uuid_generate_v4(),
  news_event_id,
  disaster_event_id,
  relation_type,
  confidence,
  rationale,
  jsonb_build_array(news_article_url),
  'gemini-3.5-flash'
);
```

---

### Phase 2: Link News ↔ News (Web of Related Stories)

**When to Link:**

1. **Same Event, Different Sources** (already done via deduplication)
   - Relation: `"same_event"`
   - Already have `canonicalId` field

2. **Related Topics/Events**
   - Temporal: Within 7 days
   - Spatial: Within 200km OR same country
   - Keyword overlap: > 30% shared keywords

**Gemini Prompt:**
```python
prompt = f"""
Are these two news articles related? Do they discuss the same or related events?

ARTICLE 1:
  Title: {article1.title}
  Summary: {article1.summary}
  Date: {article1.occurredAt}
  Keywords: {[kw['text'] for kw in article1.keywords[:10]]}

ARTICLE 2:
  Title: {article2.title}
  Summary: {article2.summary}
  Date: {article2.occurredAt}
  Keywords: {[kw['text'] for kw in article2.keywords[:10]]}

Respond with JSON only:
{{
  "is_related": true/false,
  "relation_type": "same_event|follows_up|related_to|same_topic|none",
  "confidence": 0.0-1.0,
  "rationale": "one sentence"
}}

Guidelines:
- "same_event": Different coverage of exact same event
- "follows_up": Article 2 is a follow-up to Article 1
- "related_to": Share key people/orgs/locations
- "same_topic": Similar themes (both about AI, corruption, etc.)
- "none": Not meaningfully related

Only link if confidence >= 0.6
"""
```

**Optimization:** 
- Use cheap blocking first (time + space + keyword overlap)
- Only send promising pairs to Gemini
- Batch process to avoid rate limits

---

## 🗂️ Recommended Database Additions

### 1. Create News Event View
```sql
-- View that presents news events in same format as natural disasters
CREATE OR REPLACE VIEW mart.v_news_event AS
SELECT 
  id as event_id,
  source,
  SPLIT_PART(id, ':', 2) as source_event_id,
  layerId as category,
  NULL as subtype,
  title,
  summary,
  (links[0]->>'url')::text as info_url,
  occurredAt::timestamptz as occurred_at,
  updatedAt::timestamptz as updated_at,
  NULL::timestamptz as ended_at,
  lng,
  lat,
  altM as alt_m,
  geoPrecision as geo_precision,
  geoSource as geo_source,
  significance,
  weight,
  NULL as country_iso3,  -- Could derive
  keywords::jsonb as entities,  -- Map keywords to entities field
  rawRef as raw_ref,
  now() as ingested_at
FROM news_events_json;  -- Your fixture as a table
```

### 2. Migration Script for News Events
```sql
-- Insert news events into mart.event
INSERT INTO mart.event (
  event_id, source, source_event_id, category, subtype,
  title, summary, info_url,
  occurred_at, updated_at, ended_at,
  lng, lat, alt_m, geo_precision, geo_source,
  significance, weight, country_iso3, entities, raw_ref, ingested_at
)
SELECT
  id,
  source,
  SPLIT_PART(id, ':', 2),
  layerId,  -- Map to category
  NULL,
  title,
  summary,
  links[0]->>'url',  -- First link as info_url
  occurredAt::timestamptz,
  updatedAt::timestamptz,
  NULL,  -- No end time for news
  lng,
  lat,
  altM,
  geoPrecision,
  geoSource,
  significance::double precision,
  weight::double precision,
  NULL,  -- country_iso3 - could derive
  keywords::jsonb,  -- Store keywords in entities field
  rawRef,
  now()
FROM news_events_json_temp
ON CONFLICT (source, source_event_id) DO UPDATE
  SET updated_at = EXCLUDED.updated_at,
      summary = EXCLUDED.summary,
      significance = EXCLUDED.significance;
```

---

## 📋 Implementation Plan

### Step 1: Schema Alignment (1-2 hours)
- [ ] Decide: Keep `keywords` or rename to `entities`?
- [ ] Add `country_iso3` derivation logic
- [ ] Create migration script for news → mart.event
- [ ] Test insertion of 101 news events

### Step 2: News → Disaster Linking (3-4 hours)
- [ ] Fetch all disasters from database
- [ ] Implement temporal + spatial + keyword filtering
- [ ] Create Gemini linking workflow
- [ ] Batch process: For each news event, find disaster matches
- [ ] Insert links into `mart.event_link`
- [ ] Test with sample: 10 news articles
- [ ] Run full batch: All 101 news events

### Step 3: News ↔ News Linking (2-3 hours)
- [ ] Implement blocking function (time + space + keywords)
- [ ] Create Gemini news-to-news prompt
- [ ] Find candidate pairs (avoid N² comparison)
- [ ] Batch process promising pairs
- [ ] Insert links into `mart.event_link`

### Step 4: API Endpoints (2-3 hours)
- [ ] `GET /events/{event_id}/related` - Get all linked events
- [ ] `GET /events/{event_id}/news` - Get news about this disaster
- [ ] `GET /events/{event_id}/disasters` - Get disasters mentioned in news
- [ ] Filter by relation type, confidence threshold

### Step 5: UI Integration (handled by frontend team)
- [ ] Hover over disaster → show linked news articles
- [ ] Click news article → show related disasters
- [ ] Show "Related Stories" web/graph

---

## 🎯 Expected Results

### News → Disaster Links
**Example:**
```
Disaster: "M 7.2 Earthquake - Tokyo, Japan" (2026-10-03)
  ↓ reports_on (confidence: 0.95)
News: "Hundreds evacuated after Tokyo earthquake" (gnews:abc123)

Disaster: "California Wildfire - 5000 hectares burned" (2026-09-28)
  ↓ aftermath (confidence: 0.85)
News: "California residents return home after wildfire" (gnews:def456)
```

### News ↔ News Links
```
News: "Turkey football ref jailed on corruption charges" (gnews:123)
  ↓ related_to (confidence: 0.72)
News: "Sports governance reforms announced in Turkey" (gnews:456)

News: "OpenAI releases GPT-5" (gnews:789)
  ↓ same_topic (confidence: 0.68)
News: "AI breakthrough in reasoning capabilities" (wikifeeds:abc)
```

---

## 💰 Cost Estimate

**Gemini API Calls:**
- News → Disaster: 101 news × avg 5 candidates = 505 calls
- News ↔ News: 101 news × avg 10 candidates = 1,010 calls
- **Total: ~1,500 Gemini calls**

**Using Gemini 3.5 Flash:**
- Input: ~500 tokens/call
- Output: ~100 tokens/call
- Cost: ~$0.50-1.00 total (very affordable)

**Time:**
- With 1 req/sec rate limit: ~25 minutes
- Can parallelize with multiple workers: ~5-10 minutes

---

## ❓ Questions to Resolve

1. **Field naming:** Keep `keywords` or rename to `entities` to match schema?
2. **Country derivation:** Derive `country_iso3` from coordinates or keywords?
3. **Confidence thresholds:** 0.7 for disasters, 0.6 for news-to-news?
4. **Link bidirectionality:** Store both directions or query both ways?
5. **Update frequency:** Re-run linking daily, weekly, or on-demand?

---

## 🚀 Next Steps

**Ready to implement?** I can:
1. Create the linking workflow code
2. Set up the Gemini prompts
3. Implement the filtering logic
4. Test on sample data
5. Run full batch linking

**Or clarify first:**
- Which questions above need decisions?
- Any schema changes needed?
- Priority: News → Disaster or News ↔ News first?
