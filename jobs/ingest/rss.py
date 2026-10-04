"""
Fetch local news from the publisher directory's RSS feeds into raw.feed_item.

For each approved feed that is due (poll_minutes since last fetch, unless --force):
  1. Conditional GET (ETag / Last-Modified); unchanged feeds cost one cheap request.
  2. Parse with feedparser; normalise URL (tracking params stripped), title, summary,
     image, publish time and language.
  3. Prefilter without AI: last --hours only, obvious non-news dropped, items already
     seen skipped, at most --cap newest new items per country per run.
  4. Store survivors as status 'pending'. Enrichment (summary, geocode, category, and the
     locality check) runs separately and promotes them into mart.event.

Run:  python -m jobs.ingest.rss [--dry-run] [--force] [--hours 48] [--cap 30] [--countries GBR,IND]
"""

from __future__ import annotations

import argparse
import calendar
import concurrent.futures as futures
import hashlib
import html
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import feedparser  # noqa: E402

from db import database_configured, database_url, load_repo_env  # noqa: E402

USER_AGENT = "Mozilla/5.0 (compatible; hypothesis-globe/1.0; +https://github.com/tm1944/hypothesis-globe)"
TIMEOUT = 15
MAX_ERRORS = 5  # a feed failing this many times in a row is skipped until reset
SUMMARY_CHARS = 600
TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|cmpid$|ito$|ns_|at_|xtor$|ocid$|taid$|amp$)", re.I)
# Obvious non-news, by title or URL path. Kept short and conservative: enrichment judges the rest.
JUNK_TITLE = re.compile(r"\b(horoscope|sponsored|advertorial|partner content|crossword|sudoku|wordle|quiz of the|deal of the day|coupon|promo code|best deals?)\b", re.I)
JUNK_PATH = re.compile(r"/(sponsored|advertorial|partner-content|horoscopes?|puzzles?|crosswords?|deals|coupons?|podcasts?)(/|$)", re.I)


def canonical_url(url: str) -> str:
    """Drop tracking parameters and fragments so the same article has one id."""
    parts = urllib.parse.urlsplit(url.strip())
    query = urllib.parse.urlencode([(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True) if not TRACKING.match(k)])
    return urllib.parse.urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, query, ""))


def clean_text(value: str | None, limit: int | None = None) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    if limit and len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0] + "…"
    return text


def entry_image(entry) -> str | None:
    for media in (entry.get("media_content") or []) + (entry.get("media_thumbnail") or []):
        url = media.get("url")
        if url and (media.get("medium") in (None, "image") or str(media.get("type", "")).startswith("image")):
            return url
    for link in entry.get("links") or []:
        if link.get("rel") == "enclosure" and str(link.get("type", "")).startswith("image") and link.get("href"):
            return link["href"]
    match = re.search(r'<img[^>]+src="([^"]+)"', entry.get("summary") or "")
    return html.unescape(match.group(1)) if match else None


def entry_time(entry) -> datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        value = entry.get(key)
        if value:
            return datetime.fromtimestamp(calendar.timegm(value), tz=timezone.utc)
    return None


def junk_reason(title: str, url: str) -> str | None:
    if JUNK_TITLE.search(title):
        return "junk title"
    if JUNK_PATH.search(urllib.parse.urlsplit(url).path):
        return "junk path"
    return None


