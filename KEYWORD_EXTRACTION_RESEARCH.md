# Keyword Extraction Research for News Event API

## Problem: Entities vs Keywords

### Current "Entities" Approach (NER):
```json
{
  "entities": [
    {"type": "person", "text": "President Biden", "confidence": 0.95},
    {"type": "org", "text": "Turkish Football Federation", "confidence": 0.98}
  ]
}
```

**Limitations:**
- ❌ Only captures WHO/WHERE/WHAT organizations
- ❌ Misses topics/themes (corruption, climate change, AI)
- ❌ Hard to search: "show me articles about corruption" won't match
- ❌ Limited categorization

### Desired "Keywords" Approach:
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

**Benefits:**
- ✅ Captures topical themes (corruption, climate change, AI)
- ✅ Includes named entities (organizations, people, places)
- ✅ Includes concepts (sports governance, sustainability)
- ✅ Searchable: "articles about corruption" matches
- ✅ Better categorization and filtering
- ✅ Enables recommendations based on user interests

---

## Types of Keywords for News Articles

| Type | Description | Examples |
|------|-------------|----------|
| **topic** | What the article is fundamentally about | artificial intelligence, climate change, elections, economy |
| **entity** | Specific named items | OpenAI, President Biden, Tokyo, Asian Games |
| **concept** | Abstract ideas or themes | innovation, corruption, sustainability, diplomacy |
| **location** | Geographic places | Turkey, California, Brussels, San Francisco |
| **technology** | Specific technologies | GPT-5, CRISPR, blockchain, renewable energy |
| **event** | Events or actions | elections, protests, summit, merger, arrest |
| **industry** | Relevant sectors | healthcare, finance, technology, sports |
| **organization** | Named organizations | NATO, Google, Turkish Football Federation |
| **person** | Named individuals | Elon Musk, President Biden, Roy Horn |

---

## Best Practices for LLM Keyword Extraction

### 1. Specify Quantity
```
Extract 8-15 keywords
- Not too few: misses important context
- Not too many: dilutes relevance
```

### 2. Specify Diversity
```
Balance:
- Broad themes (2-3): "artificial intelligence", "climate change"
- Specific topics (3-5): "GPT-5", "carbon emissions", "elections"
- Named entities (3-5): "OpenAI", "Tokyo", "President Biden"
```

### 3. Specify What to Avoid
```
Avoid:
- Generic terms: "news", "article", "story", "today", "event"
- Stopwords: "the", "and", "or", "but"
- Single letters: "A", "B", "C"
- Overly broad: "thing", "situation", "matter"
```

### 4. Request Relevance Scoring
```
Score each keyword by centrality to the article:
- 0.9-1.0: Core topic of the article
- 0.8-0.89: Highly relevant, mentioned prominently
- 0.7-0.79: Moderately relevant, supporting detail
- 0.6-0.69: Mentioned but not central
- Below 0.6: Don't include
```

### 5. Normalize Keywords
```
- Use lowercase
- Use singular or plural based on common usage
- Prefer full terms over acronyms (unless acronym is standard)
  ✅ "artificial intelligence" or "AI"
  ❌ "A.I.", "A I"
- Use multi-word phrases when appropriate
  ✅ "machine learning", "climate change"
  ❌ "machine", "learning" (separate)
```

### 6. Include Keyword Types
Helps with filtering and categorization in API

---

## Real-World Examples

### Example 1: Tech Article
**Article:** "OpenAI releases GPT-5 with improved reasoning capabilities and multimodal support"

**Keywords:**
```json
[
  {"text": "artificial intelligence", "relevance": 0.95, "type": "topic"},
  {"text": "OpenAI", "relevance": 0.90, "type": "organization"},
  {"text": "GPT-5", "relevance": 0.92, "type": "technology"},
  {"text": "natural language processing", "relevance": 0.85, "type": "concept"},
  {"text": "machine learning", "relevance": 0.80, "type": "topic"},
  {"text": "multimodal AI", "relevance": 0.88, "type": "concept"},
  {"text": "AI reasoning", "relevance": 0.87, "type": "concept"},
  {"text": "technology", "relevance": 0.75, "type": "industry"}
]
```

