# News → Disaster Linking Proposal

**Purpose:** Link news articles that report on, mention, or analyze natural disaster events

---

## The Challenge

**Dataset:**
- 78 news events (enriched with keywords, summaries, locations)
- 933 disaster events (earthquakes, wildfires, cyclones, floods)
- **Theoretical pairs:** 78 × 933 = 72,774 combinations

**Goal:** Find ~10-40 meaningful links where news articles report on disasters

---

## Key Differences from News↔News

### News↔News Linking
- **Bidirectional:** Either article could reference the other
- **Symmetric:** A relates to B means B relates to A
- **Similar types:** Both are news articles with keywords, summaries
- **Relationship:** "Same story" or "related topics"

### News↔Disaster Linking
- **Unidirectional:** News reports ON disaster (not vice versa)
- **Asymmetric:** News can mention disaster, but disaster can't mention news
- **Different types:** News has keywords/summaries, disasters have structured metadata
- **Relationship:** "Reports on" or "mentions" (reportage, not just similarity)

---

## Proposal: Three Candidate Strategies

### Strategy 1: Keyword-Based Discovery (Primary)

**Logic:**
```
IF news.keywords contains disaster-type keywords
AND disaster occurred BEFORE news
AND disaster occurred within 14 days before news
THEN → candidate
```

**Disaster keyword mappings:**
```python
DISASTER_KEYWORDS = {
    'earthquake': ['earthquake', 'seismic', 'tremor', 'quake', 'magnitude'],
    'wildfire': ['wildfire', 'fire', 'bushfire', 'blaze', 'smoke', 'burn'],
    'cyclone': ['cyclone', 'typhoon', 'hurricane', 'storm', 'tropical storm'],
    'flood': ['flood', 'flooding', 'inundation', 'deluge', 'overflow'],
    'volcano': ['volcano', 'volcanic', 'eruption', 'lava', 'ash'],
    'drought': ['drought', 'dry', 'water shortage', 'famine', 'arid']
}
```

**Example:**

News article:
```
Title: "California Wildfire Forces Evacuations in Wine Country"
Keywords: ["wildfire", "California", "Napa", "evacuation", "fire"]
Published: 2026-10-03 09:00:00
```

Matches disaster type "wildfire" → Find all wildfires:
- Occurred before 2026-10-03 09:00:00
- Occurred after 2026-09-19 09:00:00 (14 days before)

Results:
```
FIRMS cluster 38.0,-122.0 (Oct 2, 00:00) ✓ → CANDIDATE
FIRMS cluster 35.5,-119.0 (Oct 1, 12:00) ✓ → CANDIDATE
FIRMS cluster 41.0,-124.0 (Sep 28, 06:00) ✓ → CANDIDATE
```

**Expected output:** 50-100 candidates

---

### Strategy 2: Geographic Proximity (Secondary)

**Logic:**
```
IF distance(news, disaster) < 200km
AND disaster.significance > 60  (major disasters get coverage)
AND disaster occurred within 14 days before news
THEN → candidate
```

**Example:**

News article:
```
Title: "Economic Impact of Recent Natural Disaster"
Keywords: ["economy", "impact", "damage", "recovery"]
Location: 38.5, -122.5 (Northern California)
Published: 2026-10-03
```

No disaster keywords, but find nearby disasters:
```
FIRMS wildfire at 38.0,-122.0 → 55km away ✓ → CANDIDATE
  (Major fire, significance 85)
```

**Why this works:**
- Local/regional news covers nearby disasters even without using disaster terms
- Example: Economic impact story doesn't say "wildfire" but is about fire's effects

**Expected output:** 20-50 candidates

---

### Strategy 3: High-Significance Temporal (Fallback)

**Logic:**
```
IF disaster.significance > 80  (major global disasters)
AND disaster occurred same week as news
THEN → candidate
```

**Example:**

News article:
```
Title: "Energy Markets Face Volatility"
Keywords: ["energy", "markets", "oil", "volatility"]
Published: 2026-10-03
```

No disaster keywords, not nearby, but find major disasters same week:
```
M 7.2 Earthquake in Iran (Oct 1, significance 95) → CANDIDATE
  (Could affect energy markets)
```

**Why this works:**
- Global news covers major disasters even at distance
- Example: Energy news might cover earthquake's oil supply impact
- Rare but important connections

