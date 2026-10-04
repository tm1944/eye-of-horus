# News → Disaster Linking Proposal V2

**Simplified Architecture:** Same AI-first approach as news→news, with special handling for "same event" relationships

---

## Core Principle

**No programmatic filtering.** Let AI do ALL the reasoning.

- ✅ Same batch processing as news→news
- ✅ Same mechanism-first prompts
- ✅ Same quality filtering
- ❌ No time window checks
- ❌ No geographic radius checks  
- ❌ No keyword matching

**Why:** All our data is recent anyway. AI is better at determining relevance than arbitrary thresholds.

---

## Key Distinction: Two Types of Links

### Type 1: PRIMARY_STORY (Merge in UI)

**Meaning:** News article IS ABOUT this specific disaster event

**Example:**
```
News: "M 6.5 Earthquake Strikes Japan, Dozens Injured"
  ↓ PRIMARY_STORY
Disaster: USGS earthquake event "M 6.5 - 50km E of Tokyo"

→ Frontend displays: Show news article AS the disaster event
                     (Not a separate node with a line between them)
```

**Use case:** When news directly reports on a specific disaster in the database

---

### Type 2: RELATED (Show as correlation line)

**Meaning:** News article mentions/relates to disaster but isn't primarily about it

**Example:**
```
News: "Economic Impact of Recent Natural Disasters"
  ↓ RELATED (mentions)
Disaster: USGS earthquake event "M 6.5 - 50km E of Tokyo"

→ Frontend displays: Two separate nodes with correlation line
```

**Use case:** News mentions disaster in context, analyzes impacts, etc.

---

## Architecture: Identical to News→News

### Step 1: Batch All Disasters

**No candidate filtering.** Send ALL disasters to AI in batches.

```python
def link_news_to_disasters(conn, client):
    news_events = fetch_all_news(conn)
    disasters = fetch_all_disasters(conn)
    
    for news in news_events:
        # Batch disasters into groups of 5-10
        for batch in chunk_disasters(disasters, size=5):
            links = ask_gemini_batch(news, batch)
            store_links(links)
```

**Cost:** 78 news × (933 disasters / 5 per batch) = ~14,500 API calls

**Wait, that's expensive!** Let me recalculate...

Actually: 78 news × 187 batches = 14,586 calls × $0.001 = **$14.59**

Hmm, that's more expensive than expected. Do you want to:
- A) Accept the cost (still reasonable for production)
- B) Add some lightweight filtering (e.g., only disasters from past 30 days)
- C) Use larger batches (10-15 per call to reduce API calls)

---

## Alternative: Lightweight Temporal Filter

**If cost is a concern:**

```python
# Only consider disasters from past 30 days
recent_disasters = [d for d in disasters 
                    if (now - d.occurred_at).days <= 30]

# 78 news × (50-100 recent disasters / 5 per batch) = ~1,200 calls
# Cost: ~$1.20
```

**This is NOT programmatic matching.** Just reducing the search space before AI.

Your preference?

---

## Relationship Types

### For News→Disaster Links

```python
RELATIONSHIP_TYPES = {
    'PRIMARY_STORY': {
        'description': 'News article is ABOUT this specific disaster',
        'frontend_behavior': 'merge',  # Show as single entity
        'examples': [
            'Article headline matches disaster',
            'Article location matches disaster location',
            'Article describes this specific event'
        ]
    },
    
    'MENTIONS': {
        'description': 'News article mentions this disaster',
        'frontend_behavior': 'link',  # Show as correlation line
        'examples': [
            'Article discusses multiple disasters, includes this one',
            'Article mentions disaster in passing',
            'Article references disaster statistics'
        ]
    },
    
    'ANALYZES': {
        'description': 'News article analyzes impacts of this disaster',
        'frontend_behavior': 'link',  # Show as correlation line
        'examples': [
            'Economic impact analysis',
            'Policy response analysis',
            'Long-term effects discussion'
        ]
    }
}
```

---

## AI Prompt Design

### Batch Prompt for News→Disaster

