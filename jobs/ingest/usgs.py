"""Stub USGS loader. Writes Event-shaped dicts. No live HTTP in this scaffold."""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "data" / "fixtures" / "events.json"


def load_usgs_events() -> list[dict]:
    """Return earthquake fixtures. Replace with the real-time GeoJSON feed in #7."""
    events = json.loads(FIXTURES.read_text())
    return [event for event in events if event["source"] == "usgs"]


def main() -> None:
    rows = load_usgs_events()
    print(f"usgs stub: {len(rows)} Event row(s). Would insert RAW.INGEST_BATCH then MART.EVENT.")
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
