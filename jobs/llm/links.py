"""
Gemini event link (web) generation for the Hypothesis Globe demo.

Entry point
-----------
generate_links(events, config)
    Takes the user's personalised event list, finds candidate pairs within a
    time/distance window, prompts gemini-3.8-flash for each pair, filters by
    confidence, and persists the results.

Returns a list of EventLink dicts matching packages/schema/link.schema.json.
Falls back to data/fixtures/links.json when GOOGLE_API_KEY is unset.
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow running this file directly from any working directory
sys.path.insert(0, str(Path(__file__).parent))
from personalize import _haversine_km, get_feed, load_config  # noqa: E402

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).parents[2]
LINKS_FIXTURE_PATH = _REPO_ROOT / "data" / "fixtures" / "links.json"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_EVENTS = 50           # cap on events passed into link generation
MAX_PAIRS = 30            # cap on pairs sent to Gemini per run
TIME_WINDOW_HOURS = 72
DISTANCE_WINDOW_KM = 500
MIN_CONFIDENCE = 0.7

ALLOWED_RELATIONS = {"co_occurs", "same_place", "same_topic", "reported_together"}


# ---------------------------------------------------------------------------
# Candidate pair selection
# ---------------------------------------------------------------------------

def _parse_dt(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _find_candidate_pairs(events: list[dict]) -> list[tuple[dict, dict]]:
    """Return event pairs within TIME_WINDOW_HOURS and DISTANCE_WINDOW_KM."""
    pairs: list[tuple[dict, dict]] = []
    for i, a in enumerate(events):
        for b in events[i + 1:]:
            try:
                dt_diff = abs((_parse_dt(a["occurredAt"]) - _parse_dt(b["occurredAt"])).total_seconds())
            except (KeyError, ValueError):
                continue
            if dt_diff > TIME_WINDOW_HOURS * 3600:
                continue
            if _haversine_km(a["lat"], a["lng"], b["lat"], b["lng"]) > DISTANCE_WINDOW_KM:
                continue
            pairs.append((a, b))
            if len(pairs) >= MAX_PAIRS:
                return pairs
    return pairs


# ---------------------------------------------------------------------------
# Gemini prompting
# ---------------------------------------------------------------------------

def _build_prompt(event_a: dict, event_b: dict) -> str:
    def _fmt(e: dict) -> str:
        return (
            f"  ID: {e['id']}\n"
            f"  Title: {e['title']}\n"
            f"  Summary: {e.get('summary') or 'N/A'}\n"
            f"  Source URL: {e.get('sourceUrl') or 'N/A'}\n"
            f"  Time: {e.get('occurredAt', 'N/A')}\n"
            f"  Location: lat={e.get('lat')}, lng={e.get('lng')}"
        )

    return f"""Determine whether these two events are meaningfully related.

Event A:
{_fmt(event_a)}

Event B:
{_fmt(event_b)}

Rules:
- Do NOT assert that one event caused the other.
- Choose ONLY from these relation types: co_occurs, same_place, same_topic, reported_together
- If unrelated, set related to false.

Respond with a JSON object:
{{
  "related": true | false,
  "relation": "co_occurs" | "same_place" | "same_topic" | "reported_together",
  "confidence": <0.0 to 1.0>,
  "rationale": "<1-2 sentence explanation referencing specifics from both events>",
  "citations": ["<source URL from event A if useful>", "<source URL from event B if useful>"]
}}"""


def _prompt_gemini(client: object, event_a: dict, event_b: dict) -> dict | None:
    try:
        from google import genai  # type: ignore

        response = client.models.generate_content(  # type: ignore[attr-defined]
            model="gemini-3.8-flash",
            contents=_build_prompt(event_a, event_b),
            config={"response_mime_type": "application/json"},
        )
        data = json.loads(response.text.strip())
        if not isinstance(data, dict):
            return None
        return data
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _write_fixture(links: list[dict]) -> None:
    existing: list[dict] = []
    if LINKS_FIXTURE_PATH.exists():
        with open(LINKS_FIXTURE_PATH) as f:
            existing = json.load(f)
    existing_ids = {l["id"] for l in existing}
    merged = existing + [l for l in links if l["id"] not in existing_ids]
    with open(LINKS_FIXTURE_PATH, "w") as f:
        json.dump(merged, f, indent=2)


def _write_snowflake(links: list[dict]) -> None:
    import snowflake.connector  # type: ignore

    conn = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        database=os.environ.get("SNOWFLAKE_DATABASE", "EVENTS"),
        schema="MART",
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "EVENTS_XS"),
    )
    try:
        cur = conn.cursor()
        for link in links:
            cur.execute(
                """
                INSERT INTO EVENT_LINK
                    (id, source_id, target_id, relation, confidence, rationale, citations, model)
                SELECT %s, %s, %s, %s, %s, %s, PARSE_JSON(%s), %s
                WHERE NOT EXISTS (
                    SELECT 1 FROM EVENT_LINK WHERE id = %s
                )
                """,
                (
                    link["id"],
                    link["sourceId"],
                    link["targetId"],
                    link["relation"],
                    link["confidence"],
                    link["rationale"],
                    json.dumps(link.get("citations", [])),
                    link["model"],
                    link["id"],
                ),
            )
        conn.commit()
    finally:
        conn.close()


def _persist(links: list[dict]) -> None:
    if os.environ.get("SNOWFLAKE_ACCOUNT"):
        _write_snowflake(links)
    else:
        _write_fixture(links)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def generate_links(
    events: list[dict] | None = None,
    config: dict | None = None,
) -> list[dict]:
    """Generate Gemini event links for a personalised feed.

    If GOOGLE_API_KEY is unset, returns the existing fixture links without
    calling Gemini, so the demo arc still renders offline.
    """
    if config is None:
        config = load_config()
    if events is None:
        events = get_feed(n=MAX_EVENTS, config=config)

    events = events[:MAX_EVENTS]

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        # Offline fallback: return existing fixture links
        if LINKS_FIXTURE_PATH.exists():
            with open(LINKS_FIXTURE_PATH) as f:
                return json.load(f)
        return []

    from google import genai  # type: ignore  # noqa: PLC0415

    client = genai.Client(api_key=api_key)
    pairs = _find_candidate_pairs(events)

    links: list[dict] = []
    for event_a, event_b in pairs:
        data = _prompt_gemini(client, event_a, event_b)
        if data is None or not data.get("related"):
            continue

        confidence = float(data.get("confidence", 0.0))
        if confidence < MIN_CONFIDENCE:
            continue

        relation = data.get("relation", "co_occurs")
        if relation not in ALLOWED_RELATIONS:
            relation = "co_occurs"

        link: dict = {
            "id": f"link:{event_a['id']}:{event_b['id']}",
            "sourceId": event_a["id"],
            "targetId": event_b["id"],
            "relation": relation,
            "confidence": confidence,
            "rationale": str(data.get("rationale", "")),
            "citations": [
                u for u in data.get("citations", [])
                if isinstance(u, str) and u.startswith("http")
            ],
            "model": "gemini-3.8-flash",
        }
        links.append(link)

    if links:
        _persist(links)
    return links
