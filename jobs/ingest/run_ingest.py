"""
News event ingest pipeline.

Usage:
    python -m jobs.ingest.run_ingest [options]

Options:
    --hours INT        How many hours back to consider "recent" (default: 24)
    --sources LIST     Comma-separated scrapers to run: gnews,wikifeeds (default: all)
    --dry-run          Print events to stdout; skip all DB writes and file mutations

Flow:
    1. Scrape configured sources
    2. Normalise raw articles → Event schema shape
    3. Deduplicate by URL (cheap, pre-enrichment)
    4. AI enrichment: Gemini fills missing location, layerId, summary, entities, significance
    5. AI deduplication: Gemini merges same-event duplicates across sources
    6. Persist new/updated events to Snowflake (or fixture JSON in dry-run / no-Snowflake mode)
    7. Soft-delete events older than --hours; hard-delete archived events older than 2× --hours

Environment variables:
    GNEWS_API_KEY        Required for GNews source
    GOOGLE_API_KEY       Required for Gemini enrichment and deduplication
    GOOGLE_GEOCODING_KEY Optional; falls back to GOOGLE_API_KEY
    SNOWFLAKE_*          Required for live DB writes (see jobs/llm/README.md)
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta

from jobs.ingest.scrapers import gnews as gnews_scraper
from jobs.ingest.scrapers import wikifeeds as wikifeeds_scraper
from jobs.ingest.normalize import normalize_gnews, normalize_wikifeeds
from jobs.llm.enrich import enrich_events
from jobs.llm.deduplicate import deduplicate_events

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "fixtures", "events.json")
FIXTURE_PATH = os.path.normpath(FIXTURE_PATH)

SNOWFLAKE_ACCOUNT = os.environ.get("SNOWFLAKE_ACCOUNT", "")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the news event ingest pipeline.")
    parser.add_argument("--hours",   type=int,   default=24,               help="Recency window in hours (default: 24)")
    parser.add_argument("--sources", type=str,   default="gnews,wikifeeds",help="Comma-separated source list")
    parser.add_argument("--dry-run", action="store_true",                  help="Print events; skip writes")
    args = parser.parse_args()

    sources = [s.strip().lower() for s in args.sources.split(",")]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=args.hours)

    print(f"[ingest] starting — sources={sources} hours={args.hours} dry_run={args.dry_run}", flush=True)

    # 1. Scrape
    raw_events: list[dict] = []
    if "gnews" in sources:
        articles = gnews_scraper.fetch_all()
        raw_events.extend(normalize_gnews(a) for a in articles)
        print(f"[ingest] gnews: {len(articles)} articles fetched", flush=True)

    if "wikifeeds" in sources:
        stories = wikifeeds_scraper.fetch_news()
        raw_events.extend(normalize_wikifeeds(s) for s in stories)
        print(f"[ingest] wikifeeds: {len(stories)} stories fetched", flush=True)

    if not raw_events:
        print("[ingest] no events scraped — check API keys or network", flush=True)
        sys.exit(0)

    # 2. URL dedup (cheap pre-enrichment: drop exact-URL duplicates)
    raw_events = _url_dedup(raw_events)
    print(f"[ingest] after URL dedup: {len(raw_events)} events", flush=True)

    # 3. AI enrichment
    print("[ingest] enriching with Gemini...", flush=True)
    events = enrich_events(raw_events)

    # 4. AI deduplication
    print("[ingest] deduplicating with Gemini...", flush=True)
    events = deduplicate_events(events)
    active = [e for e in events if not e.get("canonicalId")]
    print(f"[ingest] after AI dedup: {len(active)} canonical events ({len(events) - len(active)} duplicates merged)", flush=True)

    if args.dry_run:
        print(json.dumps(events, indent=2, default=str))
        sys.exit(0)

    # 5. Persist
    if SNOWFLAKE_ACCOUNT:
        _persist_snowflake(events, cutoff, args.hours)
    else:
        _persist_fixture(events)


def _url_dedup(events: list[dict]) -> list[dict]:
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    for event in events:
        urls = {link["url"] for link in (event.get("links") or []) if link.get("url")}
        if urls & seen_urls:
            continue
        seen_urls |= urls
        deduped.append(event)
    return deduped


def _persist_snowflake(events: list[dict], cutoff: datetime, window_hours: int) -> None:
    import snowflake.connector
    conn = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        database=os.environ.get("SNOWFLAKE_DATABASE", "EVENTS"),
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "EVENTS_XS"),
    )
    cur = conn.cursor()

    for event in events:
        cur.execute(
            """
            MERGE INTO MART.EVENT t USING (SELECT %s AS id) s ON t.id = s.id
            WHEN NOT MATCHED THEN INSERT (
                id, source, links, layer_id, title, summary,
                occurred_at, updated_at, lat, lng, alt_m, geo_precision, geo_source,
                weight, significance, entities, raw_ref, canonical_id
            ) VALUES (
                %(id)s, %(source)s, PARSE_JSON(%(links)s), %(layerId)s, %(title)s, %(summary)s,
                %(occurredAt)s, %(updatedAt)s, %(lat)s, %(lng)s, %(altM)s, %(geoPrecision)s, %(geoSource)s,
                %(weight)s, %(significance)s, PARSE_JSON(%(entities)s), %(rawRef)s, %(canonicalId)s
            )
            WHEN MATCHED THEN UPDATE SET
                links = PARSE_JSON(%(links)s), updated_at = %(updatedAt)s,
                significance = %(significance)s, canonical_id = %(canonicalId)s
            """,
            {**event,
             "links":    json.dumps(event.get("links") or []),
             "entities": json.dumps(event.get("entities") or []),
             "canonicalId": event.get("canonicalId")},
        )

    # Soft-delete events older than cutoff
    cur.execute(
        "UPDATE MART.EVENT SET archived_at = CURRENT_TIMESTAMP WHERE occurred_at < %s AND archived_at IS NULL",
        (cutoff.isoformat(),),
    )

    # Hard-delete events archived more than window_hours ago
    hard_cutoff = cutoff - timedelta(hours=window_hours)
    cur.execute(
        "DELETE FROM MART.EVENT WHERE archived_at < %s",
        (hard_cutoff.isoformat(),),
    )

    conn.commit()
    cur.close()
    conn.close()
    print(f"[ingest] {len(events)} events upserted to Snowflake", flush=True)


def _persist_fixture(events: list[dict]) -> None:
    """Append new events to the fixture file (skip if id already present)."""
    try:
        with open(FIXTURE_PATH) as f:
            existing = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        existing = []

    existing_ids = {e["id"] for e in existing}
    new_events = [e for e in events if e["id"] not in existing_ids and not e.get("canonicalId")]
    existing.extend(new_events)

    with open(FIXTURE_PATH, "w") as f:
        json.dump(existing, f, indent=2, default=str)

    print(f"[ingest] {len(new_events)} new events appended to {FIXTURE_PATH}", flush=True)


if __name__ == "__main__":
    main()
