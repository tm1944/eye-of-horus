"""
Upload enriched news events to TigerData.

Maps news event schema from data/fixtures/events.json to mart.event schema.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
EVENTS_FIXTURE = REPO_ROOT / "data" / "fixtures" / "events.json"

if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from db import database_configured, database_url, load_repo_env  # noqa: E402


def _to_iso(dt_string: str | None) -> str | None:
    """Convert datetime string to ISO format."""
    if not dt_string:
        return None
    try:
        # Already in ISO format
        if 'T' in dt_string and 'Z' in dt_string:
            return dt_string
        # Parse and convert
        dt = datetime.fromisoformat(dt_string.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, AttributeError):
        return None


def _map_news_to_event(news_event: dict) -> dict:
    """
    Map news event schema to mart.event schema.

    News event fields:
      - id, source, title, summary, layerId
      - occurredAt, lat, lng, significance
      - keywords[], links[], locationSpecificity

    mart.event fields:
      - event_id, source, source_event_id, category, title, summary
      - occurred_at, lng, lat, significance, geo_precision, geo_source
      - keywords (jsonb), country_iso3, info_url, weight
    """

    event_id = news_event['id']
    source_id = event_id.split(':', 1)[1] if ':' in event_id else event_id

    # Map locationSpecificity to geo_precision
    specificity = news_event.get('locationSpecificity', 'unknown')
    geo_precision_map = {
        'global': 'global',
        'continent': 'continent',
        'country': 'country',
        'region': 'region',
        'city': 'city',
        'precise': 'point'
    }
    geo_precision = geo_precision_map.get(specificity, 'unknown')

    # Get first link URL as info_url
    links = news_event.get('links', [])
    if links and isinstance(links[0], dict):
        info_url = links[0].get('url')
    elif links and isinstance(links[0], str):
        info_url = links[0]
    else:
        info_url = None

    return {
        'event_id': event_id,
        'source': news_event['source'],
        'source_event_id': source_id,
        'category': news_event.get('layerId', 'news'),
        'subtype': None,
        'title': news_event['title'],
        'summary': news_event.get('summary'),
        'info_url': info_url,
        'occurred_at': _to_iso(news_event.get('occurredAt')),
        'updated_at': None,
        'ended_at': None,
        'lng': news_event.get('lng'),
        'lat': news_event.get('lat'),
        'alt_m': None,
        'geo_precision': geo_precision,
        'geo_source': 'gemini',
        'significance': news_event.get('significance', 50),
        'weight': None,
        'country_iso3': None,
        'keywords': json.dumps(news_event.get('keywords', [])),
        'raw_ref': None,
    }


_EVENT_UPSERT = """
INSERT INTO mart.event (
  event_id, source, source_event_id, category, subtype, title, summary, info_url,
  occurred_at, updated_at, ended_at, lng, lat, alt_m, geo_precision, geo_source,
  significance, weight, country_iso3, keywords, raw_ref
) VALUES (
  %(event_id)s, %(source)s, %(source_event_id)s, %(category)s, %(subtype)s,
  %(title)s, %(summary)s, %(info_url)s, %(occurred_at)s, %(updated_at)s,
  %(ended_at)s, %(lng)s, %(lat)s, %(alt_m)s, %(geo_precision)s, %(geo_source)s,
  %(significance)s, %(weight)s, %(country_iso3)s, %(keywords)s::jsonb, %(raw_ref)s
)
ON CONFLICT (source, source_event_id) DO UPDATE SET
  category = EXCLUDED.category,
  subtype = EXCLUDED.subtype,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  info_url = EXCLUDED.info_url,
  occurred_at = EXCLUDED.occurred_at,
  updated_at = EXCLUDED.updated_at,
  ended_at = EXCLUDED.ended_at,
  lng = EXCLUDED.lng,
  lat = EXCLUDED.lat,
  alt_m = EXCLUDED.alt_m,
  geo_precision = EXCLUDED.geo_precision,
  geo_source = EXCLUDED.geo_source,
  significance = EXCLUDED.significance,
  weight = EXCLUDED.weight,
  country_iso3 = EXCLUDED.country_iso3,
  keywords = EXCLUDED.keywords,
  raw_ref = EXCLUDED.raw_ref,
  ingested_at = now()
"""


def upload_news_events(fixture_path: Path | None = None) -> dict:
    """
    Upload enriched news events from fixture to TigerData.

    Returns:
        dict: Summary with counts and status
    """
    load_repo_env()

    if not database_configured():
        return {
            "ok": False,
            "status": "needs_database_url",
            "detail": "DATABASE_URL not set in .env",
        }

    if fixture_path is None:
        fixture_path = EVENTS_FIXTURE

    if not fixture_path.exists():
        return {
            "ok": False,
            "status": "fixture_not_found",
            "detail": f"No events fixture at {fixture_path}",
        }

    # Load news events
    with open(fixture_path) as f:
        news_events = json.load(f)

    if not news_events:
        return {
            "ok": False,
            "status": "no_events",
            "detail": "Events fixture is empty",
        }

    import psycopg

    conn = psycopg.connect(database_url(), connect_timeout=20)

    try:
        uploaded = 0
        skipped = 0
        errors = []

        with conn.cursor() as cursor:
            for news_event in news_events:
                try:
                    # Map to mart.event schema
                    event_row = _map_news_to_event(news_event)

                    # Skip events without coordinates
                    if event_row['lat'] is None or event_row['lng'] is None:
                        skipped += 1
                        continue

                    # Insert/update
                    cursor.execute(_EVENT_UPSERT, event_row)
                    uploaded += 1

                except Exception as e:
                    error_msg = f"Failed to upload {news_event.get('id', 'unknown')}: {e}"
                    errors.append(error_msg)
                    print(f"ERROR: {error_msg}", file=sys.stderr)

            conn.commit()

        return {
            "ok": True,
            "status": "uploaded",
            "total": len(news_events),
            "uploaded": uploaded,
            "skipped": skipped,
            "errors": len(errors),
            "error_details": errors[:5] if errors else None,  # First 5 errors
        }

    finally:
        conn.close()


def main():
    """CLI entry point."""
    print("=" * 80)
    print("UPLOADING NEWS EVENTS TO TIGERDATA")
    print("=" * 80)

    result = upload_news_events()

    print("\nResult:")
    print(json.dumps(result, indent=2))

    if not result.get("ok"):
        sys.exit(1)

    print("\n" + "=" * 80)
    print("UPLOAD COMPLETE")
    print("=" * 80)

    # Verify upload
    load_repo_env()
    if database_configured():
        import psycopg

        conn = psycopg.connect(database_url(), connect_timeout=20)
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT
                        source,
                        COUNT(*) as count,
                        SUM(CASE WHEN keywords IS NOT NULL AND keywords != '[]'::jsonb THEN 1 ELSE 0 END) as with_keywords
                    FROM mart.event
                    WHERE source IN ('gnews', 'wikifeeds')
                    GROUP BY source
                    ORDER BY source
                """)

                print("\nNews events in TigerData:")
                for row in cursor.fetchall():
                    source, count, with_kw = row
                    print(f"  {source:12} {count:4} events ({with_kw} with keywords)")
        finally:
            conn.close()


if __name__ == "__main__":
    main()
