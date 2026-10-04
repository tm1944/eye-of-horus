"""
Enrich pending local news (raw.feed_item) and append the local stories to mart.event.

Only rows with status 'pending' are read, so nothing is ever enriched twice: each item ends
'ingested' (appended to mart.event) or 'rejected' (with the reason in `verdict`) as soon as
its batch returns. Items are sent to Gemini in batches (BATCH per call) because the free
tier allows ~500 calls a day per model.

Per item, Gemini returns what jobs/llm/enrich.py does (location, category, English summary,
keywords, significance) plus the locality check: which country the story is about. Code
decides `isLocal` (about country == publisher's country); non-local stories are rejected.

Run:  python -m jobs.news.enrich_local [--limit N] [--countries GBR,IND]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from db import database_configured, database_url, load_repo_env  # noqa: E402

BATCH = 12  # items per Gemini call
MODEL = "gemini-3.5-flash-lite"
LAYER_IDS = ["conflict", "politics", "terror", "finance", "humanitarian", "news", "world", "business", "technology",
             "science", "health", "environment", "crime", "sports", "entertainment", "culture", "fashion", "travel",
             "food", "education", "media", "protest", "earthquake", "wildfire", "cyclone", "flood", "drought"]
SPECIFICITY = {"precise": "point", "city": "city", "region": "region", "country": "country"}
COUNTRIES_GEOJSON = REPO_ROOT / "apps" / "web" / "src" / "data" / "countries.geojson.json"

PROMPT = """\
You enrich local news items. Each item comes from a news outlet based in PUBLISHER_COUNTRY.
Items may be in any language: always answer in English.

For EACH item return an object with exactly these fields:
- "id": the item's id, unchanged
- "aboutCountryIso3": ISO 3166-1 alpha-3 code of the ONE country the story is mainly about
  (where it happens or whose affairs it concerns). Use "" only for genuinely international
  stories with no single main country (e.g. a global summit, a worldwide market move).
  Judge the story, not the outlet: a story from a British outlet about a French election is "FRA".
- "titleEn": the headline in natural English (unchanged if already English)
- "language": ISO 639-1 code of the item's original language (e.g. "en", "fr", "ja")
- "summary": 2-3 sentence English summary for a general reader, with context and key details
- "layerId": the best category, one of: {layers}
- "location": {{"country": full country name or "", "region": state/province or "", "city": city/town or ""}}
- "locationSpecificity": "global" | "continent" | "country" | "region" | "city" | "precise"
- "keywords": 6-10 objects {{"text": ..., "relevance": 0.6-1.0, "type": "topic|entity|concept|location|technology|event|industry|organization|person"}}
- "significance": integer 0-100 newsworthiness (0-20 niche/local, 21-40 regional, 41-60 national,
  61-80 international, 81-100 major global event)

Respond with a JSON array only, one object per item, in any order.

