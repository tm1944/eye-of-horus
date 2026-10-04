"""
My Feed: the demo user's taste vector and feed ranking. Pure functions over plain data.

Signals (strongest first): onboarding interests (their seed text), "more like this",
saving to the reading list, clicking through to the article, and opening an item. "Less like
this" builds a separate avoid vector. Signals from My Feed count more than from Explore, and
Explore more than Headlines. Everything is recomputed from the profile file on each request,
so undoing a save or a thumbs-up simply removes its contribution.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterable

import numpy as np

SEED_WEIGHT = 1.0
SIGNAL_WEIGHTS = {"more": 2.0, "save": 1.5, "source": 1.0, "open": 0.3}
LESS_WEIGHT = 2.0
VIEW_MULTIPLIER = {"feed": 1.5, "explore": 1.0, "headlines": 0.7}
HALF_LIFE_DAYS = 14.0
MAX_SOURCE_CLICKS = 3  # repeat clicks on one article stop adding after this
FEED_WEIGHTS = {"similarity": 0.55, "interest": 0.20, "significance": 0.15, "freshness": 0.10, "avoid": 0.40}
# Similarities are measured on mean-centred vectors (see `centered`): unrelated stories sit
# near 0 and matching ones around 0.15–0.45, so these thresholds are on that scale.
MIN_SIMILARITY = 0.25  # items matching no chosen interest must be at least this close to the taste vector
PER_CATEGORY = 4
SIMILAR_REASON = 0.55  # "Like <a story you saved>" when an item is this close to one
# Templated, non-news rows (e.g. "VIIRS hotspot cluster 1.0, 39.0"); fires still arrive via GDACS.
EXCLUDED_SOURCES = {"firms"}

LAYER_CATEGORY = {
    **dict.fromkeys(["earthquake", "wildfire", "cyclone", "flood", "volcano", "drought", "environment"], "hazards"),
    **dict.fromkeys(["conflict", "terror", "crime", "protest", "strategic_development"], "security"),
    **dict.fromkeys(["politics", "world", "news", "media"], "politics"),
    **dict.fromkeys(["finance", "business", "technology", "science"], "economy"),
    **dict.fromkeys(["humanitarian", "famine", "health", "education"], "society"),
    **dict.fromkeys(["culture", "entertainment", "sports", "fashion", "travel", "food"], "culture"),
}


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def decay(at: str | None, now: datetime) -> float:
    """Halves every HALF_LIFE_DAYS; unknown times count fully."""
    when = _parse(at)
    if when is None:
        return 1.0
    age_days = max(0.0, (now - when).total_seconds() / 86400)
    return 2 ** (-age_days / HALF_LIFE_DAYS)


def signals(state: dict[str, Any], now: datetime) -> tuple[dict[str, float], dict[str, float]]:
    """Per-event positive and negative weights from the profile. "Less" overrides everything else."""
    positive: dict[str, float] = {}
    negative: dict[str, float] = {}
    feedback = state.get("feedback") or {}
    less = {event_id for event_id, item in feedback.items() if item.get("value") == "less"}

    def add(event_id: str, weight: float, view: str | None, at: str | None) -> None:
        if event_id not in less:
            positive[event_id] = positive.get(event_id, 0.0) + weight * VIEW_MULTIPLIER.get(view or "", 1.0) * decay(at, now)

    for item in state.get("readingList") or []:
        add(item["eventId"], SIGNAL_WEIGHTS["save"], item.get("view"), item.get("addedAt"))
    for event_id, item in feedback.items():
        if item.get("value") == "more":
            add(event_id, SIGNAL_WEIGHTS["more"], item.get("view"), item.get("at"))
        elif item.get("value") == "less":
            negative[event_id] = LESS_WEIGHT * VIEW_MULTIPLIER.get(item.get("view") or "", 1.0) * decay(item.get("at"), now)
    clicks: dict[str, int] = {}
    opened: set[str] = set()
    for item in reversed(state.get("interactions") or []):  # newest first: the latest open counts
        event_id, kind = item.get("eventId"), item.get("kind")
        if not event_id:
            continue
        if kind == "source" and clicks.get(event_id, 0) < MAX_SOURCE_CLICKS:
            clicks[event_id] = clicks.get(event_id, 0) + 1
            add(event_id, SIGNAL_WEIGHTS["source"], item.get("view"), item.get("at"))
        elif kind == "open" and event_id not in opened:
            opened.add(event_id)
            add(event_id, SIGNAL_WEIGHTS["open"], item.get("view"), item.get("at"))
    return positive, negative


def _unit(vector: np.ndarray | None) -> np.ndarray | None:
    if vector is None:
        return None
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 1e-12 else None


def taste_vectors(state: dict[str, Any], vectors: dict[str, np.ndarray], now: datetime):
    """(taste, avoid, positive signal weights). Vectors are unit length, or None without data."""
    positive, negative = signals(state, now)
    total = None
    for interest_id in state.get("interests") or []:
        seed = vectors.get(f"interest:{interest_id}")
        if seed is not None:
            total = seed * SEED_WEIGHT if total is None else total + seed * SEED_WEIGHT
    for event_id, weight in positive.items():
        vector = vectors.get(event_id)
        if vector is not None:
            total = vector * weight if total is None else total + vector * weight
    avoid = None
    for event_id, weight in negative.items():
        vector = vectors.get(event_id)
        if vector is not None:
            avoid = vector * weight if avoid is None else avoid + vector * weight
    return _unit(total), _unit(avoid), positive


def _words(text: str) -> str:
    return " " + re.sub(r"[^a-z0-9]+", " ", text.lower()) + " "


def interest_match(event: dict[str, Any], interests: list[dict[str, Any]]) -> tuple[float, list[str]]:
    """How directly the event matches the chosen interests (0–1), and which ones."""
    haystack = _words(" ".join([event.get("title") or ""] + [term.get("text", "") for term in (event.get("keywords") or []) + (event.get("entities") or [])]))
    hits: list[tuple[float, str]] = []
    for interest in interests:
        score = 0.0
        if event.get("layerId") in interest.get("layers", []):
            score = max(score, 0.6)
        if any(f" {_words(keyword).strip()} " in haystack for keyword in interest.get("keywords", [])):
            score = max(score, 1.0)
        box = interest.get("bbox")
        if box and box[0] <= event.get("lat", 999) <= box[1] and box[2] <= event.get("lng", 999) <= box[3]:
            score = max(score, 0.6)
        if score:
            hits.append((score, interest["label"]))
    hits.sort(key=lambda hit: -hit[0])
    return (hits[0][0] if hits else 0.0), [label for _, label in hits]


def feed_candidates(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [event for event in events if event.get("source") not in EXCLUDED_SOURCES]


def centered(vectors: dict[str, np.ndarray], event_ids: set[str]) -> dict[str, np.ndarray]:
    """
    Subtract the average of the candidate events' vectors, then re-normalise. Raw embeddings
    all point in roughly one direction (every pair scores ~0.8), so cosine says little about
    topic; centred, unrelated stories fall to ~0 and related ones stand out.
    """
    sample = [vector for key, vector in vectors.items() if key in event_ids]
    if not sample:
        return dict(vectors)
    mean = np.mean(sample, axis=0)
    out = {}
    for key, vector in vectors.items():
        if key.startswith("interest:") or key in event_ids:
            shifted = _unit(vector - mean)
            if shifted is not None:
                out[key] = shifted
    return out


def with_seed_fallback(vectors: dict[str, np.ndarray], catalogue: list[dict[str, Any]],
                       events: list[dict[str, Any]]) -> dict[str, np.ndarray]:
    """
    Add an `interest:<id>` vector for any interest whose seed text is not embedded yet: the
    average of the embedded events that match it. Real seeds are kept as they are.
    """
    filled = dict(vectors)
    for interest in catalogue:
        key = f"interest:{interest['id']}"
        if key in filled:
            continue
        matched = [vectors[event["id"]] for event in events if event["id"] in vectors and interest_match(event, [interest])[0] > 0]
        centroid = _unit(np.mean(matched, axis=0)) if matched else None
        if centroid is not None:
            filled[key] = centroid
    return filled


def freshness(occurred_at: str | None, now: datetime) -> float:
    when = _parse(occurred_at)
    if when is None:
        return 0.0
    return 1.0 / (1.0 + max(0.0, (now - when).total_seconds()) / (3 * 86400))


def _story_clusters(pairs: Iterable[tuple[str, str]]) -> dict[str, str]:
    """Union-find over same-event links: every event maps to its story's representative id."""
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[max(root_a, root_b)] = min(root_a, root_b)
    return {node: find(node) for node in parent}


