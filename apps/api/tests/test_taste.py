"""My Feed taste vector, ranking, and profile state. Small hand-made vectors; no network."""

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

import taste
import user_state

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
iso = lambda delta=timedelta(): (NOW - delta).strftime("%Y-%m-%dT%H:%M:%SZ")
unit = lambda *xs: np.array(xs, dtype=float) / np.linalg.norm(xs)
VECTORS = {
    "interest:quakes": unit(1, 0, 0), "interest:football": unit(0, 1, 0),
    "q1": unit(1, 0.1, 0), "q2": unit(0.9, 0, 0.1), "f1": unit(0, 1, 0.1), "f2": unit(0.1, 0.9, 0), "x1": unit(0, 0, 1),
}
CATALOGUE = [
    {"id": "quakes", "label": "Earthquakes", "layers": ["earthquake"], "keywords": ["quake"]},
    {"id": "football", "label": "Football", "layers": ["sports"], "keywords": ["football"]},
    {"id": "europe", "label": "Europe", "layers": [], "keywords": [], "bbox": [35, 72, -25, 45]},
]


def event(event_id, layer, title="", significance=50, lat=0, lng=0, age=timedelta(hours=1)):
    return {"id": event_id, "layerId": layer, "title": title, "significance": significance, "lat": lat, "lng": lng,
            "occurredAt": iso(age), "keywords": [], "entities": []}


EVENTS = [event("q1", "earthquake", "Strong quake"), event("q2", "earthquake", "Aftershocks"),
          event("f1", "sports", "Football final"), event("f2", "sports", "Transfer news"), event("x1", "food", "Recipes")]


class SignalTests(unittest.TestCase):
    def test_weights_views_decay_and_less_override(self):
        state = {
            "readingList": [{"eventId": "q1", "addedAt": iso(), "view": "feed"}],
            "feedback": {"f1": {"value": "more", "at": iso(), "view": "headlines"},
                         "x1": {"value": "less", "at": iso(), "view": "explore"}},
            "interactions": [{"eventId": "q2", "kind": "source", "view": "explore", "at": iso(timedelta(days=14))},
                             *[{"eventId": "f2", "kind": "open", "view": "explore", "at": iso()}] * 3,
                             {"eventId": "x1", "kind": "source", "view": "feed", "at": iso()}],
        }
        positive, negative = taste.signals(state, NOW)
        self.assertAlmostEqual(positive["q1"], 1.5 * 1.5)          # save, from My Feed
        self.assertAlmostEqual(positive["f1"], 2.0 * 0.7)          # more, from Headlines
        self.assertAlmostEqual(positive["q2"], 1.0 * 0.5)          # click, one half-life ago
        self.assertAlmostEqual(positive["f2"], 0.3)                # opened three times, counted once
        self.assertNotIn("x1", positive)                           # "less" overrides the click
        self.assertAlmostEqual(negative["x1"], 2.0)

    def test_repeat_article_clicks_are_capped(self):
        state = {"interactions": [{"eventId": "q1", "kind": "source", "view": "explore", "at": iso()}] * 10}
        self.assertAlmostEqual(taste.signals(state, NOW)[0]["q1"], 3.0)