def fetch_feed(feed: dict) -> dict:
    """Conditional GET + parse. Returns {status, etag, last_modified, parsed?}."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"}
    if feed["etag"]:
        headers["If-None-Match"] = feed["etag"]
    if feed["last_modified"]:
        headers["If-Modified-Since"] = feed["last_modified"]
    try:
        with urllib.request.urlopen(urllib.request.Request(feed["feed_url"], headers=headers), timeout=TIMEOUT) as response:
            body = response.read(10_000_000)
            return {"status": "ok", "etag": response.headers.get("ETag"), "last_modified": response.headers.get("Last-Modified"),
                    "parsed": feedparser.parse(body)}
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return {"status": "not_modified", "etag": feed["etag"], "last_modified": feed["last_modified"]}
        return {"status": f"error: HTTP {error.code}"}
    except Exception as error:  # noqa: BLE001 — network trouble is recorded per feed
        return {"status": f"error: {type(error).__name__}"}


def items_from(feed: dict, parsed, since: datetime, now: datetime) -> tuple[list[dict], Counter]:
    """Normalised, prefiltered items from one parsed feed, plus counts of why others were dropped."""
    dropped: Counter = Counter()
    items = []
    language = (parsed.feed.get("language") or "").split("-")[0].lower() or None
    for entry in parsed.entries:
        link, title = entry.get("link"), clean_text(entry.get("title"), 400)
        if not link or not title:
            dropped["no link/title"] += 1
            continue
        url = canonical_url(link)
        published = entry_time(entry)
        if published and (published < since or published > now + timedelta(hours=2)):
            dropped["outside window"] += 1
            continue
        reason = junk_reason(title, url)
        if reason:
            dropped[reason] += 1
            continue
        items.append({
            "item_id": hashlib.sha1(url.encode()).hexdigest(), "feed_url": feed["feed_url"], "publisher_id": feed["publisher_id"],
            "country_iso3": feed["country_iso3"], "url": url, "title": title,
            "summary": clean_text(entry.get("summary") or entry.get("description"), SUMMARY_CHARS) or None,
            "image_url": entry_image(entry), "language": language, "published_at": published,
        })
    return items, dropped


def fair_pick(items: list[dict], cap: int) -> list[dict]:
    """
    Up to `cap` items for one country, shared round-robin across its publishers (each
    publisher's newest first), so one prolific outlet cannot fill the country. Undated items
    rank after dated ones: their recency is unknown.
    """
    by_publisher: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        by_publisher[item["publisher_id"]].append(item)
    oldest = datetime.min.replace(tzinfo=timezone.utc)
    queues = [sorted(group, key=lambda item: (item["published_at"] is not None, item["published_at"] or oldest), reverse=True)
              for group in by_publisher.values()]
    queues.sort(key=lambda queue: queue[0]["published_at"] or oldest, reverse=True)  # freshest outlet goes first
    picked: list[dict] = []
    while len(picked) < cap and any(queues):
        for queue in queues:
            if queue and len(picked) < cap:
                picked.append(queue.pop(0))
    return picked


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch local news RSS feeds into raw.feed_item")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and report; write nothing")
    parser.add_argument("--force", action="store_true", help="Fetch every feed, ignoring poll_minutes")
    parser.add_argument("--hours", type=int, default=48, help="Only keep items published this recently")
    parser.add_argument("--cap", type=int, default=30, help="New items kept per country per run")
    parser.add_argument("--countries", default="", help="Comma-separated ISO3 codes (default: all)")
    args = parser.parse_args()

    load_repo_env()
    if not database_configured():
        raise SystemExit("DATABASE_URL is not set")
    import psycopg

    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=args.hours)
    countries = [code.strip().upper() for code in args.countries.split(",") if code.strip()]
    with psycopg.connect(database_url(), connect_timeout=20) as conn:
        rows = conn.execute("""
            SELECT f.feed_url, f.publisher_id, p.country_iso3, f.etag, f.last_modified, f.last_fetched_at, f.poll_minutes
            FROM mart.feed f JOIN mart.publisher p USING (publisher_id)
            WHERE p.status = 'approved' AND f.error_count < %s AND (cardinality(%s::text[]) = 0 OR p.country_iso3 = ANY(%s))
        """, (MAX_ERRORS, countries, countries)).fetchall()
        feeds = [dict(zip(("feed_url", "publisher_id", "country_iso3", "etag", "last_modified", "last_fetched_at", "poll_minutes"), row)) for row in rows]
        due = [f for f in feeds if args.force or not f["last_fetched_at"] or now - f["last_fetched_at"] >= timedelta(minutes=f["poll_minutes"])]
        print(f"{len(due)} of {len(feeds)} feeds due")

        with futures.ThreadPoolExecutor(12) as pool:
            results = list(pool.map(fetch_feed, due))

        statuses: Counter = Counter()
        dropped: Counter = Counter()
        candidates: dict[str, list[dict]] = defaultdict(list)
        for feed, result in zip(due, results):
            statuses[result["status"].split(":")[0]] += 1
            if result.get("parsed") is not None:
                items, reasons = items_from(feed, result["parsed"], since, now)
                dropped.update(reasons)
                candidates[feed["country_iso3"]].extend(items)

        # Skip items already stored, then keep --cap per country, shared fairly across outlets.
        all_ids = [item["item_id"] for items in candidates.values() for item in items]
        known = {row[0] for row in conn.execute("SELECT item_id FROM raw.feed_item WHERE item_id = ANY(%s)", (all_ids,))} if all_ids else set()
        keep: dict[str, list[dict]] = {}
        for iso3, items in candidates.items():
            unique = {item["item_id"]: item for item in items if item["item_id"] not in known}
            if len(unique) < len({i["item_id"] for i in items}):
                dropped["already stored"] += len({i["item_id"] for i in items}) - len(unique)
            keep[iso3] = fair_pick(list(unique.values()), args.cap)
            dropped["over country cap"] += len(unique) - len(keep[iso3])

        print(f"feeds: {dict(statuses)}")
        print(f"dropped: {dict(dropped)}")
        for iso3 in sorted(keep, key=lambda code: -len(keep[code])):
            print(f"  {iso3}: {len(keep[iso3])} new items")
        if args.dry_run:
            return

        for feed, result in zip(due, results):
            ok = result["status"] in ("ok", "not_modified")
            latest = max((item["published_at"] for item in keep.get(feed["country_iso3"], []) if item["feed_url"] == feed["feed_url"] and item["published_at"]), default=None)
            conn.execute("""
                UPDATE mart.feed SET last_fetched_at = %s, last_status = %s,
                  etag = COALESCE(%s, etag), last_modified = COALESCE(%s, last_modified),
                  error_count = CASE WHEN %s THEN 0 ELSE error_count + 1 END,
                  last_item_at = GREATEST(last_item_at, %s)
                WHERE feed_url = %s
            """, (now, result["status"], result.get("etag"), result.get("last_modified"), ok, latest, feed["feed_url"]))
        stored = 0
        for items in keep.values():
            for item in items:
                stored += conn.execute("""
                    INSERT INTO raw.feed_item (item_id, feed_url, publisher_id, country_iso3, url, title, summary, image_url, language, published_at, fetched_at)
                    VALUES (%(item_id)s, %(feed_url)s, %(publisher_id)s, %(country_iso3)s, %(url)s, %(title)s, %(summary)s, %(image_url)s, %(language)s, %(published_at)s, now())
                    ON CONFLICT (item_id) DO NOTHING
                """, item).rowcount
        conn.commit()
        print(f"stored {stored} pending items in raw.feed_item")


if __name__ == "__main__":
    main()
