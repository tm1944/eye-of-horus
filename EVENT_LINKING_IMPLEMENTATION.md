# Event Linking Implementation Plan

Based on causal reasoning and mechanism-first approach (no cheap filtering).

## Overview

**Current Dataset:**
- 78 news events (enriched with keywords, geocoded)
- 933 disasters (structured: magnitude, FRP, wind speed, etc.)
- **Goal:** Find meaningful causal/reportage relationships

**Key Principle:**
> Don't filter cheaply, then verify. Instead, use smart candidate generation, then let AI reason about mechanisms.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EVENT LINKING PIPELINE                    │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   NEWS EVENTS        DISASTERS          EVENT METADATA
   (78 items)         (933 items)        (already normalized)
        │                  │
        │                  │
        └──────────┬───────┘
                   ▼
        CANDIDATE GENERATION
        (Smart, not cheap filtering)
                   │
             ~100-500 pairs
                   ▼
        ┌──────────────────────┐
        │  BATCH AI REASONING  │
        │   (Gemini 2.0 Flash) │
        │                      │
        │  • What mechanism?   │
        │  • What relation?    │
        │  • Direct/indirect?  │
        │  • Evidence?         │
        └──────────┬───────────┘
                   │
           ~30-100 links
                   ▼
        ┌──────────────────────┐
        │   mart.event_link    │
        │                      │
        │  + mechanism         │
        │  + directness        │
        │  + evidence          │
        └──────────────────────┘
```

---

## Phase 1: Candidate Generation (Smart, Not Cheap)

### Why not time/distance filtering?

The other agent is right: **Don't make the AI verify things you've already decided are related.**

Instead:

### Strategy A: Keyword-Based Discovery

**For each news article:**
1. Extract top keywords (already have these)
2. Match against disaster categories:
   - "earthquake" keywords → earthquake disasters
   - "wildfire"/"fire" keywords → wildfire disasters
   - "typhoon"/"cyclone" keywords → cyclone disasters
3. For matches, check if disaster occurred within 14 days BEFORE news
4. If yes → candidate

**Example:**
```
News: "California wildfire forces evacuations"
Keywords: ["wildfire", "California", "evacuation", "fire"]

→ Find disasters:
  - category = wildfire
  - occurred_at < news.occurred_at
  - occurred_at > news.occurred_at - 14 days

→ 3 candidates found
```

### Strategy B: Geographic Clustering

**For news without disaster keywords:**
1. Find disasters within 200km
2. Within 14 days before news
3. Significance > 60 (major disasters more likely to be covered)

### Strategy C: Temporal Clustering

**For remaining news:**
1. Group by week
2. Find any major disasters (significance > 80) in same week
3. Regardless of location (global coverage)

### Expected Output

From 78 news × 933 disasters (72,774 theoretical pairs):
- Keyword matching: ~50-100 candidates
- Geographic clustering: ~20-50 candidates
- Temporal clustering: ~10-20 candidates
- **Total: ~80-170 candidates** (manageable for AI verification)

---

## Phase 2: Event Normalization (Already Done!)

We already have structured data:

### News Events
```json
{
  "id": "gnews:abc123",
  "title": "California Wildfire Forces Evacuations",
  "summary": "...",
  "keywords": [
    {"text": "wildfire", "type": "event"},
    {"text": "California", "type": "location"},
    {"text": "evacuation", "type": "concept"}
  ],
  "occurred_at": "2026-10-03T15:00:00Z",
  "lat": 38.5,
  "lng": -122.5,
  "significance": 45
}
```

### Disasters
```json
{
  "id": "firms-cluster:2026-10-02:38.0:-122.0",
  "category": "wildfire",
  "title": "VIIRS hotspot cluster 38.0, -122.0",
  "summary": "NASA FIRMS cluster",
  "occurred_at": "2026-10-02T00:00:00Z",
  "lat": 38.0,
  "lng": -122.0,
  "significance": 85,
  "attributes": {
    "hotspot_count": 45,
    "max_frp": 790.92,
    "burned_area_ha": null
  }
}
```

**Key insight:** Disasters have rich structured metadata (magnitude, FRP, wind speed) that provides context.

---

## Phase 3: Relationship Reasoning (The Core)

### Batch Prompt Design

Instead of individual pairs, send 5-10 candidates at once:

```
You are an expert at identifying causal relationships between news articles and disaster events.

Your task: Determine which, if any, of these disasters are meaningfully related to this news article.

