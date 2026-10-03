"""Stub related-event linker. Model: gemini-3.8-flash. No live Gemini call in this scaffold."""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LINKS = REPO / "data" / "fixtures" / "links.json"


def load_demo_links() -> list[dict]:
    """Return fixture edges. Hide confidence < 0.7 on the globe. Never emit caused."""
    return json.loads(LINKS.read_text())


def main() -> None:
    links = load_demo_links()
    print(f"link stub: {len(links)} EventLink row(s). Would write MART.EVENT_LINK.")
    print(json.dumps(links, indent=2))


if __name__ == "__main__":
    main()
