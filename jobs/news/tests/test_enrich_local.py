"""Local news enrichment: the locality decision, prompt shape, and country fallbacks."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from jobs.news import enrich_local as e  # noqa: E402

ITEM = {"item_id": "abc", "country_iso3": "IRL", "publisher_name": "The Irish Times", "title": "Dáil vote", "summary": "S", "language": None}


class EnrichLocalTests(unittest.TestCase):
    def test_locality_is_decided_in_code(self):
        self.assertTrue(e.verdict_for(ITEM, {"aboutCountryIso3": "irl"})["isLocal"], "case-insensitive")
        away = e.verdict_for(ITEM, {"aboutCountryIso3": "GBR"})
        self.assertFalse(away["isLocal"])
        self.assertEqual(away["reason"], "about GBR, publisher in IRL")
        international = e.verdict_for(ITEM, {"aboutCountryIso3": ""})
        self.assertEqual((international["isLocal"], international["aboutCountryIso3"]), (False, None))
        self.assertEqual(e.verdict_for(ITEM, {})["reason"], "international story, no single country")

    def test_prompt_carries_ids_and_publisher_country(self):
        prompt = e.build_prompt([ITEM], {"IRL": "Ireland"})
        items = json.loads(prompt.split("ITEMS:\n", 1)[1])
        self.assertEqual(items[0]["id"], "abc")
        self.assertEqual(items[0]["PUBLISHER_COUNTRY"], "Ireland (IRL)")
        self.assertEqual(items[0]["language_hint"], "unknown")
        self.assertIn("aboutCountryIso3", prompt)

    def test_country_centroids_cover_the_target_countries(self):
        centroids, names = e.country_centroids()
        lat, lng = centroids["IRL"]
        self.assertTrue(51 < lat < 56 and -11 < lng < -5, (lat, lng))
        self.assertEqual(names["JPN"], "Japan")


if __name__ == "__main__":
    unittest.main()
