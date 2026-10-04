"""My Feed API: profile endpoints on a temporary file, ranking with stubbed events and vectors."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

import main

unit = lambda *xs: np.array(xs, dtype=np.float32) / np.linalg.norm(xs)


class MeApiTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.enterContext(patch.dict(os.environ, {"DATABASE_URL": ""}))
        self.enterContext(patch.object(main, "USER_STATE", Path(temp.name) / "users" / "demo.json"))
        events = [
            {"id": "q1", "layerId": "earthquake", "title": "Strong quake", "significance": 80, "lat": 0, "lng": 120, "occurredAt": "2026-10-04T10:00:00Z", "keywords": [], "entities": []},
            {"id": "f1", "layerId": "sports", "title": "Football final", "significance": 40, "lat": 51, "lng": 0, "occurredAt": "2026-10-04T10:00:00Z", "keywords": [], "entities": []},
            {"id": "x1", "layerId": "food", "title": "Recipes", "significance": 20, "lat": 0, "lng": 0, "occurredAt": "2026-10-04T10:00:00Z", "keywords": [], "entities": []},
        ]
        vectors = {"q1": unit(1, 0, 0), "f1": unit(0, 1, 0), "x1": unit(0, 0, 1),
                   "interest:earthquakes": unit(1, 0.05, 0), "interest:football": unit(0, 1, 0.05)}
        self.enterContext(patch.object(main, "_feed_events", return_value=events))
        self.enterContext(patch.object(main, "_embeddings", return_value=vectors))
        self.enterContext(patch.object(main, "_same_event_pairs", return_value=[]))
        self.client = self.enterContext(TestClient(main.app))

    def test_onboarding_saves_and_feedback_round_trip(self):
        self.assertEqual(self.client.get("/me").json(), {"onboarded": False, "interests": [], "readingList": [], "feedback": {}})
        self.assertEqual(self.client.put("/me/interests", json={"interests": ["nope"]}).status_code, 422)
        me = self.client.put("/me/interests", json={"interests": ["earthquakes", "football"]}).json()
        self.assertTrue(me["onboarded"])
        self.assertEqual(self.client.post("/me/reading-list/f1", json={"view": "headlines"}).json()["readingList"], ["f1"])
        self.assertEqual(self.client.post("/me/reading-list/q1").json()["readingList"], ["f1", "q1"], "a body is optional")
        self.assertEqual(self.client.delete("/me/reading-list/f1").json()["readingList"], ["q1"])
        self.assertEqual(self.client.put("/me/feedback/x1", json={"value": "less", "view": "feed"}).json()["feedback"], {"x1": "less"})
        self.assertEqual(self.client.put("/me/feedback/x1", json={"value": None}).json()["feedback"], {})
        self.assertEqual(self.client.put("/me/feedback/x1", json={"value": "meh"}).status_code, 422)
        self.assertEqual(self.client.post("/me/interactions", json={"eventId": "q1", "kind": "source", "view": "feed"}).json(), {"ok": True})
        self.assertEqual(self.client.post("/me/interactions", json={"eventId": "q1", "kind": "scroll"}).status_code, 422)
        self.assertTrue(main.USER_STATE.is_file())
        self.assertEqual(self.client.delete("/me").json()["onboarded"], False)

    def test_feed_ranks_by_interests_and_reading_list_is_separate(self):
        self.client.put("/me/interests", json={"interests": ["earthquakes"]})
        feed = self.client.get("/me/feed").json()
        self.assertEqual([item["id"] for item in feed["events"]], ["q1"])
        self.assertIn("You follow Earthquakes", feed["events"][0]["reasons"])
        self.client.put("/me/feedback/f1", json={"value": "more", "view": "feed"})
        self.assertIn("f1", [item["id"] for item in self.client.get("/me/feed").json()["events"]], "liking football widens the feed")
        self.client.post("/me/reading-list/x1")
        self.assertEqual([item["id"] for item in self.client.get("/me/feed?savedOnly=1").json()["events"]], ["x1"])

    def test_event_ids_containing_urls_can_be_saved_and_rated(self):
        event_id = "conflict-csv:https://www.example.com/article/some-story/74008777"
        quoted = "/me/reading-list/" + event_id.replace("/", "%2F")
        self.assertEqual(self.client.post(quoted, json={"view": "headlines"}).json()["readingList"], [event_id])
        feedback = "/me/feedback/" + event_id.replace("/", "%2F")
        self.assertEqual(self.client.put(feedback, json={"value": "more"}).json()["feedback"], {event_id: "more"})
        self.assertEqual(self.client.delete(quoted).json()["readingList"], [])

    def test_catalogue_hides_seed_text(self):
        body = self.client.get("/interests").json()
        self.assertGreater(len(body["interests"]), 20)
        self.assertTrue(all("seed" not in item for item in body["interests"]))
        self.assertIn("region", {group["id"] for group in body["groups"]})


if __name__ == "__main__":
    unittest.main()
