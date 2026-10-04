# AI Enrichment Pipeline - Updated Design

## Summary of Changes

The enrichment pipeline has been completely overhauled to provide:
1. **Comprehensive logging** - Before/after summaries for every change
2. **Better location handling** - Hierarchical location with guaranteed coordinates
3. **Clear scoring criteria** - Consistent significance scoring rubric
4. **Improved prompts** - Context-aware with valid options provided
5. **New tracking field** - `locationSpecificity` to record precision level

---

## What are "Keywords"? (Previously "Entities")

**Keywords** = Searchable tags extracted from articles - includes topics, themes, concepts, and named entities.

**Changed from "entities" (NER only) to "keywords" (comprehensive tagging)** for better search and categorization.

### Types:
- **topic**: What the article is about ("artificial intelligence", "climate change", "corruption")
- **entity**: Specific items ("referee", "earthquake", "election")
- **concept**: Abstract themes ("sports governance", "sustainability", "innovation")
- **location**: Geographic places ("Turkey", "San Francisco", "Tokyo")
- **technology**: Specific technologies ("GPT-5", "CRISPR", "blockchain")
- **event**: Events or actions ("arrest", "summit", "protest", "merger")
- **industry**: Relevant sectors ("healthcare", "finance", "technology", "sports")
- **organization**: Named organizations ("OpenAI", "NATO", "Turkish Football Federation")
- **person**: Named individuals ("President Biden", "Elon Musk", "Roy Horn")

### Format:
```json
{
  "keywords": [
    {"text": "artificial intelligence", "relevance": 0.95, "type": "topic"},
    {"text": "OpenAI", "relevance": 0.90, "type": "organization"},
    {"text": "GPT-5", "relevance": 0.92, "type": "technology"},
    {"text": "machine learning", "relevance": 0.80, "type": "topic"}
  ]
}
```

### Use Cases:
- **Keyword Search**: "Show me all events about corruption" ✅
- **Topic Filtering**: "Events about artificial intelligence in San Francisco" ✅
- **User Interest Matching**: Match user's interests with event keywords
- **Trending Keywords**: "What topics are trending this week?"
- **Related Events**: Find events with overlapping keywords
- **Auto-complete Search**: Suggest keywords as user types
- **Personalization**: Weight events higher if they match user's interest keywords

---

## How is Significance Calculated?

### Old Method (Vague):
- Prompt: "integer 0-100 (global newsworthiness; 80+ = major world event)"
- Problem: No criteria, inconsistent, subjective

### New Method (Criteria-Based):

Gemini now follows this **scoring rubric**:

```
0-20:   Niche/local interest
        - Local sports results
        - Entertainment gossip
        - Minor business announcements
        - Example: "Local high school wins championship"

21-40:  Regional significance
        - State/provincial news
        - Regional sports championships
        - Local political changes
        - Example: "California passes new housing law"

41-60:  National significance
        - Affects one country
        - National sports events
        - Significant business news
        - Example: "India wins bronze at Asian Games"

61-80:  International significance
        - Affects multiple countries
        - Major political events
        - Large regional conflicts
        - Example: "EU announces new trade agreement"

81-100: Major global event
        - Natural disasters affecting millions
        - Wars and major conflicts
        - Global economic crises
        - Major scientific breakthroughs
        - Example: "Magnitude 8.0 earthquake hits Tokyo"
```

### Factors Considered:
1. **Geographic scope**: Local → Regional → National → International → Global
2. **Human impact**: How many people are affected?
3. **Duration**: One-time event vs. long-lasting impact
4. **Economic/political importance**: GDP impact, policy changes, geopolitical shifts

---

## Location & Coordinates - Critical Changes

### Problem with Old Approach:
- Many events had `lat/lng = None`
- No way to pin them on the map
- Only specific city-level events got coordinates

### New Hierarchical Approach:

**Every event MUST get coordinates**. The AI narrows down as much as possible:

```
1. Try to identify:
   - City/town name
   - Region/state/province
   - Country

2. Geocode at the most specific level possible

3. If can't narrow beyond country → use country center coordinates

4. Track specificity level in new "locationSpecificity" field
```

### Location Specificity Levels:

| Level | Description | Geocoding Strategy | Example |
|-------|-------------|-------------------|---------|
| `global` | No specific location | No coordinates | "New AI model released" |
| `continent` | Continent only (rare) | Continent center | "African Union summit" |
| `country` | Country-level only | Country center | "India national election" |
| `region` | State/province/region | Region center | "California wildfires" |
| `city` | City/town | City coordinates | "Paris protests" |
| `precise` | Specific building/venue | Exact coordinates | "White House press conference" |

### New Data Model:

**Gemini Response:**
```json
{
  "location": {
    "country": "Turkey",
    "region": "Ankara Province",
    "city": "Ankara"
  },
  "locationSpecificity": "city"
}
```

**Geocoding:**
- Query: "Ankara, Turkey"
- Result: lat=39.9334, lng=32.8597
- Stored: `geoPrecision = "city"`, `locationSpecificity = "city"`

**If only country known:**
```json
{
  "location": {
    "country": "India",
    "region": "",
    "city": ""
  },
  "locationSpecificity": "country"
}
```

**Geocoding:**
- Query: "India"
- Result: lat=20.5937, lng=78.9629 (center of India)
- Stored: `geoPrecision = "country"`, `locationSpecificity = "country"`

