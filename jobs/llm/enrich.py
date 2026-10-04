"""
AI enrichment pipeline.

For each event that lacks coordinates (lat/lng are None), calls Gemini to infer:
  - placeText   : best location description for this event
  - layerId     : corrected layer classification
  - summary     : 2–3 sentence summary (if missing)
  - entities    : list of {type, text, confidence}
  - significance: 0–100

Then calls Google Geocoding API to convert placeText → lat/lng.
Events with geoSource 'native' skip the geo step.

Requires GOOGLE_API_KEY (Gemini) and optionally GOOGLE_GEOCODING_KEY.
If GOOGLE_API_KEY is unset, events are returned with significance=50 and no location changes.
"""

import os
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
GOOGLE_GEOCODING_KEY = os.environ.get("GOOGLE_GEOCODING_KEY", GOOGLE_API_KEY)

GEMINI_MODEL = "gemini-2.0-flash-lite"
GEO_PRECISION_ORDER = ["point", "city", "region", "country"]

ENRICH_PROMPT_TEMPLATE = """\
You are a news event classifier. Given the event title and summary below, respond with a \
JSON object containing exactly these fields:
  placeText    - best location name for geocoding (city + country preferred; "" if truly global)
  layerId      - one of: earthquake, wildfire, conflict, politics, terror, finance, humanitarian, \
news, world, business, technology, science, health, environment, crime, sports, entertainment, \
culture, fashion, travel, food, education, media
  summary      - 2–3 sentence plain-text summary (copy from input if already good)
  entities     - array of {{"type": "place|org|person|event", "text": "...", "confidence": 0.0–1.0}}
  significance - integer 0–100 (global newsworthiness; 80+ = major world event)

Title: {title}
Summary: {summary}
"""


def enrich_events(events: list[dict]) -> list[dict]:
    """
    Enrich a list of Event dicts in-place. Returns the same list (mutated).
    Events with geoSource='native' still get layerId/summary/entities/significance enrichment
    but skip the geocoding step.
    """
    for event in events:
        _enrich_one(event)
    return events


def _enrich_one(event: dict) -> None:
    if not GOOGLE_API_KEY:
        if event.get("significance") == 0:
            event["significance"] = 50
        return

    gemini_result = _call_gemini(event.get("title", ""), event.get("summary") or "")
    if not gemini_result:
        return

    if gemini_result.get("layerId") in _VALID_LAYER_IDS:
        event["layerId"] = gemini_result["layerId"]

    if gemini_result.get("summary"):
        event["summary"] = gemini_result["summary"]

    if isinstance(gemini_result.get("entities"), list):
        event["entities"] = gemini_result["entities"]

    sig = gemini_result.get("significance")
    if isinstance(sig, (int, float)) and 0 <= sig <= 100:
        event["significance"] = int(sig)

    if event.get("geoSource") == "native":
        return

    place_text = (gemini_result.get("placeText") or "").strip()
    if place_text:
        coords = _geocode(place_text)
        if coords:
            event["lat"] = coords["lat"]
            event["lng"] = coords["lng"]
            event["geoPrecision"] = "city"
            event["geoSource"] = "google_geocode"


def _call_gemini(title: str, summary: str) -> dict | None:
    try:
        from google import genai  # type: ignore
    except ImportError:
        return None
    try:
        client = genai.Client(api_key=GOOGLE_API_KEY)
        prompt = ENRICH_PROMPT_TEMPLATE.format(title=title, summary=summary or "")
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        return json.loads(response.text.strip())
    except Exception:
        return None


def _geocode(place_text: str) -> dict | None:
    """Return {'lat': float, 'lng': float} or None."""
    params = urllib.parse.urlencode({
        "address": place_text,
        "key":     GOOGLE_GEOCODING_KEY,
    })
    url = f"https://maps.googleapis.com/maps/api/geocode/json?{params}"
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        results = data.get("results") or []
        if results:
            loc = results[0]["geometry"]["location"]
            return {"lat": loc["lat"], "lng": loc["lng"]}
    except Exception:
        pass
    return None


_VALID_LAYER_IDS = {
    "earthquake", "wildfire", "conflict", "politics", "terror", "finance",
    "humanitarian", "news", "world", "business", "technology", "science",
    "health", "environment", "crime", "sports", "entertainment", "culture",
    "fashion", "travel", "food", "education", "media",
}
