# Ingestion Expansion Options

## Quick Wins (Using Existing GNews API)

### 1. Increase articles per category
**Change:** Modify `max_per_category` in `gnews.py`
```python
# Current: 10 articles per category = ~90 max
# Change to: 100 articles per category = ~900 max (hits free tier limit)
fetch_all(max_per_category=100)
```

### 2. Add country-specific ingestion
GNews supports country filtering for localized news:

```python
def fetch_by_country(country_code: str, max_articles: int = 50) -> list[dict]:
    """
    country_code: "us", "gb", "au", "ca", "in", "za", etc.
    """
    params = urllib.parse.urlencode({
        "country": country_code,
        "lang": "en",
        "max": max_articles,
        "apikey": GNEWS_API_KEY,
    })
    # ...
```

**Example countries for diverse coverage:**
- `us` - United States
- `gb` - United Kingdom  
- `au` - Australia
- `ca` - Canada
- `in` - India
- `za` - South Africa
- `ng` - Nigeria
- `ke` - Kenya

**Trade-off:** Each country request counts toward your 100/day limit

### 3. Multi-language support
```python
# Add Spanish, French, etc.
"lang": "es"  # Spanish
"lang": "fr"  # French
"lang": "de"  # German
```

---

## New Data Sources (Free/Low-cost)

### 1. RSS Feed Aggregation
**Pros:** Free, unlimited, highly customizable  
**Cons:** Requires parsing, no standardization

**Good RSS sources:**
- BBC News: `http://feeds.bbci.co.uk/news/world/rss.xml`
- Reuters: `https://www.reuters.com/rssFeed/worldNews`
- Al Jazeera: `https://www.aljazeera.com/xml/rss/all.xml`
- Local news aggregators (hundreds available)

### 2. NewsAPI.org
**Free tier:** 100 requests/day, 100 articles per request  
**Coverage:** 150,000+ sources globally  
**Localization:** Filter by country, category, language  
**Cost:** Free for dev, $449/mo for production

### 3. MediaStack API
**Free tier:** 500 requests/month  
**Coverage:** 75,000+ sources, real-time news  
**Localization:** Country and language filters

### 4. EventRegistry.org
**Free tier:** 2,000 articles/day  
**Strength:** Event-based (not just articles), good deduplication  
**Localization:** Excellent geographic filtering

### 5. GDELT Project (Free, Unlimited)
**Already referenced in your docs!**
- 100+ million events/year
- Real-time global event database
- Free BigQuery access
- **Best for:** Conflict, politics, humanitarian events with precise geocoding

### 6. The Guardian API (Free)
**Free tier:** 12 requests/second, no daily limit  
**Coverage:** Guardian articles + wire services  
**Localization:** Good UK/Europe coverage

---

## Recommended Expansion Strategy

### Phase 1: Maximize existing GNews (5 minutes)
```bash
# Increase max per category from 10 to 50
# Stay under 100 req/day limit
max_per_category = 50  # 9 categories × 50 = 450 articles
```

### Phase 2: Add country-specific feeds (1 hour)
```python
# jobs/ingest/scrapers/gnews.py
def fetch_all(max_per_category: int = 10, countries: list[str] = None) -> list[dict]:
    """
    countries: ["us", "gb", "in", "za"] for localized coverage
    """
    # Fetch global + country-specific batches
```

### Phase 3: Add RSS aggregator (2-4 hours)
- Create `jobs/ingest/scrapers/rss.py`
- Parse feeds from BBC, Reuters, Al Jazeera, local sources
- Use `feedparser` library
- **Benefit:** Unlimited free articles from hundreds of sources

### Phase 4: Add GDELT integration (4-8 hours)
- Already mentioned in your architecture docs
- Best for geo-located political/conflict/humanitarian events
- Free BigQuery API
- **Benefit:** Precise coordinates for most events

---

## Immediate Test

Want to quickly test getting more articles? Run:

```bash
# Get 50 articles per category instead of 10 (450 total)
python -c "
from jobs.ingest.scrapers.gnews import fetch_all
articles = fetch_all(max_per_category=50)
print(f'Fetched {len(articles)} articles')
"
```

---

## Cost Comparison

| Source | Free Tier | Cost at Scale | Best For |
|--------|-----------|---------------|----------|
| GNews | 100 req/day | $10/mo (10K req) | Quick start |
| RSS Feeds | Unlimited | Free | DIY, flexible |
| NewsAPI | 100 req/day | $449/mo | Production scale |
| EventRegistry | 2K articles/day | $99/mo | Event deduplication |
| GDELT | Unlimited | Free | Geo-political events |
| Guardian API | Unlimited | Free | UK/Europe news |
