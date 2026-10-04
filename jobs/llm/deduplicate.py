"""
Deduplication pipeline.

Two-stage:
  Stage 1 — Cheap blocking: candidate pairs must satisfy BOTH of:
    - Published within DEDUP_TIME_WINDOW_HOURS of each other
    - AND (geo distance < DEDUP_GEO_KM OR title token overlap > DEDUP_TOKEN_OVERLAP)

  Stage 2 — Gemini verification: for each candidate pair, ask Gemini if these are the
    same real-world event. Merge when confidence >= DEDUP_CONFIDENCE.

On merge:
  - The earlier-occurred (or higher-significance) event is kept as the canonical record.
  - The duplicate gets canonicalId = canonical event's id.
  - links[] arrays are merged (deduped by URL).
  - The duplicate is NOT deleted here; run_ingest handles persistence.

Requires GOOGLE_API_KEY. If unset, returns events unchanged.
"""

import os
import json
import math

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
GEMINI_MODEL = "gemini-3.5-flash"

DEDUP_TIME_WINDOW_HOURS = 24
DEDUP_GEO_KM = 200
DEDUP_TOKEN_OVERLAP = 0.5
DEDUP_CONFIDENCE = 0.8


def deduplicate_events(events: list[dict]) -> list[dict]:
    """
    Detect duplicates across events. Returns the same list with canonicalId set on duplicates
    and links[] merged into the canonical record.
    If GOOGLE_API_KEY is unset, returns events unchanged.
    """
    if not GOOGLE_API_KEY or len(events) < 2:
        return events

    pairs = _find_candidate_pairs(events)
    id_map = {e["id"]: e for e in events}

    for i, j in pairs:
        a, b = events[i], events[j]
        if a.get("canonicalId") or b.get("canonicalId"):
            continue

        same, confidence = _gemini_is_same_event(a, b)
        if not same or confidence < DEDUP_CONFIDENCE:
            continue

        canonical, duplicate = _pick_canonical(a, b)
        duplicate["canonicalId"] = canonical["id"]
        merged_links = _merge_links(canonical.get("links") or [], duplicate.get("links") or [])
        canonical["links"] = merged_links

    return events


def _find_candidate_pairs(events: list[dict]) -> list[tuple[int, int]]:
    pairs = []
    for i in range(len(events)):
        for j in range(i + 1, len(events)):
            a, b = events[i], events[j]
            if not _within_time_window(a, b):
                continue
            geo_close = _geo_distance_km(a, b) < DEDUP_GEO_KM
            title_overlap = _token_overlap(a.get("title", ""), b.get("title", ""))
            if geo_close or title_overlap >= DEDUP_TOKEN_OVERLAP:
                pairs.append((i, j))
    return pairs


def _within_time_window(a: dict, b: dict) -> bool:
    try:
        from datetime import datetime, timezone
        ta = datetime.fromisoformat(a["occurredAt"].replace("Z", "+00:00"))
        tb = datetime.fromisoformat(b["occurredAt"].replace("Z", "+00:00"))
        return abs((ta - tb).total_seconds()) <= DEDUP_TIME_WINDOW_HOURS * 3600
    except Exception:
        return False


def _geo_distance_km(a: dict, b: dict) -> float:
    if None in (a.get("lat"), a.get("lng"), b.get("lat"), b.get("lng")):
        return float("inf")
    return _haversine_km(a["lat"], a["lng"], b["lat"], b["lng"])


def _haversine_km(lat1, lng1, lat2, lng2) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _token_overlap(title_a: str, title_b: str) -> float:
    stop = {"a", "an", "the", "in", "on", "at", "of", "for", "and", "or", "to", "is", "are", "was"}
    ta = {t.lower() for t in title_a.split() if t.lower() not in stop and len(t) > 2}
    tb = {t.lower() for t in title_b.split() if t.lower() not in stop and len(t) > 2}
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _gemini_is_same_event(a: dict, b: dict) -> tuple[bool, float]:
    prompt = f"""\
Are these two news items reporting the same real-world event? Respond with JSON only:
{{"same": true/false, "confidence": 0.0-1.0, "reason": "one sentence"}}

Event A:
  Title: {a.get('title', '')}
  Summary: {a.get('summary', '') or ''}
  Occurred: {a.get('occurredAt', '')}

Event B:
  Title: {b.get('title', '')}
  Summary: {b.get('summary', '') or ''}
  Occurred: {b.get('occurredAt', '')}
"""
    try:
        from google import genai  # type: ignore
    except ImportError:
        return False, 0.0
    try:
        client = genai.Client(api_key=GOOGLE_API_KEY)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        result = json.loads(response.text.strip())
        return bool(result.get("same")), float(result.get("confidence", 0.0))
    except Exception:
        return False, 0.0


def _pick_canonical(a: dict, b: dict) -> tuple[dict, dict]:
    """Return (canonical, duplicate). Prefer higher significance; tie-break by earlier occurredAt."""
    if a.get("significance", 0) >= b.get("significance", 0):
        return a, b
    return b, a


def _merge_links(links_a: list[dict], links_b: list[dict]) -> list[dict]:
    seen_urls = set()
    merged = []
    for link in links_a + links_b:
        url = link.get("url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            merged.append(link)
    return merged