---

## Updated Prompt Design

### Key Improvements:

1. **Valid categories provided**
   - Old: Just says "one of: earthquake, wildfire, ..."
   - New: Lists all 23 valid options in the prompt

2. **Summary always required**
   - Old: "copy from input if already good" (LLM often skipped)
   - New: "Always provide a summary, even if input has one (improve it)"

3. **Link context included**
   - Old: Only title + summary given
   - New: Includes article links for context (Gemini can reference them)

4. **Hierarchical location**
   - Old: Single "placeText" field
   - New: Structured country/region/city object

5. **Significance criteria included**
   - Old: One vague guideline
   - New: Full 5-tier scoring rubric in prompt

---

## Comprehensive Logging

### Old Behavior:
```
[ingest] enriching with Gemini...
[ingest] deduplicating with Gemini...
```
Silent - no visibility into what changed.

### New Behavior:
```
[enrich] Starting enrichment for 101 events...
[enrich] 1. gnews:abc123
         Title: Turkey football ref chief jailed pending trial for graft...
         - layer: sports → politics
         - summary: updated
         - entities: 3 extracted
         - significance: 50 → 45
         - coords: Ankara, Turkey → (39.9334, 32.8597)
[enrich] 2. gnews:def456
         Title: Leucine does more than build muscle...
         - summary: updated
         - keywords: 6 extracted (science, leucine, muscle...)
         - coords: none (specificity=global)
[enrich] 3. gnews:ghi789
         Title: Pakistan whip China...
         - layer: sports → sports
         - summary: updated
         - keywords: 10 extracted (volleyball, Pakistan, China...)
         - significance: 50 → 45
         - coords: Pakistan → (30.3753, 69.3451)
[enrich] Complete: 98 enriched, 3 failed/skipped
```

### What's Logged:
- ✅ Event ID and title
- ✅ Layer changes (before → after)
- ✅ Summary updates
- ✅ Entity count
- ✅ Significance changes (before → after)
- ✅ Coordinates with location name
- ✅ Failures and reasons

---

## Database Schema Changes

### New Column:

```sql
ALTER TABLE MART.EVENT ADD COLUMN IF NOT EXISTS location_specificity VARCHAR(20);
```

### Valid Values:
- `'global'` - No specific location
- `'continent'` - Continent only
- `'country'` - Country-level
- `'region'` - State/province/region
- `'city'` - City/town
- `'precise'` - Building/street/venue

### Migration:
Run `sql/004_location_specificity.sql` after `003_events_update.sql`

---

## Example: Before vs After

### Input Event (from GNews):
```json
{
  "id": "gnews:abc123",
  "title": "Turkey football ref chief jailed pending trial for graft",
  "summary": "TFF working to shake up refereeing oversight.",
  "layerId": "sports",
  "significance": 50,
  "entities": [],
  "lat": null,
  "lng": null,
  "geoPrecision": null,
  "geoSource": "llm_hint"
}
```

### After Enrichment:
```json
{
  "id": "gnews:abc123",
  "title": "Turkey football ref chief jailed pending trial for graft",
  "summary": "The Turkish Football Federation's top refereeing official was jailed pending trial on corruption charges. The TFF announced it is working to reform its refereeing oversight body following the scandal. This represents a significant blow to Turkish football governance.",
  "layerId": "politics",  // ← Changed from "sports"
  "significance": 45,  // ← Scored based on criteria (national significance)
  "keywords": [  // ← Changed from "entities" to "keywords" (8-15 searchable tags)
    {"text": "corruption", "relevance": 0.95, "type": "topic"},
    {"text": "football", "relevance": 0.90, "type": "industry"},
    {"text": "Turkey", "relevance": 0.92, "type": "location"},
    {"text": "Turkish Football Federation", "relevance": 0.88, "type": "organization"},
    {"text": "sports governance", "relevance": 0.85, "type": "concept"},
    {"text": "arrest", "relevance": 0.80, "type": "event"},
    {"text": "referee", "relevance": 0.78, "type": "entity"},
    {"text": "oversight reform", "relevance": 0.75, "type": "concept"}
  ],
  "lat": 39.9334,  // ← Geocoded to Ankara (capital)
  "lng": 32.8597,
  "geoPrecision": "city",  // ← Now matches specificity
  "geoSource": "google_geocode",
  "locationSpecificity": "city"  // ← NEW FIELD
}
```

---

## Benefits

### For General Feed:
1. **Every event has coordinates** → All events can be displayed on map
2. **Consistent scoring** → Better ranking/sorting by importance
3. **Rich entity data** → Better search and filtering
4. **Transparency** → Logs show exactly what AI decided

### For Personalized Feed (Future):
1. **Entity matching** → Weight events with entities user cares about
2. **Location filtering** → "Show me events in my region"
3. **Significance rescoring** → Adjust scores based on user preferences
4. **Specificity filtering** → "Only show city-level events" or "Show national events"

---

## Next Steps

1. ✅ Code updated
2. ✅ SQL migration created (`004_location_specificity.sql`)
3. ⏳ Run migration on Snowflake (if using cloud DB)
4. ⏳ Test enrichment on sample events
5. ⏳ Run full enrichment on all 101 events
6. ⏳ Review logs and adjust criteria if needed
