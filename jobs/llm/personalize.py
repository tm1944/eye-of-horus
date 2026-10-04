"""
Personalisation algorithm for the Hypothesis Globe demo.

Entry points
------------
get_feed(n)         -- keyword-scored feed, top n events
get_feed_smart(n)   -- same but with Gemini re-rank when keyword scores are weak
get_globe_pins(n)   -- top n events spread across the globe for pin display

All functions read user preferences from data/user_config.json.
Falls back to data/fixtures/events.json when SNOWFLAKE_ACCOUNT is unset.

See docs/personalization_algorithm.md for full algorithm spec.
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).parents[2]
CONFIG_PATH = _REPO_ROOT / "data" / "user_config.json"
FIXTURES_PATH = _REPO_ROOT / "data" / "fixtures" / "events.json"

# ---------------------------------------------------------------------------
# Scoring weights (must sum to 1.0)
# ---------------------------------------------------------------------------

W_COORD = 0.3
W_KEYWORD = 0.4
W_SIGNIFICANCE = 0.2
W_RECENCY = 0.1

# ---------------------------------------------------------------------------
# Tuning constants
# ---------------------------------------------------------------------------

COORD_SCORE_MAX_KM = 5000.0   # distance at which coord_score reaches 0
RECENCY_FULL_HOURS = 24       # events within this window score 1.0
RECENCY_HALF_HOURS = 168      # events at this age score 0.5 (7 days)
PIN_SPREAD_DEGREES = 30.0     # minimum angular separation between globe pins
GEMINI_RERANK_THRESHOLD = 0.2 # trigger re-rank when all keyword scores < this
GEMINI_RERANK_POOL = 20       # number of candidates passed to Gemini
GEMINI_RERANK_PICK = 10       # number Gemini selects from the pool


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config() -> dict[str, Any]:
    with open(CONFIG_PATH) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Geo utilities
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def _angular_distance_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle angle in degrees between two lat/lng points."""
    lat1r, lng1r = math.radians(lat1), math.radians(lng1)
    lat2r, lng2r = math.radians(lat2), math.radians(lng2)
    dot = (
        math.cos(lat1r) * math.cos(lng1r) * math.cos(lat2r) * math.cos(lng2r)
        + math.cos(lat1r) * math.sin(lng1r) * math.cos(lat2r) * math.sin(lng2r)
        + math.sin(lat1r) * math.sin(lat2r)
    )
    return math.degrees(math.acos(max(-1.0, min(1.0, dot))))


# ---------------------------------------------------------------------------
# Component scores
# ---------------------------------------------------------------------------

def coord_score(event_lat: float, event_lng: float, coordinates: list[dict]) -> float:
    """1.0 at zero distance, linear decay to 0.0 at COORD_SCORE_MAX_KM."""
    if not coordinates:
        return 0.5  # neutral when user has set no location preferences
    min_dist = min(
        _haversine_km(event_lat, event_lng, c["lat"], c["lng"])
        for c in coordinates
    )
    return max(0.0, 1.0 - min_dist / COORD_SCORE_MAX_KM)


def keyword_score(event: dict, keywords: list[str]) -> float:
    """Fraction of user keywords matched in event text fields.

    Checks: event title tokens, entity text, and any 'labels' field in the DB row.
    Exact phrase match = full weight; any single token match = half weight.
    """
    if not keywords:
        return 0.5  # neutral when user has set no keyword preferences

    # Build a searchable token set from all event text fields
    searchable = set()
    searchable.update(event.get("title", "").lower().split())
    for entity in event.get("entities", []):
        searchable.update(entity.get("text", "").lower().split())
    for label in event.get("labels", []):
        searchable.add(str(label).lower())

    full_text = " ".join(searchable)

    hits = 0.0
    for kw in keywords:
        kw_lower = kw.lower()
        if kw_lower in full_text:
            hits += 1.0
        elif any(token in searchable for token in kw_lower.split()):
            hits += 0.5

    return min(1.0, hits / len(keywords))


def significance_norm(significance: float) -> float:
    return min(1.0, max(0.0, significance / 100.0))


def recency_score(occurred_at: str) -> float:
    """1.0 within RECENCY_FULL_HOURS, linear decay to 0.5 at RECENCY_HALF_HOURS."""
    try:
        ts = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError, TypeError):
        return 0.0
    age_hours = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
    if age_hours <= RECENCY_FULL_HOURS:
        return 1.0
    if age_hours >= RECENCY_HALF_HOURS:
        return 0.5
    span = RECENCY_HALF_HOURS - RECENCY_FULL_HOURS
    return 1.0 - (age_hours - RECENCY_FULL_HOURS) / span * 0.5


def score_event(event: dict, config: dict) -> float:
    cs = coord_score(event["lat"], event["lng"], config.get("coordinates", []))
    ks = keyword_score(event, config.get("keywords", []))
    sn = significance_norm(event.get("significance", 0))
    rs = recency_score(event.get("occurredAt", ""))
    return W_COORD * cs + W_KEYWORD * ks + W_SIGNIFICANCE * sn + W_RECENCY * rs


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def _normalize_row(row: dict) -> dict:
    """Map Snowflake snake_case columns to Event schema camelCase field names."""
    mapping = {
        "layer_id":     "layerId",
        "occurred_at":  "occurredAt",
        "updated_at":   "updatedAt",
        "alt_m":        "altM",
        "geo_precision": "geoPrecision",
        "geo_source":   "geoSource",
        "raw_ref":      "rawRef",
        "canonical_id": "canonicalId",
    }
    return {mapping.get(k, k): v for k, v in row.items()}


