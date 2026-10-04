"""
Backfill mart.event.image_url for events that have no thumbnail yet (see images.py for
how each source finds one). Safe to re-run: only rows without an image are tried.

Run:  python -m jobs.ingest.backfill_images [--dry-run] [--limit N] [--sources usgs,gdacs]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from db import database_configured, database_url, load_repo_env  # noqa: E402
from jobs.ingest.images import SOURCES, fill_missing_images  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill event thumbnails into mart.event.image_url")
    parser.add_argument("--dry-run", action="store_true", help="Report what would be written; change nothing")
    parser.add_argument("--limit", type=int, default=0, help="Only process this many events")
    parser.add_argument("--sources", default=",".join(SOURCES), help=f"Comma-separated, from: {', '.join(SOURCES)}")
    args = parser.parse_args()
    sources = [name.strip() for name in args.sources.split(",") if name.strip()]
    unknown = set(sources) - set(SOURCES)
    if unknown:
        raise SystemExit(f"Unknown sources: {', '.join(sorted(unknown))}")

    load_repo_env()
    if not database_configured():
        raise SystemExit("DATABASE_URL is not set")
    import psycopg

    with psycopg.connect(database_url(), connect_timeout=20) as conn:
        result = fill_missing_images(conn, sources=sources, limit=args.limit, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