A relationship should only exist when there is a SPECIFIC MECHANISM connecting them.

DO NOT connect events merely because:
  - They share keywords
  - They occurred close in time
  - They are in similar locations
  - One COULD have affected the other (speculation)

REQUIRE:
  - A specific factual or causal connection
  - Evidence in the article that it's about/mentions the disaster
  - A clear mechanism explaining the relationship

NEWS ARTICLE:
{{NEWS_EVENT}}

CANDIDATE DISASTERS:
{{DISASTER_LIST}}

For each disaster, determine:
1. Is there a meaningful relationship?
2. What type of relationship?
3. What is the specific mechanism connecting them?
4. What evidence supports this connection?
5. How direct is the relationship?

RELATIONSHIP TYPES:
  - REPORTS_ON: Article is ABOUT this disaster (primary story)
  - MENTIONS: Article mentions disaster in context
  - ANALYZES: Article analyzes impact/aftermath
  - CONTEXTUAL: Same topic/region but no causal link
  - NONE: No meaningful connection

DIRECTNESS:
  - DIRECT: Article explicitly reports on this specific disaster
  - INDIRECT: Article discusses related impacts/consequences
  - CONTEXTUAL: Merely nearby/related topic

Return JSON array:
[
  {
    "disaster_id": "...",
    "relationship": true/false,
    "type": "REPORTS_ON | MENTIONS | ANALYZES | CONTEXTUAL | NONE",
    "directness": "DIRECT | INDIRECT | CONTEXTUAL",
    "confidence": 0.0-1.0,
    "mechanism": "One sentence explaining the connection",
    "evidence": [
      "Specific text/fact from article supporting the link",
      "Specific fact about disaster supporting the link"
    ]
  }
]

IMPORTANT: Only return entries where relationship = true and type != NONE.
If no meaningful relationships exist, return empty array [].
```

### Why Batch Processing?

**Cost savings:**
- Individual: 170 candidates × 1 call = 170 API calls (~$0.17)
- Batched (5 per call): 170 / 5 = 34 API calls (~$0.03)

**Better quality:**
- Model can compare candidates against each other
- Reduces false positives (relative judgment)

---

## Phase 4: Quality Filtering

### Filter by Mechanism Quality

Accept link only if:
```python
relationship == true
AND type in ["REPORTS_ON", "MENTIONS", "ANALYZES"]
AND directness in ["DIRECT", "INDIRECT"]
AND confidence >= 0.7
AND len(mechanism) > 20  # Requires actual explanation
AND len(evidence) >= 1   # Requires supporting facts
```

Reject:
```python
type == "CONTEXTUAL"  # Too weak
OR directness == "CONTEXTUAL"
OR mechanism contains "may", "might", "possibly"  # Too speculative
OR mechanism is generic ("both involve X")
```

### Evidence Validation

Check that evidence references specific facts:
- ✓ "Article mentions 'wildfire in Northern California'"
- ✓ "Disaster occurred 50km from article location"
- ✗ "Both are about wildfires"
- ✗ "They happened around the same time"

---

## Phase 5: Database Schema

### mart.event_link (existing table)

Add new fields for explainability:

```sql
-- Add columns for mechanism-based linking
ALTER TABLE mart.event_link 
  ADD COLUMN IF NOT EXISTS directness VARCHAR(20),
  ADD COLUMN IF NOT EXISTS mechanism TEXT,
  ADD COLUMN IF NOT EXISTS evidence JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN mart.event_link.directness IS
  'DIRECT, INDIRECT, or CONTEXTUAL relationship strength';

COMMENT ON COLUMN mart.event_link.mechanism IS
  'Explanation of how the events are connected';

COMMENT ON COLUMN mart.event_link.evidence IS
  'Specific facts supporting the relationship';