**Expected output:** 10-20 candidates

---

## Candidate Generation Summary

**Total expected:** 80-170 candidates (vs 72,774 theoretical)

**Distribution:**
- 60% from keyword matching (direct reportage)
- 30% from geographic proximity (regional coverage)
- 10% from high-significance temporal (global impact)

---

## AI Reasoning: Batch Prompt Design

### Core Principles

1. **Directness Classification**
   - DIRECT: Article explicitly reports on this disaster
   - INDIRECT: Article discusses related impacts
   - CONTEXTUAL: Merely nearby/coincidental (reject these)

2. **Evidence Requirements**
   - Must cite specific facts from news article
   - Must cite specific facts about disaster
   - Not just "both involve X"

3. **Mechanism-First**
   - Explain HOW they connect
   - Not just IF they connect

### Prompt Template

```
You are an expert at identifying reportage relationships between news articles 
and natural disaster events.

Your task: Determine which, if any, of these disasters are meaningfully 
connected to this news article.

A connection exists when the news article REPORTS ON, MENTIONS, or ANALYZES 
the disaster event.

CRITICAL RULES:

1. A relationship requires the news article to reference the disaster:
   - Article explicitly describes this disaster
   - Article mentions this disaster in context
   - Article analyzes impacts of this disaster

2. DO NOT connect merely because:
   - They're in the same region
   - They occurred close in time
   - They involve similar topics
   - One COULD have affected the other (speculation)

3. Provide EVIDENCE from BOTH:
   - Specific text/facts from the article
   - Specific facts about the disaster

4. Classify DIRECTNESS:
   - DIRECT: Article's main subject is this disaster
   - INDIRECT: Article mentions/analyzes this disaster
   - CONTEXTUAL: No actual connection (reject)

RELATIONSHIP TYPES:

- REPORTS_ON: Article primarily ABOUT this disaster
  Example: "Wildfire forces evacuations" → [that wildfire]

- MENTIONS: Article mentions disaster in passing
  Example: "Air quality worsens amid ongoing fires" → [wildfire]

- ANALYZES: Article analyzes disaster's impact/aftermath
  Example: "Economic toll of California fires reaches $X" → [wildfire]

- NONE: No connection (article doesn't reference this disaster)

NEWS ARTICLE:
Title: {{title}}
Summary: {{summary}}
Keywords: {{keywords}}
Published: {{date}}
Location: {{lat, lng}}

CANDIDATE DISASTERS (evaluate each):

Disaster 1:
  ID: {{id}}
  Type: {{category}}
  Description: {{title}}
  Occurred: {{date}}
  Location: {{lat, lng}}
  Severity: {{significance}}
  Details: {{attributes}}

Disaster 2:
  ...

RESPOND WITH JSON ARRAY:

[
  {
    "disaster_id": "...",
    "relationship": true/false,
    "type": "REPORTS_ON | MENTIONS | ANALYZES | NONE",
    "directness": "DIRECT | INDIRECT | CONTEXTUAL",
    "confidence": 0.0-1.0,
    "mechanism": "Specific sentence explaining the connection",
    "evidence": [
      "Fact from article showing it references the disaster",
      "Fact about disaster supporting the connection"
    ]
  }
]

Return empty array [] if no meaningful connections exist.
```

### Batch Size

**5 disasters per API call**

Why?
- Balances cost vs quality
- Model can compare candidates
- Reduces false positives
- 170 candidates / 5 = ~34 API calls (~$0.03)

---

## Example Scenarios

### Scenario 1: Direct Reportage (Strong Link)

**Input:**

News:
```json
{
  "title": "Wildfire Forces 10,000 to Evacuate in Napa Valley",
  "summary": "A fast-moving wildfire in Northern California has forced thousands of residents to evacuate their homes as firefighters battle the blaze...",
  "keywords": ["wildfire", "evacuation", "California", "Napa Valley", "emergency"],
  "published": "2026-10-03T09:00:00Z",
  "location": [38.5, -122.5]
}
```

Disaster:
```json
{
  "id": "firms-cluster:2026-10-02:38.0:-122.0",
  "type": "wildfire",
  "title": "VIIRS hotspot cluster 38.0, -122.0",
  "occurred": "2026-10-02T00:00:00Z",
  "location": [38.0, -122.0],
  "significance": 85,
  "details": {
    "hotspot_count": 45,
    "max_frp": 790.92,
    "satellite": "VIIRS"
  }
}
```

