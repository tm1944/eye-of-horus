"""Stub NASA FIRMS loader. Cite NASA FIRMS. No live MAP_KEY call in this scaffold."""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "data" / "fixtures" / "events.json"


def load_firms_events() -> list[dict]:
    """Return wildfire fixtures. Replace with the Area CSV API and downsample in #10."""
    events = json.loads(FIXTURES.read_text())
    return [event for event in events if event["source"] == "firms"]


def main() -> None:
    rows = load_firms_events()
    print(f"firms stub: {len(rows)} Event row(s). Sample to ~5k heatmap points before markers.")
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