**API Search Examples:**
- `GET /feed?search=artificial+intelligence` ✅ Found
- `GET /feed?search=GPT` ✅ Found (partial match "GPT-5")
- `GET /feed?keywords=machine+learning` ✅ Found
- `GET /feed?organization=OpenAI` ✅ Found

---

### Example 2: Political Event
**Article:** "Turkey's football referee chief arrested on corruption charges. The Turkish Football Federation announced reforms to oversight body."

**Keywords:**
```json
[
  {"text": "corruption", "relevance": 0.95, "type": "topic"},
  {"text": "football", "relevance": 0.90, "type": "industry"},
  {"text": "Turkey", "relevance": 0.92, "type": "location"},
  {"text": "Turkish Football Federation", "relevance": 0.88, "type": "organization"},
  {"text": "sports governance", "relevance": 0.85, "type": "concept"},
  {"text": "referee", "relevance": 0.82, "type": "entity"},
  {"text": "arrest", "relevance": 0.80, "type": "event"},
  {"text": "oversight reform", "relevance": 0.75, "type": "concept"},
  {"text": "sports", "relevance": 0.70, "type": "industry"}
]
```

**API Search Examples:**
- `GET /feed?search=corruption` ✅ Found
- `GET /feed?location=Turkey` ✅ Found
- `GET /feed?keywords=sports+governance` ✅ Found
- `GET /feed?industry=football` ✅ Found

---

### Example 3: Natural Disaster
**Article:** "Magnitude 7.2 earthquake strikes Tokyo, hundreds evacuated as aftershocks continue"

**Keywords:**
```json
[
  {"text": "earthquake", "relevance": 1.0, "type": "event"},
  {"text": "Tokyo", "relevance": 0.95, "type": "location"},
  {"text": "Japan", "relevance": 0.90, "type": "location"},
  {"text": "natural disaster", "relevance": 0.88, "type": "topic"},
  {"text": "seismic activity", "relevance": 0.85, "type": "concept"},
  {"text": "emergency response", "relevance": 0.80, "type": "concept"},
  {"text": "evacuation", "relevance": 0.82, "type": "event"},
  {"text": "aftershocks", "relevance": 0.78, "type": "event"},
  {"text": "disaster relief", "relevance": 0.70, "type": "concept"}
]
```

---

## Recommended Prompt Design

### Option 1: Detailed with Examples (Recommended)

```
keywords (array): Extract 8-15 relevant keywords for search and categorization

Guidelines:
- Include diverse mix: broad topics (2-3) + specific terms (5-7) + named entities (3-5)
- Types: topic, entity, concept, location, technology, event, industry, organization, person
- Avoid generic words: "news", "article", "report", "story", "today", "event"
- Include what the article is ABOUT, not just what's mentioned
- Relevance 0.6-1.0 (only include if central or highly relevant)
- Format: {"text": "keyword", "relevance": 0.0-1.0, "type": "..."}

Examples:

Article: "OpenAI releases GPT-5 with improved reasoning"
Keywords: [
  {"text": "artificial intelligence", "relevance": 0.95, "type": "topic"},
  {"text": "OpenAI", "relevance": 0.90, "type": "organization"},
  {"text": "GPT-5", "relevance": 0.92, "type": "technology"},
  {"text": "natural language processing", "relevance": 0.85, "type": "concept"},
  {"text": "machine learning", "relevance": 0.80, "type": "topic"}
]

Article: "Turkey football referee arrested on corruption charges"
Keywords: [
  {"text": "corruption", "relevance": 0.95, "type": "topic"},
  {"text": "football", "relevance": 0.90, "type": "industry"},
  {"text": "Turkey", "relevance": 0.92, "type": "location"},
  {"text": "Turkish Football Federation", "relevance": 0.88, "type": "organization"},
  {"text": "sports governance", "relevance": 0.85, "type": "concept"},
  {"text": "arrest", "relevance": 0.80, "type": "event"}
]

Article: "Earthquake strikes Tokyo, hundreds evacuated"
Keywords: [
  {"text": "earthquake", "relevance": 1.0, "type": "event"},
  {"text": "Tokyo", "relevance": 0.95, "type": "location"},
  {"text": "Japan", "relevance": 0.90, "type": "location"},
  {"text": "natural disaster", "relevance": 0.88, "type": "topic"},
  {"text": "emergency response", "relevance": 0.80, "type": "concept"},
  {"text": "evacuation", "relevance": 0.82, "type": "event"}
]
```

