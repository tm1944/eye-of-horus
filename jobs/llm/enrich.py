"""
AI enrichment pipeline.

For each event, calls Gemini to infer/improve:
  - location hierarchy : country → region/state → city (as specific as possible)
  - locationSpecificity: global|continent|country|region|city|precise
  - layerId            : corrected layer classification from 23 valid categories
  - summary            : comprehensive 2-3 sentence summary (researches links if needed)
  - entities           : list of {type, text, confidence} for people/orgs/places/events
  - significance       : 0-100 score based on global impact criteria

Then calls Google Geocoding API to convert location → lat/lng.
If location can't be narrowed beyond country level, uses country center coordinates.

Requires GOOGLE_API_KEY (Gemini) and optionally GOOGLE_GEOCODING_KEY.
If GOOGLE_API_KEY is unset, events are returned with significance=50 and no location changes.
"""

import os
import json
import urllib.request
import urllib.parse
import time
from datetime import datetime, timezone

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")

GEMINI_MODEL = "gemini-3.5-flash-lite"

# Location specificity levels (from broadest to most precise)
LOCATION_SPECIFICITY = ["global", "continent", "country", "region", "city", "precise"]

# Valid layer IDs that Gemini can choose from
VALID_LAYER_IDS = [
    "earthquake", "wildfire", "conflict", "politics", "terror", "finance",
    "humanitarian", "news", "world", "business", "technology", "science",
    "health", "environment", "crime", "sports", "entertainment", "culture",
    "fashion", "travel", "food", "education", "media"
]

ENRICH_PROMPT_TEMPLATE = """\
You are a news event enrichment assistant. Analyze the event below and provide structured data.

TITLE: {title}
SUMMARY: {summary}
LINKS: {links}

If the summary is insufficient, you may reference the links to gather more context (though you cannot fetch them).

Respond with a JSON object containing exactly these fields:

1. **location** (object): Hierarchical location, as specific as possible
   - country: full country name (or "" if truly global/no specific country)
   - region: state/province/region name (or "" if can't narrow beyond country)
   - city: city/town name (or "" if can't narrow beyond region)
   - Example: {{"country": "Turkey", "region": "Ankara Province", "city": "Ankara"}}
   - Example: {{"country": "United States", "region": "California", "city": "San Francisco"}}
   - Example: {{"country": "", "region": "", "city": ""}} for global events like "New AI model released"

2. **locationSpecificity** (string): How specific you could get
   - "global" = no specific location (e.g., scientific discovery, tech product launch)
   - "continent" = only continent known (rare)
   - "country" = narrowed to country only
   - "region" = narrowed to state/province/region
   - "city" = narrowed to city/town
   - "precise" = specific building/street/venue mentioned

3. **layerId** (string): Category that best fits this event. MUST be one of:
   {layer_options}

4. **summary** (string): Comprehensive 2-3 sentence summary
   - Provide context, key details, and significance
   - Write as if for a general news reader
   - Always provide a summary, even if the input already has one (improve it)

5. **keywords** (array): Extract 8-15 relevant keywords for search and categorization
   Guidelines:
   - Include diverse mix: broad topics (2-3) + specific terms (5-7) + named entities (3-5)
   - Types: topic, entity, concept, location, technology, event, industry, organization, person
   - Avoid generic words: "news", "article", "report", "story", "today"
   - Include what the article is ABOUT (themes, topics, subjects), not just what's mentioned
   - Relevance 0.6-1.0 (only include if central or highly relevant to the story)
   - Format: {{"text": "keyword", "relevance": 0.0-1.0, "type": "topic|entity|concept|location|technology|event|industry|organization|person"}}

   Examples:

   Article: "OpenAI releases GPT-5 with improved reasoning"
   Keywords: [
     {{"text": "artificial intelligence", "relevance": 0.95, "type": "topic"}},
     {{"text": "OpenAI", "relevance": 0.90, "type": "organization"}},
     {{"text": "GPT-5", "relevance": 0.92, "type": "technology"}},
     {{"text": "natural language processing", "relevance": 0.85, "type": "concept"}},
     {{"text": "machine learning", "relevance": 0.80, "type": "topic"}},
     {{"text": "AI reasoning", "relevance": 0.88, "type": "concept"}}
   ]

   Article: "Turkey football referee arrested on corruption charges"
   Keywords: [
     {{"text": "corruption", "relevance": 0.95, "type": "topic"}},
     {{"text": "football", "relevance": 0.90, "type": "industry"}},
     {{"text": "Turkey", "relevance": 0.92, "type": "location"}},
     {{"text": "Turkish Football Federation", "relevance": 0.88, "type": "organization"}},
     {{"text": "sports governance", "relevance": 0.85, "type": "concept"}},
     {{"text": "arrest", "relevance": 0.80, "type": "event"}},
     {{"text": "referee", "relevance": 0.78, "type": "entity"}}
   ]

   Article: "Earthquake strikes Tokyo, hundreds evacuated"
   Keywords: [
     {{"text": "earthquake", "relevance": 1.0, "type": "event"}},
     {{"text": "Tokyo", "relevance": 0.95, "type": "location"}},
     {{"text": "Japan", "relevance": 0.90, "type": "location"}},
     {{"text": "natural disaster", "relevance": 0.88, "type": "topic"}},
     {{"text": "emergency response", "relevance": 0.80, "type": "concept"}},
     {{"text": "evacuation", "relevance": 0.82, "type": "event"}},
     {{"text": "seismic activity", "relevance": 0.75, "type": "concept"}}
   ]

6. **significance** (integer 0-100): Global newsworthiness score
   Use this criteria:
   - **0-20**: Niche/local interest (local sports, entertainment gossip, minor business news)
   - **21-40**: Regional significance (state/provincial news, regional sports, local politics)
   - **41-60**: National significance (affects one country, national sports, significant business)
   - **61-80**: International significance (affects multiple countries, major political events, large conflicts)
   - **81-100**: Major global event (natural disasters affecting millions, wars, global economic crises, major scientific breakthroughs)

   Consider:
   - Geographic scope (local → global)
   - Human impact (number of people affected)
   - Duration of impact (one-time → long-lasting)
   - Economic/political importance

Respond with valid JSON only, no other text.
"""


