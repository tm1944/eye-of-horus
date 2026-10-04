"""RSS ingest helpers: URL canonicalisation, junk rules, fair per-country picking."""

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from jobs.ingest import rss  # noqa: E402

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


def item(publisher, hours_ago=None, n=0):
    return {"item_id": f"{publisher}-{hours_ago}-{n}", "publisher_id": publisher,
            "published_at": None if hours_ago is None else NOW - timedelta(hours=hours_ago)}


class RssTests(unittest.TestCase):
    def test_canonical_url_drops_tracking_and_fragments(self):
        self.assertEqual(rss.canonical_url("HTTPS://News.Example.com/a/b?utm_source=x&id=7&fbclid=y#top"), "https://news.example.com/a/b?id=7")
        self.assertEqual(rss.canonical_url("https://example.com/story"), "https://example.com/story")

    def test_junk_rules_are_conservative(self):
        self.assertEqual(rss.junk_reason("Your horoscope for today", "https://x.com/a"), "junk title")
        self.assertEqual(rss.junk_reason("Election results", "https://x.com/sponsored/123"), "junk path")
        self.assertIsNone(rss.junk_reason("Floods hit the coast", "https://x.com/news/1"))
        self.assertIsNone(rss.junk_reason("Deals struck at the summit", "https://x.com/news/2"), "plural verb, not a deals page")

    def test_fair_pick_shares_slots_across_outlets_and_ranks_undated_last(self):
        items = [item("big", h, n) for n, h in enumerate(range(1, 21))] + [item("small", 5), item("small", 9), item("quiet", None), item("quiet", 30)]
        picked = rss.fair_pick(items, 6)
        publishers = [entry["publisher_id"] for entry in picked]
        self.assertEqual(publishers.count("big"), 2)
        self.assertEqual(publishers.count("small"), 2)
        self.assertEqual(publishers.count("quiet"), 2)
        quiet = [entry for entry in picked if entry["publisher_id"] == "quiet"]
        self.assertIsNotNone(quiet[0]["published_at"], "dated before undated")
        self.assertEqual(len(rss.fair_pick(items, 100)), len(items))
        self.assertEqual(rss.fair_pick([], 5), [])

    def test_clean_text_strips_html_and_caps_length(self):
        self.assertEqual(rss.clean_text("<p>Hello&nbsp;<b>world</b></p>"), "Hello world")
        self.assertEqual(rss.clean_text("one two three four", 9), "one two…")


if __name__ == "__main__":
    unittest.main()