**Candidate Generation:**
- ✓ Keyword match: "wildfire" → wildfire disaster
- ✓ Geographic: 55km distance
- ✓ Temporal: 33 hours after disaster

**Expected AI Response:**
```json
{
  "disaster_id": "firms-cluster:2026-10-02:38.0:-122.0",
  "relationship": true,
  "type": "REPORTS_ON",
  "directness": "DIRECT",
  "confidence": 0.95,
  "mechanism": "Article directly reports on this wildfire event, describing evacuation orders for communities within the fire's impact zone. The FIRMS satellite detection occurred 33 hours before article publication, consistent with on-ground reporting timeline.",
  "evidence": [
    "Article headline states 'Wildfire Forces 10,000 to Evacuate in Napa Valley'",
    "Article location (38.5, -122.5) is 55km from FIRMS hotspot (38.0, -122.0)",
    "FIRMS hotspot detected with very high FRP (790.92) indicating major fire",
    "Article keywords 'wildfire', 'evacuation', 'emergency' match expected disaster impacts",
    "Time gap of 33 hours between detection and article is typical for wildfire reporting"
  ]
}
```

**Quality Check:**
- ✓ Directness: DIRECT (not CONTEXTUAL)
- ✓ Confidence: 0.95 (≥ 0.7)
- ✓ Mechanism: Specific, not generic
- ✓ Evidence: 5 concrete facts

**Result:** ✅ ACCEPT - Store link in database

---

### Scenario 2: Indirect Mention (Medium Link)

**Input:**

News:
```json
{
  "title": "Air Quality Alerts Issued for Bay Area Residents",
  "summary": "Health officials issued air quality warnings due to smoke from nearby wildfires affecting the region...",
  "keywords": ["air quality", "smoke", "health", "Bay Area"],
  "published": "2026-10-04T14:00:00Z",
  "location": [37.8, -122.4]
}
```

Disaster:
```json
{
  "id": "firms-cluster:2026-10-02:38.0:-122.0",
  "type": "wildfire",
  "occurred": "2026-10-02T00:00:00Z",
  "location": [38.0, -122.0]
}
```

**Expected AI Response:**
```json
{
  "disaster_id": "firms-cluster:2026-10-02:38.0:-122.0",
  "relationship": true,
  "type": "MENTIONS",
  "directness": "INDIRECT",
  "confidence": 0.78,
  "mechanism": "Article discusses air quality impacts from wildfires, which includes this FIRMS-detected fire cluster. The article mentions 'smoke from nearby wildfires' and the disaster location is 60km north, consistent with smoke dispersion patterns.",
  "evidence": [
    "Article states 'smoke from nearby wildfires affecting the region'",
    "Disaster is 60km upwind from article location",
    "Article published 2.5 days after fire detection, allowing time for smoke impact",
    "Article keywords include 'smoke' which is direct consequence of wildfires"
  ]
}
```

**Quality Check:**
- ✓ Directness: INDIRECT (acceptable)
- ✓ Confidence: 0.78 (≥ 0.7)
- ✓ Mechanism: Specific connection (smoke impact)
- ✓ Evidence: 4 concrete facts

**Result:** ✅ ACCEPT - Store link in database

---

### Scenario 3: No Connection (Rejected)

**Input:**

News:
```json
{
  "title": "Tech Company Announces New Product Launch",
  "summary": "Major technology firm unveils new smartphone model...",
  "keywords": ["technology", "product", "innovation"],
  "published": "2026-10-03T10:00:00Z",
  "location": [37.8, -122.4]
}
```

Disaster:
```json
{
  "id": "firms-cluster:2026-10-02:38.0:-122.0",
  "type": "wildfire",
  "occurred": "2026-10-02T00:00:00Z",
  "location": [38.0, -122.0]
}
```

**Expected AI Response:**
```json
{
  "disaster_id": "firms-cluster:2026-10-02:38.0:-122.0",
  "relationship": false,
  "type": "NONE",
  "directness": "CONTEXTUAL",
  "confidence": 0.15,
  "mechanism": "Article does not mention, reference, or relate to this wildfire. While both events occurred in Northern California within 24 hours, the article is about a technology product launch and contains no disaster-related content.",
  "evidence": []
}
```