class RankingTests(unittest.TestCase):
    def test_interests_alone_rank_matching_events_first_and_drop_unrelated(self):
        feed = taste.rank_feed(EVENTS, {"interests": ["quakes"]}, CATALOGUE, VECTORS, NOW, n=10)
        self.assertEqual([item["id"] for item in feed][:2], ["q1", "q2"])
        self.assertNotIn("x1", [item["id"] for item in feed])
        self.assertIn("You follow Earthquakes", feed[0]["reasons"])

    def test_likes_shift_the_feed_and_less_removes_and_repels(self):
        state = {"interests": ["quakes", "football"],
                 "feedback": {"f1": {"value": "more", "at": iso(), "view": "feed"}, "q2": {"value": "less", "at": iso(), "view": "feed"}}}
        feed = [item["id"] for item in taste.rank_feed(EVENTS, state, CATALOGUE, VECTORS, NOW, n=10)]
        self.assertNotIn("q2", feed)
        self.assertLess(feed.index("f2"), feed.index("q1"), "football now outranks quakes")
        liked = next(item for item in taste.rank_feed(EVENTS, state, CATALOGUE, VECTORS, NOW, n=10) if item["id"] == "f2")
        self.assertTrue(any(reason.startswith("Like “Football final") for reason in liked["reasons"]))

    def test_category_cap_and_story_dedupe(self):
        quakes = [event(f"q{i}", "earthquake", "quake") for i in range(1, 8)]
        vectors = {**VECTORS, **{f"q{i}": unit(1, 0, i / 100) for i in range(1, 8)}}
        feed = taste.rank_feed(quakes, {"interests": ["quakes"]}, CATALOGUE, vectors, NOW, n=10)
        self.assertEqual(len(feed), taste.PER_CATEGORY)
        deduped = taste.rank_feed(quakes, {"interests": ["quakes"]}, CATALOGUE, vectors, NOW, n=10, same_event=[("q1", "q2"), ("q2", "q3")])
        ids = [item["id"] for item in deduped]
        self.assertEqual(sum(item in ids for item in ("q1", "q2", "q3")), 1, "one item per story")

    def test_keyword_and_region_matching_without_vectors(self):
        madrid = event("m1", "politics", "Madrid housing vote", lat=40.4, lng=-3.7)
        match, labels = taste.interest_match(madrid, CATALOGUE)
        self.assertEqual((match, labels), (0.6, ["Europe"]))
        self.assertEqual(taste.interest_match(event("k", "news", "Football: the big quake of a game"), CATALOGUE)[0], 1.0)
        self.assertEqual(taste.interest_match(event("n", "news", "Quakers meet"), CATALOGUE)[0], 0.0, "whole words only")

    def test_missing_seed_falls_back_to_the_average_of_matching_events(self):
        vectors = {key: value for key, value in VECTORS.items() if key != "interest:quakes"}
        filled = taste.with_seed_fallback(vectors, CATALOGUE, EVENTS)
        expected = (VECTORS["q1"] + VECTORS["q2"]) / np.linalg.norm(VECTORS["q1"] + VECTORS["q2"])
        self.assertTrue(np.allclose(filled["interest:quakes"], expected))
        self.assertIs(filled["interest:football"], VECTORS["interest:football"], "real seeds are kept")
        self.assertNotIn("interest:europe", filled, "no matching embedded events: no seed")
        feed = taste.rank_feed(EVENTS, {"interests": ["quakes"]}, CATALOGUE, filled, NOW, n=10)
        self.assertEqual(feed[0]["id"], "q1")

    def test_centering_separates_topics_and_firms_is_not_a_candidate(self):
        # Two topics that share a big common direction: raw cosine ~0.98, centred they part ways.
        common = np.array([10.0, 0, 0, 0])
        raw = {"a": common + [0, 1, 0, 0], "b": common + [0, 0, 1, 0], "c": common + [0, -1, -1, 0], "interest:x": common + [0, 1, 0, 0]}
        raw = {k: v / np.linalg.norm(v) for k, v in raw.items()}
        self.assertGreater(float(raw["a"] @ raw["b"]), 0.95)
        out = taste.centered(raw, {"a", "b", "c"})
        self.assertLess(float(out["a"] @ out["b"]), 0.1)
        self.assertGreater(float(out["interest:x"] @ out["a"]), 0.9, "seeds are shifted by the same mean")
        rows = [{"source": "firms", "layerId": "wildfire"}, {"source": "gnews", "layerId": "politics"},
                {"source": "usgs", "layerId": "earthquake"}, {"source": "gnews", "layerId": "environment"}]
        self.assertEqual(taste.feed_candidates(rows), [rows[1]], "no FIRMS, no natural-hazard layers")

    def test_reading_list_is_newest_first(self):
        state = {"readingList": [{"eventId": "q1", "addedAt": iso(timedelta(hours=2))}, {"eventId": "f1", "addedAt": iso()},
                                 {"eventId": "gone", "addedAt": iso()}]}
        items = taste.reading_list({e["id"]: e for e in EVENTS}, state)
        self.assertEqual([item["id"] for item in items], ["f1", "q1"])


class StateTests(unittest.TestCase):
    def test_round_trip_and_mutations(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "users" / "demo.json"
            state = user_state.load(path)
            self.assertFalse(user_state.public(state)["onboarded"])
            state = user_state.set_interests(state, ["quakes", "quakes", "football"], "2026-10-04T00:00:00Z")
            state = user_state.set_saved(state, "q1", True, "feed", "t1")
            state = user_state.set_saved(state, "q1", True, "feed", "t2")  # saving twice keeps the first time
            state = user_state.set_feedback(state, "f1", "more", "explore", "t3")
            state = user_state.add_interaction(state, "q1", "open", "feed", "t4")
            user_state.save(path, state)
            loaded = user_state.load(path)
            self.assertEqual(user_state.public(loaded), {"onboarded": True, "interests": ["quakes", "football"],
                                                          "readingList": ["q1"], "feedback": {"f1": "more"}})
            self.assertEqual(loaded["readingList"][0]["addedAt"], "t1")
            cleared = user_state.set_feedback(user_state.set_saved(loaded, "q1", False, None, "t5"), "f1", None, None, "t6")
            self.assertEqual(user_state.public(cleared)["readingList"], [])
            self.assertEqual(user_state.public(cleared)["feedback"], {})

    def test_interactions_are_capped_and_bad_files_reset(self):
        state = user_state.empty()
        for i in range(user_state.MAX_INTERACTIONS + 10):
            state = user_state.add_interaction(state, f"e{i}", "open", "feed", "t")
        self.assertEqual(len(state["interactions"]), user_state.MAX_INTERACTIONS)
        self.assertEqual(state["interactions"][0]["eventId"], "e10")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "demo.json"
            path.write_text("not json")
            self.assertEqual(user_state.load(path), user_state.empty())


if __name__ == "__main__":
    unittest.main()