```

### Link Record Example

```json
{
  "link_id": "link:gnews:abc123:firms-cluster:2026-10-02:38.0:-122.0",
  "source_id": "gnews:abc123",
  "target_id": "firms-cluster:2026-10-02:38.0:-122.0",
  "relation": "reports_on",
  "directness": "DIRECT",
  "confidence": 0.94,
  "mechanism": "Article reports on wildfire detected by NASA FIRMS satellites, describing evacuation orders for nearby communities",
  "evidence": [
    "Article explicitly mentions 'wildfire in Northern California near Napa'",
    "NASA FIRMS hotspot cluster located 35km from article location",
    "Disaster occurred 1 day before article publication",
    "Article keywords include 'wildfire', 'evacuation', matching disaster type"
  ],
  "model": "gemini-2.0-flash-exp",
  "citations": []
}
```

---

## Implementation Steps

### Step 1: Update link_disasters.py

**Changes from current version:**
1. Remove cheap time/distance filtering
2. Implement smart candidate generation (keyword + geographic + temporal)
3. Use batch prompting (5-10 disasters per call)
4. Require mechanism + evidence in response
5. Add directness field
6. Filter by mechanism quality

### Step 2: Test with Small Batch

**Test run:**
- Process 5 news articles
- Generate ~10-20 candidates
- Send to Gemini in batches
- Validate results manually

**Cost:** ~$0.01
**Time:** ~2 minutes

### Step 3: Full Run

**Full dataset:**
- 78 news articles
- ~80-170 candidates after smart filtering
- ~15-35 API calls (batched)
- **Cost:** ~$0.03-0.05
- **Time:** ~5-10 minutes

### Step 4: Integrate into Pipeline

```python
# jobs/pipeline.py

def run_pipeline(...):
    # ... existing stages ...
    
    # Stage 4: Linking
    if run_link:
        print("\n=== Stage 4: Generating Event Links ===")
        from jobs.llm.link_disasters import link_all_events
        results["linking"] = link_all_events()
```

---

## Expected Output

### Quantity

From 78 news articles:
- **10-30 REPORTS_ON links:** Articles primarily about disasters
- **5-15 MENTIONS links:** Articles mentioning disasters in context
- **3-8 ANALYZES links:** Articles about disaster impacts
- **Total:** ~18-53 meaningful links

### Quality

Each link has:
- ✓ Specific relationship type
- ✓ Clear mechanism explanation
- ✓ Supporting evidence
- ✓ Directness classification
- ✓ High confidence (≥0.7)

### Examples

**Strong link (DIRECT):**
```
News: "California Wildfire Forces Evacuations in Napa Valley"
→ Wildfire: FIRMS cluster 38.0, -122.0
Type: REPORTS_ON
Directness: DIRECT
Mechanism: "Article directly reports on this wildfire event, describing evacuation orders and fire spread"
Confidence: 0.95
```

**Weak link (filtered out):**
```
News: "Wine Prices Expected to Rise"
→ Wildfire: FIRMS cluster 38.0, -122.0
Type: CONTEXTUAL
Directness: CONTEXTUAL
Mechanism: "Both involve California wine region"
Confidence: 0.4
→ REJECTED (contextual, low confidence)
```

---

## News-News Linking (Phase 2)

Apply same approach to news-news relationships:

### Candidates

For each news article, find others:
1. **Same topic:** Keyword overlap > 40%
2. **Same place:** Within 200km
3. **Same time:** Within 48 hours
4. **Same entity:** Share person/organization keywords

### Batch Prompt

```
Determine which of these news articles are meaningfully related to the target article.

Relationships must have SPECIFIC MECHANISMS, not just shared keywords.

RELATIONSHIP TYPES:
  - SAME_EVENT: Same story, different source
  - SAME_TOPIC: Related stories on same subject
  - SAME_PLACE: Stories about same location/region
  - CAUSE_EFFECT: One event led to the other
  - NONE: No meaningful connection
```

---

## Cost Analysis

### Full Pipeline Run

```
Disaster linking:
  78 news × ~2 candidates per news (avg) = ~156 candidates
  156 / 5 (batched) = ~32 API calls
  Cost: $0.03

News-news linking:
  78 news × ~3 candidates per news (avg) = ~234 candidates
  234 / 5 (batched) = ~47 API calls
  Cost: $0.05

Total: ~79 API calls, ~$0.08 per full run
Time: ~10 minutes
```

**Much cheaper than original plan** (170+ individual calls).

---

## Success Metrics

### Quantitative

- Links created: 20-60 total
- API calls: <100
- Cost: <$0.10
- False positive rate: <10% (manual review)
- Time: <15 minutes

### Qualitative

Each link should answer:
> **"Why are these events connected?"**

Not:
> "They share keywords" ❌

But:
> "Article reports on wildfire detected 1 day earlier, describing evacuation orders for affected communities" ✓

---

## Next Steps

1. **Update link_disasters.py** with new approach
2. **Test on 5 news articles** (validate prompts)
3. **Run full linking** (~$0.08, 10 minutes)
4. **Review links manually** (quality check)
5. **Integrate into unified pipeline**
6. **Update API to serve links** with mechanisms

Ready to implement?