**Quality Check:**
- ✗ Relationship: false
- ✗ Confidence: 0.15 (< 0.7)

**Result:** ❌ REJECT - No link created

---

### Scenario 4: Weak Contextual (Rejected)

**Input:**

News:
```json
{
  "title": "California Wine Industry Faces Challenges",
  "summary": "Winemakers discuss various challenges facing the industry including climate, labor, and market conditions...",
  "keywords": ["wine", "agriculture", "California", "industry"],
  "published": "2026-10-05T11:00:00Z",
  "location": [38.3, -122.3]
}
```

Disaster:
```json
{
  "id": "firms-cluster:2026-10-02:38.0:-122.0",
  "type": "wildfire",
  "occurred": "2026-10-02T00:00:00Z",
  "location": [38.0, -122.0]
}
```

**Expected AI Response:**
```json
{
  "disaster_id": "firms-cluster:2026-10-02:38.0:-122.0",
  "relationship": true,
  "type": "MENTIONS",
  "directness": "CONTEXTUAL",
  "confidence": 0.45,
  "mechanism": "Both involve California wine region and occurred within days of each other. However, article does not explicitly mention wildfires or this specific fire event.",
  "evidence": [
    "Article discusses wine industry challenges",
    "Article location is in wine country near wildfire",
    "Wildfires could affect wine industry (implied but not stated)"
  ]
}
```

**Quality Check:**
- ✗ Directness: CONTEXTUAL (reject)
- ✗ Confidence: 0.45 (< 0.7)
- ✗ Mechanism: Generic ("both involve X")
- ✗ Evidence: Speculative

**Result:** ❌ REJECT - Too weak/speculative

---

## Special Considerations

### Disaster Metadata Enrichment

Disasters have structured metadata that news lacks:

**Earthquakes:**
```json
{
  "magnitude": 6.5,
  "depth_km": 10.2,
  "alert_level": "Orange",
  "place": "Iran"
}
```

**Wildfires:**
```json
{
  "hotspot_count": 45,
  "max_frp": 790.92,
  "burned_area_ha": 15000
}
```

**Cyclones:**
```json
{
  "storm_name": "Haiyan",
  "max_wind_kmh": 215,
  "storm_class": "Super Typhoon"
}
```

**Use this in prompts:**
- Include relevant metadata in disaster descriptions
- Example: "M 6.5 earthquake, 10km deep, Orange alert"
- Helps AI understand severity and coverage-worthiness

---

### Temporal Logic

**Key insight:** News ALWAYS comes AFTER disasters

```python
# Valid relationship
disaster.occurred_at < news.published_at < disaster.occurred_at + 14 days

# Invalid (news can't report on future disasters)
news.published_at < disaster.occurred_at
```

**Time windows by disaster type:**
```python
REPORTING_WINDOWS = {
    'earthquake': 7,   # Immediate + aftershock coverage
    'wildfire': 14,    # Ongoing events, multiple days
    'cyclone': 10,     # Build-up + impact + aftermath
    'flood': 14,       # Ongoing events
    'volcano': 14,     # Eruptions can be ongoing
    'drought': 30      # Long-term coverage
}
```

---

## Expected Outputs

### Quantitative

From 78 news articles:
- **Candidates:** 80-170 (from 72,774 theoretical)
- **API calls:** 16-34 (batched)
- **Cost:** $0.016-$0.034
- **Time:** 3-7 minutes
- **Links created:** 10-40

### Qualitative

**Link distribution (estimated):**
- **10-20 REPORTS_ON links:** Direct disaster reporting
  - Example: "Wildfire forces evacuations"
- **5-10 MENTIONS links:** Disaster mentioned in context
  - Example: "Air quality worsens from wildfires"
- **2-5 ANALYZES links:** Impact analysis
  - Example: "Economic toll of recent fires"

**Quality characteristics:**
- All links have specific mechanisms
- All links have supporting evidence
- No speculative connections
- No "merely nearby" contextual links

---

## Cost & Performance

### Cost Breakdown

```
Candidate generation: Free (database queries)
AI verification: ~30 API calls × $0.001 = $0.03
Database writes: Free
Total: ~$0.03 per run
```

