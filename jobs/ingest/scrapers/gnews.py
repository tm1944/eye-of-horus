"""
GNews top-headlines scraper.

Requires GNEWS_API_KEY. Returns an empty list if the key is absent.
Free tier: 100 requests/day. This module makes at most 9 requests per run (one per category).
"""

import os
import urllib.request
import urllib.parse
import json

GNEWS_API_KEY = os.environ.get("GNEWS_API_KEY", "")
GNEWS_BASE = "https://gnews.io/api/v4/top-headlines"

# GNews supported category names → our layerId mapping
CATEGORY_MAP = {
    "general":       "news",
    "world":         "world",
    "nation":        "politics",
    "business":      "business",
    "technology":    "technology",
    "entertainment": "entertainment",
    "sports":        "sports",
    "science":       "science",
    "health":        "health",
}


def fetch_all(max_per_category: int = 10) -> list[dict]:
    """
    Fetch top headlines for all GNews categories.
    Each article dict is raw GNews JSON with an extra '_layerId' key set to our mapped layer.
    Returns [] if GNEWS_API_KEY is unset.
    """
    if not GNEWS_API_KEY:
        return []

    articles = []
    for category, layer_id in CATEGORY_MAP.items():
        batch = _fetch_category(category, max_per_category)
        for article in batch:
            article["_layerId"] = layer_id
        articles.extend(batch)
    return articles


def _fetch_category(category: str, max_articles: int) -> list[dict]:
    params = urllib.parse.urlencode({
        "category": category,
        "lang":     "en",
        "max":      max_articles,
        "apikey":   GNEWS_API_KEY,
    })
    url = f"{GNEWS_BASE}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        return data.get("articles", [])
    except Exception:
        return []