ITEMS:
{items}
"""


def build_prompt(batch: list[dict], country_names: dict[str, str]) -> str:
    items = [{
        "id": item["item_id"],
        "PUBLISHER_COUNTRY": f"{country_names.get(item['country_iso3'], item['country_iso3'])} ({item['country_iso3']})",
        "publisher": item["publisher_name"],
        "title": item["title"],
        "summary": (item["summary"] or "")[:500],
        "language_hint": item["language"] or "unknown",
    } for item in batch]
    return PROMPT.format(layers=", ".join(LAYER_IDS), items=json.dumps(items, ensure_ascii=False, indent=1))


def verdict_for(item: dict, result: dict) -> dict:
    """Decide locality in code: the model only names the country the story is about."""
    about = str(result.get("aboutCountryIso3") or "").strip().upper()
    local = about == item["country_iso3"]
    return {
        "aboutCountryIso3": about or None, "publisherCountryIso3": item["country_iso3"], "isLocal": local,
        "reason": None if local else (f"about {about}, publisher in {item['country_iso3']}" if about else "international story, no single country"),
        "model": MODEL, "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def country_centroids() -> tuple[dict[str, tuple[float, float]], dict[str, str]]:
    """Fallback point per ISO3 (centre of the largest polygon's bounding box) and country names."""
    data = json.loads(COUNTRIES_GEOJSON.read_text(encoding="utf-8"))
    centroids, names = {}, {}
    for feature in data["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        ring = max((polygon[0] for polygon in polygons), key=len)
        lngs, lats = [p[0] for p in ring], [p[1] for p in ring]
        centroids[feature["id"]] = ((min(lats) + max(lats)) / 2, (min(lngs) + max(lngs)) / 2)
        names[feature["id"]] = feature["properties"]["name"]
    return centroids, names


def call_gemini(client, prompt: str) -> list[dict]:
    response = client.models.generate_content(model=MODEL, contents=prompt, config={"response_mime_type": "application/json"})
    data = json.loads(response.text.strip())
    return data if isinstance(data, list) else []


_EVENT_INSERT = """
INSERT INTO mart.event (
  event_id, source, source_event_id, category, title, summary, info_url, image_url,
  occurred_at, updated_at, lng, lat, geo_precision, geo_source, significance,
  country_iso3, keywords, publisher_id, language, original_title, verification
) VALUES (
  %(event_id)s, 'rss', %(item_id)s, %(category)s, %(title)s, %(summary)s, %(url)s, %(image_url)s,
  %(occurred_at)s, %(occurred_at)s, %(lng)s, %(lat)s, %(geo_precision)s, %(geo_source)s, %(significance)s,
  %(country_iso3)s, %(keywords)s::jsonb, %(publisher_id)s, %(language)s, %(original_title)s, %(verification)s::jsonb
)
ON CONFLICT DO NOTHING
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich pending local news and append it to mart.event")
    parser.add_argument("--limit", type=int, default=0, help="Only process this many pending items")
    parser.add_argument("--countries", default="", help="Comma-separated ISO3 codes (default: all)")
    args = parser.parse_args()

    load_repo_env()
    key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not database_configured() or not key:
        raise SystemExit("DATABASE_URL and GOOGLE_API_KEY are required")
    import psycopg
    from google import genai  # type: ignore

    sys.path.insert(0, str(REPO_ROOT))
    from jobs.llm.enrich import _build_geocode_query, _geocode  # OpenStreetMap Nominatim, 1 request/second

    client = genai.Client(api_key=key)
    centroids, names = country_centroids()
    countries = [code.strip().upper() for code in args.countries.split(",") if code.strip()]
    counts = {"ingested": 0, "rejected": 0, "unanswered": 0, "geocoded": 0, "centroid": 0}
    with psycopg.connect(database_url(), connect_timeout=20) as conn:
        rows = conn.execute("""
            SELECT f.item_id, f.publisher_id, p.name, f.country_iso3, f.url, f.title, f.summary, f.image_url, f.language, f.published_at, f.fetched_at
            FROM raw.feed_item f JOIN mart.publisher p USING (publisher_id)
            WHERE f.status = 'pending' AND (cardinality(%s::text[]) = 0 OR f.country_iso3 = ANY(%s))
            ORDER BY f.country_iso3, f.published_at DESC NULLS LAST
        """, (countries, countries)).fetchall()
        keys = ("item_id", "publisher_id", "publisher_name", "country_iso3", "url", "title", "summary", "image_url", "language", "published_at", "fetched_at")
        pending = [dict(zip(keys, row)) for row in rows][: args.limit or None]
        print(f"{len(pending)} pending items → {-(-len(pending) // BATCH)} Gemini calls")

        for start in range(0, len(pending), BATCH):
            batch = pending[start:start + BATCH]
            try:
                results = call_gemini(client, build_prompt(batch, names))
            except Exception as error:  # noqa: BLE001 — quota or network: stop; the rest stays pending
                print(f"  batch {start // BATCH + 1}: Gemini failed ({str(error)[:120]}); stopping, {len(pending) - start} items left pending")
                break
            by_id = {str(result.get("id")): result for result in results if isinstance(result, dict)}
            for item in batch:
                result = by_id.get(item["item_id"])
                if result is None:
                    counts["unanswered"] += 1  # left pending: retried on the next run
                    continue
                verdict = verdict_for(item, result)
                if not verdict["isLocal"]:
                    conn.execute("UPDATE raw.feed_item SET status = 'rejected', verdict = %s::jsonb WHERE item_id = %s",
                                 (json.dumps(verdict), item["item_id"]))
                    counts["rejected"] += 1
                    continue
                specificity = result.get("locationSpecificity") or "country"
                query = _build_geocode_query(result.get("location") or {}, specificity)
                coords = _geocode(query) if query and specificity in SPECIFICITY else None
                if query and specificity in SPECIFICITY:
                    time.sleep(1.1)  # Nominatim fair use
                if coords:
                    lat, lng, precision, geo_source = coords["lat"], coords["lng"], SPECIFICITY[specificity], "openstreetmap"
                    counts["geocoded"] += 1
                else:  # a local story: fall back to the publisher's country
                    lat, lng = centroids.get(item["country_iso3"], (0.0, 0.0))
                    precision, geo_source = "country", "centroid"
                    counts["centroid"] += 1
                significance = result.get("significance")
                layer = result.get("layerId") if result.get("layerId") in LAYER_IDS else "news"
                title_en = (result.get("titleEn") or item["title"]).strip()
                conn.execute(_EVENT_INSERT, {
                    "event_id": f"rss:{item['item_id'][:20]}", "item_id": item["item_id"], "category": layer,
                    "title": title_en, "summary": result.get("summary") or item["summary"], "url": item["url"], "image_url": item["image_url"],
                    "occurred_at": item["published_at"] or item["fetched_at"], "lng": lng, "lat": lat,
                    "geo_precision": precision, "geo_source": geo_source,
                    "significance": float(significance) if isinstance(significance, (int, float)) and 0 <= significance <= 100 else 30.0,
                    "country_iso3": item["country_iso3"], "keywords": json.dumps(result.get("keywords") or []),
                    "publisher_id": item["publisher_id"], "language": (result.get("language") or item["language"] or None),
                    "original_title": item["title"] if item["title"] != title_en else None, "verification": json.dumps(verdict),
                })
                conn.execute("UPDATE raw.feed_item SET status = 'ingested', verdict = %s::jsonb WHERE item_id = %s",
                             (json.dumps({**verdict, "summary": result.get("summary"), "layerId": layer}), item["item_id"]))
                counts["ingested"] += 1
            conn.commit()  # per batch: a crash never repeats finished items
            print(f"  batch {start // BATCH + 1}/{-(-len(pending) // BATCH)}: {counts}")
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