### Option 2: Concise

```
keywords (array): 8-15 searchable keywords/tags
- Mix: broad topics + specific entities + key concepts
- Include what article is ABOUT (themes, topics, subjects)
- Avoid: "news", "article", "story", stopwords
- Relevance: 0.6-1.0 (central to story)
- Types: topic, entity, concept, location, technology, event, industry, organization, person
- Format: {"text": "...", "relevance": 0.0-1.0, "type": "..."}
```

---

## API Use Cases

### 1. Keyword Search
```
GET /feed?keywords=artificial+intelligence
GET /feed?keywords=corruption,sports
GET /feed?keywords=climate+change
```

### 2. Filtered by Type
```
GET /feed?location=Turkey
GET /feed?organization=OpenAI
GET /feed?topic=artificial+intelligence
```

### 3. User Interest Matching
```
User interests: ["machine learning", "startups", "San Francisco"]
Match score = overlap between user keywords and event keywords
```

### 4. Trending Keywords
```
GET /trending/keywords?days=7
→ ["artificial intelligence", "elections", "climate change", ...]
```

### 5. Related Events
```
GET /events/123/related
→ Find events with similar keyword overlap
```

### 6. Auto-complete Search
```
GET /keywords/autocomplete?q=artif
→ ["artificial intelligence", "artificial neural networks", ...]
```

---

## Database Schema Recommendation

### Option 1: VARIANT Array (Simple)
```sql
ALTER TABLE MART.EVENT ADD COLUMN keywords VARIANT;

-- Store as JSON array
UPDATE MART.EVENT SET keywords = PARSE_JSON('[
  {"text": "AI", "relevance": 0.95, "type": "topic"},
  {"text": "OpenAI", "relevance": 0.90, "type": "organization"}
]');
```

**Pros:** Simple, flexible
**Cons:** Harder to index/search efficiently

### Option 2: Separate Table (Better for Search)
```sql
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

**Pros:** Fast keyword search, can index, easier filtering
**Cons:** More complex queries (need JOINs)

**Recommendation:** Use Option 2 for production (better performance)

---

## Implementation Steps

1. ✅ Update prompt to extract keywords instead of entities
2. ✅ Change field name from `entities` to `keywords`
3. ✅ Update response format with type hints
4. ⏳ Test on sample events
5. ⏳ Add database migration
6. ⏳ Update API to support keyword filtering
7. ⏳ Add keyword search endpoint

---

## Summary: Why Keywords > Entities

| Aspect | Entities (NER) | Keywords/Tags |
|--------|---------------|---------------|
| **Captures** | WHO, WHERE (names) | WHAT, WHY, HOW (topics) |
| **Searchability** | Limited (exact names only) | Excellent (topics, themes, concepts) |
| **Categorization** | Limited | Rich (industry, topic, concept) |
| **User Matching** | Hard | Easy (interest overlap) |
| **API Filtering** | Basic | Advanced (multi-faceted) |
| **Recommendations** | Name-based only | Theme + interest based |

**Conclusion:** Keywords provide much better search, categorization, and matching for the API use case.
