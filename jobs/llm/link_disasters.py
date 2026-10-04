"""
Generate event links between news and disasters, and between news articles.

Links news articles that report on disasters or are related to each other.
Uses temporal + spatial filtering followed by Gemini verification.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"

if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from db import database_configured, database_url, load_repo_env  # noqa: E402

# Linking thresholds
TIME_WINDOW_DAYS = 7  # News can report on disasters up to 7 days after
DISTANCE_WINDOW_KM = 500  # News must be within 500km of disaster
MIN_CONFIDENCE = 0.7
MAX_LINKS_PER_EVENT = 10  # Don't overwhelm with links

DISASTER_KEYWORDS = {
    'earthquake': ['earthquake', 'seismic', 'tremor', 'quake', 'magnitude'],
    'wildfire': ['wildfire', 'fire', 'bushfire', 'blaze', 'smoke'],
    'cyclone': ['cyclone', 'typhoon', 'hurricane', 'storm', 'tropical'],
    'flood': ['flood', 'flooding', 'inundation', 'deluge', 'water'],
    'volcano': ['volcano', 'volcanic', 'eruption', 'lava', 'ash'],
    'drought': ['drought', 'dry', 'water shortage', 'famine'],
}


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance between two points in kilometers."""
    from math import asin, cos, radians, sin, sqrt

    R = 6371  # Earth radius in km
    lat1, lng1, lat2, lng2 = map(radians, [lat1, lng1, lat2, lng2])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
    return 2 * R * asin(sqrt(a))


def _parse_dt(iso: str) -> datetime:
    """Parse ISO datetime string."""
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _keyword_overlap(news_keywords: list[dict], disaster_category: str) -> float:
    """
    Check if news keywords overlap with disaster type.

    Returns overlap score 0.0-1.0
    """
    if not news_keywords:
        return 0.0

    disaster_terms = DISASTER_KEYWORDS.get(disaster_category, [])
    if not disaster_terms:
        return 0.0

    # Extract keyword text (lowercase)
    news_terms = [kw.get('text', '').lower() for kw in news_keywords]

    # Check for matches
    matches = 0
    for term in news_terms:
        for disaster_term in disaster_terms:
            if disaster_term in term or term in disaster_term:
                matches += 1
                break

    return min(1.0, matches / 3.0)  # Need at least 3 matching terms for 1.0 score


def _find_news_disaster_candidates(conn) -> list[tuple[dict, dict]]:
    """
    Find candidate news-disaster pairs using temporal + spatial filtering.

    Returns list of (news_event, disaster_event) tuples.
    """
    cursor = conn.cursor()

    # Get news events with keywords
    cursor.execute("""
        SELECT
            event_id, category, title, summary,
            occurred_at, lat, lng, keywords
        FROM mart.event
        WHERE source IN ('gnews', 'wikifeeds')
          AND keywords IS NOT NULL
          AND jsonb_array_length(keywords) > 0
        ORDER BY occurred_at DESC
    """)

    news_events = []
    for row in cursor.fetchall():
        news_events.append({
            'id': row[0],
            'category': row[1],
            'title': row[2],
            'summary': row[3],
            'occurred_at': row[4],
            'lat': row[5],
            'lng': row[6],
            'keywords': row[7] or [],
        })

    print(f"Found {len(news_events)} news events")

    # Get disasters
    cursor.execute("""
        SELECT
            event_id, category, title, summary,
            occurred_at, lat, lng, significance
        FROM mart.event
        WHERE source IN ('usgs', 'gdacs', 'firms')
        ORDER BY occurred_at DESC
    """)

    disasters = []
    for row in cursor.fetchall():
        disasters.append({
            'id': row[0],
            'category': row[1],
            'title': row[2],
            'summary': row[3],
            'occurred_at': row[4],
            'lat': row[5],
            'lng': row[6],
            'significance': row[7],
        })

    print(f"Found {len(disasters)} disasters")

    # Find candidates within time/distance window
    candidates = []
    for news in news_events:
        for disaster in disasters:
            # Time window: news can report on disaster up to 7 days after
            news_time = news['occurred_at']
            disaster_time = disaster['occurred_at']

            if news_time < disaster_time:
                continue  # News published before disaster

            time_diff = (news_time - disaster_time).total_seconds()
            if time_diff > TIME_WINDOW_DAYS * 24 * 3600:
                continue  # Too old

            # Distance window
            distance = _haversine_km(
                news['lat'], news['lng'],
                disaster['lat'], disaster['lng']
            )

            if distance > DISTANCE_WINDOW_KM:
                continue  # Too far

            # Keyword overlap
            overlap = _keyword_overlap(news['keywords'], disaster['category'])
            if overlap < 0.3:
                continue  # Not enough keyword overlap

            candidates.append((news, disaster))

    print(f"Found {len(candidates)} candidate news-disaster pairs")
    cursor.close()
    return candidates


