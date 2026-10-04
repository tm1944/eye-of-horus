"""
Build the local news directory: publishers and their RSS feeds, per country.

Source for now: plenaryapp/awesome-rss-feeds (CC0), countries/without_category/*.opml.
Every listed feed is fetched and parsed; only feeds that return items are kept, one feed
per publisher (identified by its website's domain), up to PUBLISHERS_PER_COUNTRY each.

Run:  python -m jobs.news.directory [--dry-run] [--countries GBR,IND]
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import feedparser  # noqa: E402

from db import database_configured, database_url, load_repo_env  # noqa: E402
from jobs.news.countries import COUNTRIES, PUBLISHERS_PER_COUNTRY  # noqa: E402

AWESOME_RAW = "https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master/countries/without_category/"
USER_AGENT = "Mozilla/5.0 (compatible; hypothesis-globe/1.0; +https://github.com/tm1944/hypothesis-globe)"
TIMEOUT = 15
SUBDOMAINS = ("www.", "feeds.", "feed.", "rss.", "m.")


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read(5_000_000)


def awesome_outlines(file_name: str) -> list[tuple[str, str]]:
    """(title, feed URL) pairs. Some OPML files are not well-formed XML, so parse forgivingly."""
    text = fetch(AWESOME_RAW + urllib.parse.quote(file_name + ".opml")).decode("utf-8", "replace")
    attr = lambda tag, key: (m.group(1) if (m := re.search(rf'\b{key}="([^"]*)"', tag)) else None)
    pairs = []
    for tag in re.findall(r"<outline\b[^>]*>", text):
        url = attr(tag, "xmlUrl")
        if url:
            pairs.append((html.unescape(attr(tag, "title") or attr(tag, "text") or ""), html.unescape(url)))
    return pairs


def site_domain(url: str) -> str:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    for prefix in SUBDOMAINS:
        if host.startswith(prefix):
            host = host[len(prefix):]
    return host


def probe(title: str, url: str) -> dict | None:
    """The feed's publisher details if it parses and has items, else None."""
    try:
        parsed = feedparser.parse(fetch(url))
    except Exception:  # noqa: BLE001 — unreachable feeds are simply skipped
        return None
    if not parsed.entries:
        return None
    feed = parsed.feed
    site = feed.get("link") or parsed.entries[0].get("link") or url
    language = (feed.get("language") or "").split("-")[0].lower() or None
    return {
        "feed_url": url,
        "feed_title": feed.get("title") or title,
        "name": (title or feed.get("title") or site_domain(site)).strip(),
        "domain": site_domain(site),
        "language": language,
        "items": len(parsed.entries),
    }


def build(countries: list[str]) -> dict[str, list[dict]]:
    """Working publishers per country (best first: most items), one feed each."""
    chosen: dict[str, list[dict]] = {}
    seen_domains: set[str] = set()
    for iso3 in countries:
        name, awesome = COUNTRIES[iso3]
        if not awesome:
            print(f"  {iso3} {name}: no awesome-rss list yet (needs Media Cloud / Wikidata)")
            chosen[iso3] = []
            continue
        outlines = awesome_outlines(awesome)
        with futures.ThreadPoolExecutor(12) as pool:
            results = [result for result in pool.map(lambda pair: probe(*pair), outlines) if result]
        publishers = []
        for result in sorted(results, key=lambda item: -item["items"]):
            if not result["domain"] or result["domain"] in seen_domains:
                continue
            seen_domains.add(result["domain"])
            publishers.append(result)
            if len(publishers) == PUBLISHERS_PER_COUNTRY:
                break
        chosen[iso3] = publishers
        print(f"  {iso3} {name}: {len(results)}/{len(outlines)} feeds working → {len(publishers)} publishers")
    return chosen


def save(chosen: dict[str, list[dict]]) -> None:
    import psycopg

    with psycopg.connect(database_url(), connect_timeout=20) as conn:
        for iso3, publishers in chosen.items():
            for pub in publishers:
                publisher_id = f"pub:{pub['domain']}"
                conn.execute("""
                    INSERT INTO mart.publisher (publisher_id, name, domain, country_iso3, languages, directory, vetting)
                    VALUES (%s, %s, %s, %s, %s, 'awesome-rss', %s::jsonb)
                    ON CONFLICT (publisher_id) DO UPDATE SET
                      name = EXCLUDED.name, languages = EXCLUDED.languages, vetting = EXCLUDED.vetting
                """, (publisher_id, pub["name"], pub["domain"], iso3, [pub["language"]] if pub["language"] else [],
                      json.dumps({"probe_items": pub["items"], "feed_title": pub["feed_title"]})))
                conn.execute("""
                    INSERT INTO mart.feed (feed_url, publisher_id, title) VALUES (%s, %s, %s)
                    ON CONFLICT (feed_url) DO UPDATE SET publisher_id = EXCLUDED.publisher_id, title = EXCLUDED.title
                """, (pub["feed_url"], publisher_id, pub["feed_title"]))
        conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the local news publisher/feed directory")
    parser.add_argument("--dry-run", action="store_true", help="Probe and report; write nothing")
    parser.add_argument("--countries", default=",".join(COUNTRIES), help="Comma-separated ISO3 codes")
    args = parser.parse_args()
    countries = [code.strip().upper() for code in args.countries.split(",") if code.strip()]
    unknown = [code for code in countries if code not in COUNTRIES]
    if unknown:
        raise SystemExit(f"Not in the country list: {', '.join(unknown)}")

    load_repo_env()
    print(f"Probing feeds for {len(countries)} countries…")
    chosen = build(countries)
    total = sum(len(publishers) for publishers in chosen.values())
    print(f"\n{total} publishers across {sum(1 for p in chosen.values() if p)} countries")
    if args.dry_run:
        print(json.dumps({iso3: [p["name"] for p in pubs] for iso3, pubs in chosen.items() if pubs}, indent=1, ensure_ascii=False))
        return
    if not database_configured():
        raise SystemExit("DATABASE_URL is not set")
    save(chosen)
    print("saved to mart.publisher and mart.feed")


if __name__ == "__main__":
    main()