**Comparison:**
- Naive (all pairs): 72,774 calls = $72.77
- Filtered individual: 500 calls = $0.50
- **Smart batched: 30 calls = $0.03** ✓

### Performance

```
Candidate generation: ~5 seconds
AI reasoning: ~3-5 minutes (batched, sequential)
Quality filtering: ~1 second
Database writes: ~1 second
Total: ~5-7 minutes
```

---

## Integration

### Into Unified Script

```python
# jobs/llm/link_events.py

def link_news_to_disasters(conn, client) -> dict:
    """Link news to disasters using mechanism-first reasoning."""
    
    # 1. Fetch data
    news_events = fetch_news_events(conn)
    disasters = fetch_disasters(conn)
    
    # 2. Generate candidates
    candidates = generate_news_disaster_candidates(
        news_events, 
        disasters,
        strategies=['keyword', 'geographic', 'temporal']
    )
    
    # 3. Batch and verify
    links_created = 0
    for news_id, disaster_batch in batch_candidates(candidates, size=5):
        verified = verify_with_gemini(client, news_id, disaster_batch)
        
        for link in verified:
            if passes_quality_filter(link):
                insert_link(conn, link)
                links_created += 1
    
    return {
        'candidates': len(candidates),
        'links_created': links_created
    }
```

### Into Pipeline

```python
# jobs/pipeline.py

def run_pipeline(..., run_link=True):
    if run_link:
        from jobs.llm.link_events import link_all_events
        
        result = link_all_events(
            link_news_news=True,      # Already implemented
            link_news_disasters=True  # To be implemented
        )
```

---

## Questions for You

Before implementing, please consider:

### 1. Time Windows

Current proposal: 14 days before news publication

**Question:** Is 14 days appropriate?
- Too short? Might miss follow-up analysis articles
- Too long? Might create false connections
- Vary by disaster type? (e.g., 7 days for earthquakes, 30 for droughts)

### 2. Geographic Radius

Current proposal: 200km for geographic clustering

**Question:** Is 200km right?
- Too small? Might miss regional coverage
- Too large? Might create false connections
- Vary by disaster type? (e.g., 100km for earthquakes, 500km for wildfires)

### 3. Significance Threshold

Current proposal: significance > 60 for geographic, > 80 for temporal

**Question:** Are these thresholds appropriate?
- We have 933 disasters with varying significance
- What qualifies as "newsworthy"?
- Should it vary by disaster type?

### 4. Disaster Metadata

**Question:** How much disaster detail to include in prompts?

Option A: Minimal
```
"M 6.5 earthquake in Iran"
```

Option B: Detailed
```
"M 6.5 earthquake in Iran, 10km deep, Orange alert level, 
affected population: 500,000, alert score: 2.3"
```

More detail helps AI understand severity but increases token costs.

### 5. Directness Handling

**Question:** Should we accept INDIRECT links?

Current: Accept DIRECT and INDIRECT, reject CONTEXTUAL

Alternative: Only accept DIRECT (stricter, fewer but higher quality links)

### 6. News Without Disasters

**Question:** What about news articles that don't match any disasters?

Options:
- Accept they won't have disaster links (most news isn't about disasters)
- Still try to find weak connections (might create false positives)
- Track metrics on coverage (what % of news is disaster-related)

---

## My Recommendations

1. **Start conservative:**
   - 14-day window
   - 200km radius  
   - Accept DIRECT and INDIRECT
   - Detailed disaster metadata in prompts

2. **Run small test:**
   - Test on 5 news articles
   - Review AI responses manually
   - Adjust thresholds if needed
   - Cost: ~$0.01

3. **Iterate:**
   - Run full dataset
   - Review sample of links
   - Tune parameters based on results
   - Re-run if needed

4. **Monitor metrics:**
   - Links created per news article (expect 0.1-0.5 avg)
   - Confidence distribution
   - Directness distribution
   - Manual quality spot-checks

---

## Next Steps

1. **Review this proposal** - adjust parameters as needed
2. **Implement in link_events.py** - add to the TODO section
3. **Test on small batch** - validate approach
4. **Run full dataset** - create production links
5. **Integrate into pipeline** - add to unified workflow

What are your thoughts on the time windows, geographic radius, and other parameters?