def _load_events_snowflake(config: dict) -> list[dict]:
    import snowflake.connector  # type: ignore

    layers = config.get("layers", [])
    sig_floor = config.get("significanceFloor", 0)
    placeholders = ", ".join(["%s"] * len(layers))

    conn = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        database=os.environ.get("SNOWFLAKE_DATABASE", "EVENTS"),
        schema="MART",
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "EVENTS_XS"),
    )
    try:
        cur = conn.cursor(snowflake.connector.DictCursor)
        cur.execute(
            f"""
            SELECT *
            FROM EVENT
            WHERE layer_id IN ({placeholders})
              AND significance >= %s
              AND occurred_at >= DATEADD(day, -7, CURRENT_TIMESTAMP)
              AND archived_at IS NULL
              AND canonical_id IS NULL
            ORDER BY occurred_at DESC
            LIMIT 5000
            """,
            layers + [sig_floor],
        )
        return [_normalize_row(dict(row)) for row in cur.fetchall()]
    finally:
        conn.close()


def _load_events_fixture(config: dict) -> list[dict]:
    with open(FIXTURES_PATH) as f:
        events = json.load(f)
    layers = set(config.get("layers", []))
    sig_floor = config.get("significanceFloor", 0)
    return [
        e for e in events
        if e.get("layerId") in layers and e.get("significance", 0) >= sig_floor
    ]


def _load_events(config: dict) -> list[dict]:
    if os.environ.get("SNOWFLAKE_ACCOUNT"):
        return _load_events_snowflake(config)
    return _load_events_fixture(config)


# ---------------------------------------------------------------------------
# Public feed functions
# ---------------------------------------------------------------------------

def get_feed(n: int = 100, config: dict | None = None) -> list[dict]:
    """Return top n events ranked by relevance score."""
    if config is None:
        config = load_config()
    events = _load_events(config)
    scored = sorted(
        events,
        key=lambda e: score_event(e, config),
        reverse=True,
    )
    return scored[:n]


def get_globe_pins(
    n: int = 10,
    spread_degrees: float = PIN_SPREAD_DEGREES,
    config: dict | None = None,
) -> list[dict]:
    """Return n events spread geographically for globe pin display.

    Uses greedy farthest-point selection: picks the highest-scoring event,
    then repeatedly picks the next highest-scoring event that is at least
    spread_degrees of arc away from every already-selected pin.
    """
    if config is None:
        config = load_config()
    events = _load_events(config)
    scored = sorted(
        events,
        key=lambda e: score_event(e, config),
        reverse=True,
    )

    selected: list[dict] = []
    for event in scored:
        too_close = any(
            _angular_distance_deg(
                event["lat"], event["lng"], s["lat"], s["lng"]
            ) < spread_degrees
            for s in selected
        )
        if not too_close:
            selected.append(event)
        if len(selected) >= n:
            break
    return selected


def get_feed_smart(n: int = 100, config: dict | None = None) -> list[dict]:
    """Keyword-scored feed with optional Gemini re-ranking.

    Gemini re-ranking is only triggered when the user has keywords set
    and all keyword scores in the top candidates are below
    GEMINI_RERANK_THRESHOLD (vocabulary mismatch case).
    """
    if config is None:
        config = load_config()
    keywords = config.get("keywords", [])
    events = _load_events(config)

    scored = sorted(
        [(e, score_event(e, config), keyword_score(e, keywords)) for e in events],
        key=lambda t: t[1],
        reverse=True,
    )

    top_events = [t[0] for t in scored[:n]]

    # Trigger Gemini re-rank only on vocabulary mismatch
    if keywords and all(t[2] < GEMINI_RERANK_THRESHOLD for t in scored[:GEMINI_RERANK_POOL]):
        pool = [t[0] for t in scored[:GEMINI_RERANK_POOL]]
        reranked = _gemini_rerank(pool, keywords)
        reranked_ids = {e["id"] for e in reranked}
        remainder = [t[0] for t in scored[GEMINI_RERANK_POOL:n] if t[0]["id"] not in reranked_ids]
        top_events = reranked + remainder

    return top_events[:n]


# ---------------------------------------------------------------------------
# Gemini re-ranking (internal)
# ---------------------------------------------------------------------------

def _gemini_rerank(events: list[dict], keywords: list[str]) -> list[dict]:
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return events

    try:
        from google import genai  # type: ignore
    except ImportError:
        return events

    client = genai.Client(api_key=api_key)
    event_list = "\n".join(f"{i}. [{e['id']}] {e['title']}" for i, e in enumerate(events))
    prompt = (
        f"User interests: {', '.join(keywords)}\n\n"
        f"Events:\n{event_list}\n\n"
        f"Return a JSON array of up to {GEMINI_RERANK_PICK} zero-based indices identifying "
        "the most semantically relevant events to the user's interests, most relevant first. "
        "Return only the JSON array, no other text."
    )

    try:
        response = client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        indices: list[int] = json.loads(response.text.strip())
        reranked = [events[i] for i in indices if isinstance(i, int) and 0 <= i < len(events)]
        reranked_ids = {e["id"] for e in reranked}
        remainder = [e for e in events if e["id"] not in reranked_ids]
        return reranked + remainder
    except Exception:
        return events
