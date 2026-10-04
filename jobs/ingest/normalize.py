"""
Normalise raw scraper output into the Event schema shape (pre-enrichment).

lat/lng are left None; geoSource is set to 'llm_hint' as a signal that the
enrichment step must fill coordinates via Gemini + Google Geocoding.
"""

import hashlib
import re
from datetime import datetime, timezone


def normalize_gnews(article: dict) -> dict:
    """Map a GNews article dict (with _layerId injected by the scraper) to Event shape."""
    published_at = article.get("publishedAt") or datetime.now(timezone.utc).isoformat()
    title = article.get("title") or ""
    url = (article.get("url") or "").strip()
    source_name = (article.get("source") or {}).get("name") or "gnews"

    return {
        "id":           _make_id("gnews", url or title),
        "source":       "gnews",
        "links":        [{"url": url, "source": source_name, "label": title[:80]}] if url else [],
        "layerId":      article.get("_layerId") or "news",
        "title":        title,
        "summary":      article.get("description") or None,
        "occurredAt":   _normalise_dt(published_at),
        "updatedAt":    datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "lat":          None,
        "lng":          None,
        "altM":         None,
        "geoPrecision": None,
        "geoSource":    "llm_hint",
        "weight":       1.0,
        "significance": 0,
        "entities":     [],
        "rawRef":       None,
    }


def normalize_wikifeeds(item: dict) -> dict:
    """Map a Wikifeeds story dict to Event shape. layerId defaults to 'news'; enrichment updates it."""
    wiki_date = item.get("_wiki_date") or datetime.now(timezone.utc).date().isoformat()
    occurred_at = f"{wiki_date}T00:00:00Z"
    title = item.get("title") or item.get("_story_text", "")[:120]

    return {
        "id":           _make_id("wikifeeds", title),
        "source":       "wikifeeds",
        "links":        item.get("links") or [],
        "layerId":      "news",
        "title":        title,
        "summary":      item.get("_story_text") or None,
        "occurredAt":   occurred_at,
        "updatedAt":    datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "lat":          None,
        "lng":          None,
        "altM":         None,
        "geoPrecision": None,
        "geoSource":    "llm_hint",
        "weight":       1.0,
        "significance": 0,
        "entities":     [],
        "rawRef":       None,
    }


def _make_id(prefix: str, seed: str) -> str:
    digest = hashlib.sha1(seed.encode()).hexdigest()[:12]
    return f"{prefix}:{digest}"


def _normalise_dt(dt_str: str) -> str:
    """Return an ISO 8601 UTC datetime string ending in Z."""
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