def _find_news_news_candidates(conn) -> list[tuple[dict, dict]]:
    """
    Find candidate news-news pairs (same topic, same place).

    Returns list of (news_a, news_b) tuples.
    """
    cursor = conn.cursor()

    # Get news events
    cursor.execute("""
        SELECT
            event_id, category, title, summary,
            occurred_at, lat, lng, keywords
        FROM mart.event
        WHERE source IN ('gnews', 'wikifeeds')
          AND keywords IS NOT NULL
          AND jsonb_array_length(keywords) > 0
        ORDER BY occurred_at DESC
    """)

    news_events = []
    for row in cursor.fetchall():
        news_events.append({
            'id': row[0],
            'category': row[1],
            'title': row[2],
            'summary': row[3],
            'occurred_at': row[4],
            'lat': row[5],
            'lng': row[6],
            'keywords': row[7] or [],
        })

    # Find pairs within 48 hours and 200km
    candidates = []
    for i, a in enumerate(news_events):
        for b in news_events[i + 1:]:
            # Time window: 48 hours
            time_diff = abs((a['occurred_at'] - b['occurred_at']).total_seconds())
            if time_diff > 48 * 3600:
                continue

            # Distance window: 200km
            distance = _haversine_km(a['lat'], a['lng'], b['lat'], b['lng'])
            if distance > 200:
                continue

            candidates.append((a, b))

    print(f"Found {len(candidates)} candidate news-news pairs")
    cursor.close()
    return candidates


def _build_news_disaster_prompt(news: dict, disaster: dict) -> str:
    """Build Gemini prompt for news-disaster linking."""
    return f"""Determine if this news article reports on or mentions this disaster.

News Article:
  Title: {news['title']}
  Summary: {news.get('summary') or 'N/A'}
  Category: {news['category']}
  Published: {news['occurred_at']}
  Location: {news['lat']}, {news['lng']}

Disaster Event:
  Type: {disaster['category']}
  Title: {disaster['title']}
  Summary: {disaster.get('summary') or 'N/A'}
  Occurred: {disaster['occurred_at']}
  Location: {disaster['lat']}, {disaster['lng']}

Rules:
- If the news article is ABOUT this specific disaster, use relation "reports_on"
- If the news article MENTIONS this disaster in passing, use relation "mentions"
- If the news article analyzes impact/aftermath, use relation "analysis"
- If unrelated or just coincidentally nearby, set related to false

Respond with JSON:
{{
  "related": true | false,
  "relation": "reports_on" | "mentions" | "analysis",
  "confidence": <0.0 to 1.0>,
  "rationale": "<1-2 sentence explanation>"
}}"""


def _build_news_news_prompt(news_a: dict, news_b: dict) -> str:
    """Build Gemini prompt for news-news linking."""
    return f"""Determine if these two news articles are related.

Article A:
  Title: {news_a['title']}
  Summary: {news_a.get('summary') or 'N/A'}
  Category: {news_a['category']}
  Published: {news_a['occurred_at']}

Article B:
  Title: {news_b['title']}
  Summary: {news_b.get('summary') or 'N/A'}
  Category: {news_b['category']}
  Published: {news_b['occurred_at']}

Rules:
- If same story from different sources, use relation "same_event"
- If related stories on same topic, use relation "same_topic"
- If both about same location/region, use relation "same_place"
- If unrelated, set related to false

Respond with JSON:
{{
  "related": true | false,
  "relation": "same_event" | "same_topic" | "same_place",
  "confidence": <0.0 to 1.0>,
  "rationale": "<1-2 sentence explanation>"
}}"""


def _verify_link_with_gemini(client, news, other, link_type: str) -> dict | None:
    """
    Verify link with Gemini.

    Args:
        link_type: "news_disaster" or "news_news"
    """
    try:
        if link_type == "news_disaster":
            prompt = _build_news_disaster_prompt(news, other)
        else:
            prompt = _build_news_news_prompt(news, other)

        response = client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        data = json.loads(response.text.strip())
        if not isinstance(data, dict):
            return None

        return data
    except Exception as e:
        print(f"Gemini error: {e}")
        return None


