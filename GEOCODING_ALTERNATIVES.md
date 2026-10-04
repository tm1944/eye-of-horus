# Free Geocoding API Alternatives

## Your Use Case Analysis

**Requirements:**
- Geocode news events (cities, countries, regions)
- Batch processing: ~100 events per ingestion run
- Various location formats: "Manchester, United Kingdom", "Turkey", "San Francisco, California"
- Need reliable, accurate coordinates
- Run periodically (not constantly)

---

## Option 1: OpenStreetMap Nominatim ⭐ RECOMMENDED

### Overview
Free, community-driven geocoding service based on OpenStreetMap data. No API key required.

### Pros
- ✅ **Completely free** - No API key, no account needed
- ✅ **No monthly limits** - Unlimited requests (just rate limited)
- ✅ **Excellent coverage** - Global coverage, good for news events
- ✅ **Works immediately** - No setup, just add User-Agent header
- ✅ **Open source** - Community maintained
- ✅ **Good accuracy** - Comparable to Google for cities/countries

### Cons
- ⚠️ **Rate limit: 1 request/second** - 101 events = ~2 minutes (acceptable)
- ⚠️ **Fair use policy** - Must respect rate limits, add delays
- ⚠️ **No SLA** - Community service, occasional downtime

### Implementation
```python
import time
import urllib.request
import urllib.parse

def geocode_nominatim(place_text: str) -> dict | None:
    params = urllib.parse.urlencode({
        'q': place_text,
        'format': 'json',
        'limit': 1,
    })
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'hypothesis-globe/1.0 (news-event-mapping)'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        
        if data and len(data) > 0:
            return {
                "lat": float(data[0]["lat"]),
                "lng": float(data[0]["lon"])
            }
    except Exception:
        pass
    
    return None

# Usage with rate limiting
for event in events:
    coords = geocode_nominatim("Manchester, UK")
    time.sleep(1)  # Required: 1 second between requests
```

### Performance
- **Speed:** ~1-2 seconds per location (with required delay)
- **Batch:** 101 events = ~2 minutes total
- **Accuracy:** Very good for cities/countries

### Fair Use Policy
- Max 1 request/second
- Must set descriptive User-Agent
- No heavy usage (thousands per minute)
- Perfect for periodic news ingestion

---

## Option 2: Mapbox Geocoding API

### Overview
Commercial service with generous free tier. Requires API key.

### Pros
- ✅ **100,000 requests/month free** - More than enough
- ✅ **Fast & reliable** - Production-grade service
- ✅ **No rate limits** on free tier
- ✅ **Excellent accuracy** - Better than Nominatim for some locations
- ✅ **Good documentation**

### Cons
- ⚠️ **Requires account** - Need to sign up at mapbox.com
- ⚠️ **Requires API key** - One more credential to manage
- ⚠️ **Paid after 100k** - $0.50 per 1,000 after free tier

### Implementation
```python
def geocode_mapbox(place_text: str, access_token: str) -> dict | None:
    encoded = urllib.parse.quote(place_text)
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json?access_token={access_token}"
    
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        
        if data.get('features') and len(data['features']) > 0:
            coords = data['features'][0]['center']
            return {"lat": coords[1], "lng": coords[0]}
    except Exception:
        pass
    
    return None
```

### Performance
- **Speed:** < 1 second per location (no delay needed)
- **Batch:** 101 events = ~1 minute total
- **Accuracy:** Excellent

### Cost
- Free: 0-100,000 requests/month
- Paid: $0.50 per 1,000 after that
- **Your usage:** ~100 events/day = 3,000/month = Well within free tier

---

## Option 3: LocationIQ

### Overview
OSM-based commercial service with free tier. Good middle ground.

### Pros
- ✅ **5,000 requests/day free** - More than enough
- ✅ **60 requests/minute** - Faster than Nominatim
- ✅ **Based on OSM** - Similar coverage to Nominatim
- ✅ **Reliable** - Commercial SLA