def enrich_events(events: list[dict]) -> list[dict]:
    """
    Enrich a list of Event dicts in-place. Returns the same list (mutated).
    Prints a summary of changes for each event.

    Events with geoSource='native' still get layerId/summary/keywords/significance enrichment
    but skip the geocoding step.

    Rate limiting: 1 second delay between geocoding requests (Nominatim requirement).
    """
    print(f"[enrich] Starting enrichment for {len(events)} events...")
    print(f"[enrich] Using OpenStreetMap Nominatim for geocoding (1 req/sec limit)")

    enriched_count = 0
    failed_count = 0
    geocoded_count = 0

    for i, event in enumerate(events):
        success, did_geocode = _enrich_one(event, event_index=i+1)
        if success:
            enriched_count += 1
        else:
            failed_count += 1

        if did_geocode:
            geocoded_count += 1
            # Rate limit: 1 request per second for Nominatim
            if i < len(events) - 1:  # Don't sleep after last event
                time.sleep(1.1)  # 1.1 seconds to be safe

    print(f"[enrich] Complete: {enriched_count} enriched, {failed_count} failed/skipped, {geocoded_count} geocoded")
    return events


def _enrich_one(event: dict, event_index: int) -> tuple[bool, bool]:
    """
    Enrich a single event.
    Returns (success: bool, did_geocode: bool).
    Prints before/after summary for all changes.
    """
    event_id = event.get("id", "unknown")
    title = event.get("title", "")[:60]

    if not GOOGLE_API_KEY:
        if event.get("significance") == 0:
            event["significance"] = 50
        print(f"[enrich] {event_index}. {event_id} - SKIPPED (no API key)")
        return False, False

    # Store original values
    orig_layer = event.get("layerId")
    orig_significance = event.get("significance")
    orig_coords = (event.get("lat"), event.get("lng"))

    # Get links for context
    links = event.get("links", [])
    links_str = ", ".join([f"{link.get('source', 'unknown')}: {link.get('url', '')}" for link in links[:3]])

    gemini_result = _call_gemini(
        event.get("title", ""),
        event.get("summary") or "",
        links_str
    )

    if not gemini_result:
        print(f"[enrich] {event_index}. {event_id} - FAILED (Gemini error)")
        print(f"         Title: {title}...")
        return False, False

    changes = []
    did_geocode = False

    # Update layerId
    new_layer = gemini_result.get("layerId")
    if new_layer in VALID_LAYER_IDS:
        if new_layer != orig_layer:
            changes.append(f"layer: {orig_layer} → {new_layer}")
        event["layerId"] = new_layer

    # Update summary
    if gemini_result.get("summary"):
        event["summary"] = gemini_result["summary"]
        changes.append("summary: updated")

    # Update keywords
    if isinstance(gemini_result.get("keywords"), list):
        keyword_count = len(gemini_result["keywords"])
        event["keywords"] = gemini_result["keywords"]
        # Show top 3 keywords in log
        top_keywords = [kw.get("text", "") for kw in gemini_result["keywords"][:3]]
        changes.append(f"keywords: {keyword_count} extracted ({', '.join(top_keywords)}...)")

    # Update significance
    sig = gemini_result.get("significance")
    if isinstance(sig, (int, float)) and 0 <= sig <= 100:
        sig = int(sig)
        if sig != orig_significance:
            changes.append(f"significance: {orig_significance} → {sig}")
        event["significance"] = sig

    # Update location and coordinates
    if event.get("geoSource") != "native":
        location = gemini_result.get("location", {})
        location_specificity = gemini_result.get("locationSpecificity", "global")

        # Store location specificity
        event["locationSpecificity"] = location_specificity

        # Build geocoding query based on specificity
        geocode_query = _build_geocode_query(location, location_specificity)

        if geocode_query:
            coords = _geocode(geocode_query)
            if coords:
                event["lat"] = coords["lat"]
                event["lng"] = coords["lng"]
                event["geoPrecision"] = location_specificity
                event["geoSource"] = "openstreetmap"
                changes.append(f"coords: {geocode_query} → ({coords['lat']:.4f}, {coords['lng']:.4f})")
                did_geocode = True
            else:
                changes.append(f"coords: failed to geocode '{geocode_query}'")
        else:
            changes.append(f"coords: none (specificity={location_specificity})")

    # Print summary
    print(f"[enrich] {event_index}. {event_id}")
    print(f"         Title: {title}...")
    if changes:
        for change in changes:
            print(f"         - {change}")
    else:
        print(f"         - No changes")

    return True, did_geocode


