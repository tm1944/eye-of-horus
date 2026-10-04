"""
Wikipedia Featured Feed scraper (current events section).

No API key required. Returns 5–15 story items per day.
Endpoint: https://en.wikipedia.org/api/rest_v1/feed/featured/{yyyy}/{mm}/{dd}
"""

import urllib.request
import json
import re
from datetime import date, timezone


def fetch_news(for_date: date | None = None) -> list[dict]:
    """
    Fetch current-events stories from Wikipedia's featured feed for the given date.
    Defaults to today (UTC). Returns a list of dicts with keys:
        _wiki_date   : ISO date string
        _story_text  : plain-text story paragraph (HTML stripped)
        title        : headline derived from first sentence
        links        : list of {url, source, label} dicts
    """
    target = for_date or date.today()
    y  = target.strftime("%Y")
    mm = target.strftime("%m")
    dd = target.strftime("%d")

    url = f"https://en.wikipedia.org/api/rest_v1/feed/featured/{y}/{mm}/{dd}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "hypothesis-globe/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return []

    stories = data.get("onthisday") or data.get("news") or []
    # Prefer the 'news' key (current events); fall back to 'onthisday'
    if "news" in data:
        stories = data["news"]
    elif "onthisday" in data:
        stories = data["onthisday"]
    else:
        return []

    results = []
    for story in stories:
        raw_text = story.get("story") or story.get("text") or ""
        plain = _strip_html(raw_text)
        if not plain:
            continue

        article_links = []
        for page in story.get("links") or story.get("pages") or []:
            content_urls = page.get("content_urls", {})
            desktop_url = (content_urls.get("desktop") or {}).get("page", "")
            if desktop_url:
                article_links.append({
                    "url":    desktop_url,
                    "source": "wikipedia",
                    "label":  page.get("titles", {}).get("normalized") or page.get("title", ""),
                })

        results.append({
            "_wiki_date":  target.isoformat(),
            "_story_text": plain,
            "title":       _first_sentence(plain),
            "links":       article_links,
        })

    return results


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _first_sentence(text: str) -> str:
    match = re.match(r"([^.!?]+[.!?])", text)
    return match.group(1).strip() if match else text[:120]