```
You are an expert at identifying relationships between news articles and 
natural disaster events.

Your task: Determine which, if any, of these disasters are connected to this 
news article.

CRITICAL DISTINCTION:

PRIMARY_STORY: The news article is PRIMARILY ABOUT this specific disaster
  - Article headline/summary describes this disaster
  - Article's main subject is this specific event
  - Location, timing, and details match this disaster

MENTIONS: Article references this disaster but isn't primarily about it
  - Article mentions disaster in context
  - Article includes disaster in broader discussion
  - Article is about related topic but mentions disaster

ANALYZES: Article analyzes impacts of this disaster
  - Economic, social, or policy impacts
  - Aftermath or recovery discussion
  - Long-term effects analysis

NONE: No meaningful connection

RULES:

1. Only use PRIMARY_STORY when:
   - Article is explicitly about THIS disaster
   - Details match (location, magnitude/severity, timing)
   - This is the article's main subject

2. Use MENTIONS when:
   - Article references disaster but has other focus
   - Disaster mentioned in passing
   - Part of broader discussion

3. Use ANALYZES when:
   - Article discusses disaster impacts/effects
   - Policy or response discussion
   - Economic or social analysis

4. Provide evidence from BOTH article and disaster

5. Be conservative with PRIMARY_STORY
   - Only use when article clearly about this specific event
   - When in doubt, use MENTIONS instead

NEWS ARTICLE:
Title: {{title}}
Summary: {{summary}}
Published: {{date}}
Location: {{location}}
Keywords: {{keywords}}

CANDIDATE DISASTERS:

Disaster 1:
  Type: {{category}}
  Title: {{title}}
  Occurred: {{date}}
  Location: {{location}}
  Details: {{magnitude, FRP, wind speed, etc}}

Disaster 2:
  ...

RESPOND WITH JSON ARRAY:

[
  {
    "disaster_id": "...",
    "relationship": true,
    "type": "PRIMARY_STORY | MENTIONS | ANALYZES | NONE",
    "confidence": 0.0-1.0,
    "mechanism": "Specific explanation of connection",
    "evidence": [
      "Fact from article",
      "Fact from disaster"
    ]
  }
]
```

---

## Database Schema

### Add Frontend Behavior Field

```sql
-- Add column to indicate frontend behavior
ALTER TABLE mart.event_link
  ADD COLUMN IF NOT EXISTS display_mode VARCHAR(20);

COMMENT ON COLUMN mart.event_link.display_mode IS
  'How frontend should display: merge (PRIMARY_STORY) or link (MENTIONS/ANALYZES)';

-- Allowed values
ALTER TABLE mart.event_link
  ADD CONSTRAINT valid_display_mode CHECK (
    display_mode IN ('merge', 'link')
  );
```

### Link Record Examples

**PRIMARY_STORY (merge in UI):**
```json
{
  "link_id": "link:gnews:abc123:usgs:us7000xyz",
  "source_id": "gnews:abc123",
  "target_id": "usgs:us7000xyz",
  "relation": "primary_story",
  "display_mode": "merge",
  "confidence": 0.96,
  "rationale": "Article directly reports on this specific earthquake event. Headline states 'M 6.5 Earthquake Strikes Japan' matching USGS event title. Location, magnitude, and timing match exactly.",
  "evidence": [
    "Article headline: 'M 6.5 Earthquake Strikes Japan, Dozens Injured'",
    "USGS event: M 6.5 - 50km E of Tokyo, occurred same date",
    "Article location (35.7, 140.1) matches disaster location (35.7, 140.0)",
    "Article describes this specific seismic event"
  ]
}
```

**MENTIONS (show as link):**
```json
{
  "link_id": "link:gnews:def456:usgs:us7000xyz",
  "source_id": "gnews:def456",
  "target_id": "usgs:us7000xyz",
  "relation": "mentions",
  "display_mode": "link",
  "confidence": 0.82,
  "rationale": "Article discusses multiple recent disasters including this earthquake. Earthquake mentioned in context of regional disaster preparedness discussion.",
  "evidence": [
    "Article mentions 'recent earthquake in Japan' in paragraph 3",
    "USGS earthquake matches timing and location mentioned",
    "Article's main topic is disaster preparedness, not this specific quake"
  ]
}
```

---

## Implementation in link_events.py

### Simplified Structure