def rank_feed(events: list[dict[str, Any]], state: dict[str, Any], catalogue: list[dict[str, Any]],
              vectors: dict[str, np.ndarray], now: datetime, *, n: int = 20,
              same_event: Iterable[tuple[str, str]] = ()) -> list[dict[str, Any]]:
    """The top n events for this profile, each with `score` and human `reasons`."""
    taste, avoid, positive = taste_vectors(state, vectors, now)
    chosen = [item for item in catalogue if item["id"] in set(state.get("interests") or [])]
    less = {event_id for event_id, item in (state.get("feedback") or {}).items() if item.get("value") == "less"}
    titles = {event["id"]: event.get("title") or "" for event in events}
    liked = [(event_id, vectors[event_id]) for event_id in sorted(positive, key=lambda key: -positive[key]) if event_id in vectors][:30]
    scored = []
    for event in events:
        if event["id"] in less:
            continue
        vector = vectors.get(event["id"])
        similarity = float(taste @ vector) if taste is not None and vector is not None else 0.0
        avoidance = max(0.0, float(avoid @ vector)) if avoid is not None and vector is not None else 0.0
        match, labels = interest_match(event, chosen)
        if match == 0 and similarity < MIN_SIMILARITY:
            continue
        score = (FEED_WEIGHTS["similarity"] * similarity + FEED_WEIGHTS["interest"] * match
                 + FEED_WEIGHTS["significance"] * min(100.0, max(0.0, float(event.get("significance") or 0))) / 100
                 + FEED_WEIGHTS["freshness"] * freshness(event.get("occurredAt"), now)
                 - FEED_WEIGHTS["avoid"] * avoidance)
        reasons = [f"You follow {label}" for label in labels[:2]]
        if vector is not None:
            near = max(((float(other @ vector), other_id) for other_id, other in liked if other_id != event["id"]), default=None)
            if near and near[0] >= SIMILAR_REASON and titles.get(near[1]):
                title = titles[near[1]]
                reasons.append(f"Like “{title[:60]}{'…' if len(title) > 60 else ''}”")
        if not reasons:
            reasons.append("Close to what you read")
        scored.append({**event, "score": round(score, 4), "reasons": reasons})
    scored.sort(key=lambda item: (-item["score"], item["id"]))

    story = _story_clusters(same_event)
    per_category: dict[str, int] = {}
    seen_stories: set[str] = set()
    feed = []
    for item in scored:
        root = story.get(item["id"], item["id"])
        category = LAYER_CATEGORY.get(item.get("layerId", ""), "other")
        if root in seen_stories or per_category.get(category, 0) >= PER_CATEGORY:
            continue
        seen_stories.add(root)
        per_category[category] = per_category.get(category, 0) + 1
        feed.append(item)
        if len(feed) == n:
            break
    return feed


def reading_list(events_by_id: dict[str, dict[str, Any]], state: dict[str, Any]) -> list[dict[str, Any]]:
    """Saved items, most recently saved first; items no longer in the dataset are skipped."""
    items = sorted(state.get("readingList") or [], key=lambda item: item.get("addedAt") or "", reverse=True)
    return [{**events_by_id[item["eventId"]], "reasons": ["In your reading list"]} for item in items if item["eventId"] in events_by_id]