def _build_geocode_query(location: dict, specificity: str) -> str:
    """Build geocoding query from hierarchical location based on specificity level."""
    country = location.get("country", "").strip()
    region = location.get("region", "").strip()
    city = location.get("city", "").strip()

    if specificity == "precise" or specificity == "city":
        if city and country:
            return f"{city}, {country}"
        elif region and country:
            return f"{region}, {country}"
        elif country:
            return country
    elif specificity == "region":
        if region and country:
            return f"{region}, {country}"
        elif country:
            return country
    elif specificity == "country":
        if country:
            return country

    # Global or no specific location
    return ""


def _call_gemini(title: str, summary: str, links: str) -> dict | None:
    try:
        from google import genai  # type: ignore
    except ImportError:
        return None
    try:
        client = genai.Client(api_key=GOOGLE_API_KEY)

        # Format layer options for prompt
        layer_options = ", ".join(VALID_LAYER_IDS)

        prompt = ENRICH_PROMPT_TEMPLATE.format(
            title=title,
            summary=summary or "(no summary provided)",
            links=links or "(no links)",
            layer_options=layer_options
        )

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        return json.loads(response.text.strip())
    except Exception as e:
        return None


def _geocode(place_text: str) -> dict | None:
    """
    Geocode using OpenStreetMap Nominatim (free, no API key needed).
    Returns {'lat': float, 'lng': float} or None.

    Rate limit: 1 request per second (enforced by caller).
    """
    params = urllib.parse.urlencode({
        'q': place_text,
        'format': 'json',
        'limit': 1,
    })
    url = f"https://nominatim.openstreetmap.org/search?{params}"

    try:
        # Required: User-Agent header for Nominatim fair use policy
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'hypothesis-globe/1.0 (news-event-mapping-app)'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        if data and len(data) > 0:
            return {
                "lat": float(data[0]["lat"]),
                "lng": float(data[0]["lon"])
            }
    except Exception as e:
        # Log error for debugging (previously silent)
        pass

    return None


# Removed - now defined at top of file as VALID_LAYER_IDS list