```python
def link_news_to_disasters(conn, client) -> dict:
    """
    Link news to disasters using same AI-first approach as news↔news.
    
    Key difference: Distinguish PRIMARY_STORY (merge) vs MENTIONS/ANALYZES (link)
    """
    
    # Fetch data
    news_events = fetch_news(conn)
    disasters = fetch_disasters(conn)
    
    # Optional: Filter to recent disasters only (cost control)
    recent_disasters = [d for d in disasters 
                       if (datetime.now() - d['occurred_at']).days <= 30]
    
    links_created = 0
    api_calls = 0
    
    for news in news_events:
        # Batch disasters
        for batch in chunk(recent_disasters, size=5):
            # Same AI reasoning as news↔news
            verified = verify_news_disaster_batch(client, news, batch)
            api_calls += 1
            
            for link_data in verified:
                if not link_data['relationship']:
                    continue
                
                # Quality filtering (same as news↔news)
                if not passes_quality_filter(link_data):
                    continue
                
                # Map to display mode
                display_mode = 'merge' if link_data['type'] == 'PRIMARY_STORY' else 'link'
                
                # Create link
                link = {
                    'link_id': f"link:{news['id']}:{link_data['disaster_id']}",
                    'source_id': news['id'],
                    'target_id': link_data['disaster_id'],
                    'relation': link_data['type'].lower(),
                    'display_mode': display_mode,
                    'confidence': link_data['confidence'],
                    'rationale': link_data['mechanism'],
                    'citations': json.dumps([]),
                    'model': 'gemini-2.0-flash-exp'
                }
                
                insert_link(conn, link)
                links_created += 1
    
    return {
        'news_count': len(news_events),
        'disasters_evaluated': len(recent_disasters),
        'api_calls': api_calls,
        'links_created': links_created
    }
```

---

## Cost & Performance

### With 30-Day Filter

```
78 news articles
× 50-100 recent disasters (estimated)
÷ 5 per batch
= 780-1,560 API calls
× $0.001 per call
= $0.78-$1.56 per run
```

**Time:** 10-20 minutes (sequential batching)

### Without Filter (All Disasters)

```
78 news articles
× 933 disasters
÷ 5 per batch
= 14,586 API calls
× $0.001 per call
= $14.59 per run
```

**Time:** ~2 hours (sequential batching)

**Optimization:** Could do parallel batching to reduce time

---

## Expected Output

### Quantitative

- **PRIMARY_STORY links:** 5-15 (news articles that are ABOUT specific disasters)
- **MENTIONS links:** 10-25 (news that references disasters)
- **ANALYZES links:** 3-8 (impact/analysis articles)
- **Total:** 18-48 links

### Qualitative

**PRIMARY_STORY examples:**
- "California Wildfire Forces Evacuations" → FIRMS wildfire cluster
- "M 6.5 Earthquake Strikes Japan" → USGS earthquake event
- "Typhoon Haiyan Makes Landfall" → GDACS cyclone

**MENTIONS examples:**
- "Energy Markets React to Global Events" → mentions Iran earthquake
- "Air Quality Concerns" → mentions California wildfires
- "Disaster Preparedness" → mentions recent floods

---

## Frontend Display Behavior

### PRIMARY_STORY (merge)

```javascript
// When display_mode === 'merge'
// Show news article AS the disaster event's primary content

<DisasterMarker location={disaster.location}>
  <DisasterIcon type={disaster.type} />
  <NewsArticlePreview article={linkedNews} />  // Show article here
  <DisasterMetadata data={disaster.attributes} />
</DisasterMarker>
```

### MENTIONS/ANALYZES (link)

```javascript
// When display_mode === 'link'
// Show as two separate nodes with correlation line

<NewsMarker location={news.location} />
  ↕ (correlation line)
<DisasterMarker location={disaster.location} />
```

---

## Questions for You

### 1. Cost vs Completeness

**Option A:** All disasters (~$15, 2 hours)
- Complete coverage
- Finds all possible links
- Expensive

**Option B:** Recent disasters only (30 days) (~$1, 15 minutes)
- Most news is about recent disasters anyway
- Much cheaper
- Might miss some analysis articles about older disasters

**Your preference?**

---

### 2. Batch Size

**Current:** 5 disasters per API call

**Could increase to 10-15 to reduce costs:**
- 78 × (100 disasters / 10) = 780 calls = $0.78
- Faster execution
- Might reduce quality (model has more to compare)

**Your preference?**

---

### 3. Parallel Processing

**Current:** Sequential (one batch at a time)

**Could parallelize:**
- Process multiple news articles simultaneously
- 10x faster (2 hours → 12 minutes)
- Same cost
- More complex code

**Your preference?**

---

## My Recommendation

**Start with:**
1. **30-day disaster filter** (cost: ~$1)
2. **Batch size: 5** (proven to work well)
3. **Sequential processing** (simpler, good enough)
4. **Run and evaluate results**
5. **Expand if needed** (remove filter, increase batches)

This gets us 90% of the value at 10% of the cost.

**Does this align with your vision?**

---

## Summary

✅ **Removed:** All programmatic filtering (time, distance, keywords)  
✅ **Kept:** Same AI-first architecture as news→news  
✅ **Added:** PRIMARY_STORY type for "merge in UI" behavior  
✅ **Added:** display_mode database field  
✅ **Cost:** ~$1 with recent filter, ~$15 without  
✅ **Time:** ~15 min with filter, ~2 hours without

Ready to implement with these parameters?