### Cons
- ⚠️ **Requires account** - Need to sign up
- ⚠️ **Requires API key** - One more credential
- ⚠️ **Less generous** than Mapbox (but still plenty)

### Implementation
```python
def geocode_locationiq(place_text: str, api_key: str) -> dict | None:
    params = urllib.parse.urlencode({
        'q': place_text,
        'key': api_key,
        'format': 'json',
    })
    url = f"https://us1.locationiq.com/v1/search?{params}"
    
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        
        if data and len(data) > 0:
            return {"lat": float(data[0]["lat"]), "lng": float(data[0]["lon"])}
    except Exception:
        pass
    
    return None
```

### Performance
- **Speed:** < 1 second per location
- **Batch:** 101 events = ~1 minute total
- **Accuracy:** Very good (OSM-based)

### Cost
- Free: 0-5,000 requests/day
- **Your usage:** ~100 events/day = Well within free tier

---

## Option 4: Photon (Komoot)

### Overview
Free OSM-based geocoder by Komoot. No API key needed.

### Pros
- ✅ **Completely free** - No API key needed
- ✅ **No official rate limits** - Can go faster than Nominatim
- ✅ **OSM-based** - Good coverage

### Cons
- ⚠️ **Less reliable** - Smaller infrastructure
- ⚠️ **Occasional downtime** - Not as stable as others
- ⚠️ **Less documentation** - Harder to debug

### Implementation
```python
def geocode_photon(place_text: str) -> dict | None:
    params = urllib.parse.urlencode({'q': place_text})
    url = f"https://photon.komoot.io/api/?{params}"
    
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        
        features = data.get('features', [])
        if features:
            coords = features[0]['geometry']['coordinates']
            return {"lat": coords[1], "lng": coords[0]}
    except Exception:
        pass
    
    return None
```

---

## Comparison Table

| Service | API Key | Free Tier | Rate Limit | Speed (101 events) | Accuracy | Setup |
|---------|---------|-----------|------------|-------------------|----------|-------|
| **Nominatim** ⭐ | ❌ No | Unlimited | 1 req/sec | ~2 min | ⭐⭐⭐⭐ | None |
| **Mapbox** | ✅ Yes | 100k/mo | None | ~1 min | ⭐⭐⭐⭐⭐ | Sign up |
| **LocationIQ** | ✅ Yes | 5k/day | 60/min | ~1 min | ⭐⭐⭐⭐ | Sign up |
| **Photon** | ❌ No | Unlimited | None official | ~1 min | ⭐⭐⭐ | None |

---

## Recommendation: Nominatim

### Why Nominatim is Best for You:

1. **Zero Setup** - Works immediately, no account needed
2. **Truly Free** - No limits, no billing, no concerns
3. **Good Enough** - Accuracy is excellent for news events (cities, countries)
4. **2-minute batch time is acceptable** - You run ingestion periodically, not real-time
5. **Fair use compliant** - 100 events/day is well within fair use

### When to Consider Alternatives:

- **Need faster batching?** → Mapbox (no rate limit, ~1 min for 101 events)
- **Need higher reliability?** → Mapbox (production SLA)
- **Already have Mapbox account?** → Mapbox (better accuracy)

---

## Real-World Test Results

I can test all 4 services with your actual data to show:
- Success rates
- Response times
- Accuracy comparison

Would you like me to:
1. **Implement Nominatim** (recommended, works immediately)
2. **Test all 4 services** with sample events first
3. **Implement Mapbox** (if you want to sign up for better reliability)

---

## Implementation Plan

### For Nominatim (Recommended):

1. Update `_geocode()` function in `enrich.py`
2. Add User-Agent header
3. Add 1-second delay between requests
4. Test on 3 sample events
5. Run full batch

**Time to implement:** 5 minutes
**Works immediately:** Yes
**Cost:** $0 forever

Let me know which option you prefer!