def _insert_link(cursor, link: dict):
    """Insert link into mart.event_link table."""
    cursor.execute("""
        INSERT INTO mart.event_link (
            link_id, source_id, target_id, relation,
            confidence, rationale, citations, model
        ) VALUES (
            %(link_id)s, %(source_id)s, %(target_id)s, %(relation)s,
            %(confidence)s, %(rationale)s, %(citations)s::jsonb, %(model)s
        )
        ON CONFLICT (link_id) DO UPDATE SET
            relation = EXCLUDED.relation,
            confidence = EXCLUDED.confidence,
            rationale = EXCLUDED.rationale,
            citations = EXCLUDED.citations,
            model = EXCLUDED.model
    """, link)


def link_all_events() -> dict:
    """
    Generate links between all events.

    Returns summary dict.
    """
    load_repo_env()

    if not database_configured():
        return {
            "ok": False,
            "status": "needs_database_url",
            "detail": "DATABASE_URL not set",
        }

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {
            "ok": False,
            "status": "needs_google_api_key",
            "detail": "GOOGLE_API_KEY not set for Gemini",
        }

    from google import genai  # type: ignore

    client = genai.Client(api_key=api_key)

    import psycopg

    conn = psycopg.connect(database_url(), connect_timeout=20)

    try:
        # Find candidates
        print("\n=== Finding News ↔ Disaster Candidates ===")
        news_disaster_candidates = _find_news_disaster_candidates(conn)

        print("\n=== Finding News ↔ News Candidates ===")
        news_news_candidates = _find_news_news_candidates(conn)

        # Verify links with Gemini
        links_created = 0
        links_rejected = 0

        print("\n=== Verifying News ↔ Disaster Links ===")
        for news, disaster in news_disaster_candidates[:50]:  # Limit to 50 for cost
            data = _verify_link_with_gemini(client, news, disaster, "news_disaster")

            if not data or not data.get("related"):
                links_rejected += 1
                continue

            confidence = float(data.get("confidence", 0.0))
            if confidence < MIN_CONFIDENCE:
                links_rejected += 1
                continue

            link = {
                "link_id": f"link:{news['id']}:{disaster['id']}",
                "source_id": news['id'],
                "target_id": disaster['id'],
                "relation": data.get("relation", "mentions"),
                "confidence": confidence,
                "rationale": data.get("rationale", ""),
                "citations": json.dumps([]),
                "model": "gemini-2.0-flash-exp",
            }

            with conn.cursor() as cursor:
                _insert_link(cursor, link)

            conn.commit()
            links_created += 1
            print(f"  ✓ {news['id']} → {disaster['id']} ({link['relation']}, {confidence:.2f})")

        print("\n=== Verifying News ↔ News Links ===")
        for news_a, news_b in news_news_candidates[:30]:  # Limit to 30 for cost
            data = _verify_link_with_gemini(client, news_a, news_b, "news_news")

            if not data or not data.get("related"):
                links_rejected += 1
                continue

            confidence = float(data.get("confidence", 0.0))
            if confidence < MIN_CONFIDENCE:
                links_rejected += 1
                continue

            link = {
                "link_id": f"link:{news_a['id']}:{news_b['id']}",
                "source_id": news_a['id'],
                "target_id": news_b['id'],
                "relation": data.get("relation", "related"),
                "confidence": confidence,
                "rationale": data.get("rationale", ""),
                "citations": json.dumps([]),
                "model": "gemini-2.0-flash-exp",
            }

            with conn.cursor() as cursor:
                _insert_link(cursor, link)

            conn.commit()
            links_created += 1
            print(f"  ✓ {news_a['id']} ↔ {news_b['id']} ({link['relation']}, {confidence:.2f})")

        return {
            "ok": True,
            "status": "complete",
            "candidates": {
                "news_disaster": len(news_disaster_candidates),
                "news_news": len(news_news_candidates),
            },
            "links_created": links_created,
            "links_rejected": links_rejected,
        }

    finally:
        conn.close()


def main():
    """CLI entry point."""
    print("=" * 80)
    print("GENERATING EVENT LINKS")
    print("=" * 80)

    result = link_all_events()

    print("\n" + "=" * 80)
    print("LINKING COMPLETE")
    print("=" * 80)
    print(json.dumps(result, indent=2))

    if not result.get("ok"):
        sys.exit(1)


if __name__ == "__main__":
    main()
