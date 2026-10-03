"""Stub Gemini extract. Model: gemini-3.5-flash-lite. No live Gemini call in this scaffold."""

from __future__ import annotations

import json


def extract_entities(title: str, body: str | None = None) -> dict:
    """Return the extract JSON shape. Wire google-genai in #11."""
    del body
    return {
        "label": title,
        "eventType": "unknown",
        "placeText": None,
        "actors": [],
        "confidence": 0.0,
        "model": "gemini-3.5-flash-lite",
        "status": "stub",
    }


def main() -> None:
    print(json.dumps(extract_entities("Stub headline"), indent=2))


if __name__ == "__main__":
    main()
