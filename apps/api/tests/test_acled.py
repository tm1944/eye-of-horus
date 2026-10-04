"""Map ACLED rows without calling the network or the database."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from jobs.ingest.run import acled_significance, prepare_acled_event


def _row(**overrides):
    row = {
        "event_id_cnty": "TST1",
        "event_date": "2026-10-03",
        "event_type": "Battles",
        "sub_event_type": "Armed clash",
        "disorder_type": "Political violence",
        "actor1": "Military Forces",
        "actor2": "Rebel Group",
        "latitude": "1.25",
        "longitude": "2.50",
        "geo_precision": "1",
        "fatalities": "0",
        "notes": "Coded note.",
        "tags": "",
        "country": "Testland",
        "location": "Capital",
    }
    row.update(overrides)
    return row


class AcledMappingTests(unittest.TestCase):
    def test_conflict_types_share_one_table_category(self):
        for event_type in (
            "Battles",
            "Explosions/Remote violence",
            "Violence against civilians",
            "Riots",
        ):
            prepared = prepare_acled_event(_row(event_type=event_type))
            self.assertEqual(prepared["category"], "conflict")
            self.assertEqual(prepared["kind"]["event_type"], event_type)

    def test_protest_parses_crowd_size_and_actors(self):
        prepared = prepare_acled_event(
            _row(
                event_id_cnty="TST2",
                event_type="Protests",
                sub_event_type="Peaceful protest",
                disorder_type="Demonstrations",
                tags="crowd size=small; other",
                geo_precision="2",
                fatalities="0",
            )
        )
        self.assertEqual(prepared["category"], "protest")
        self.assertEqual(prepared["kind"]["crowd_size"], "small")
        self.assertEqual(prepared["geo_precision"], "city")
        self.assertEqual(prepared["event_id"], "acled:TST2")
        self.assertEqual(prepared["entities"][0]["text"], "Military Forces")
        tag_names = [tag for tag, _kind in prepared["tags"]]
        self.assertIn("Protests", tag_names)
        self.assertIn("crowd size=small", tag_names)
        self.assertNotIn("fatalities", tag_names)

    def test_strategic_development_and_significance(self):
        prepared = prepare_acled_event(
            _row(
                event_type="Strategic developments",
                sub_event_type="Agreement",
                disorder_type="Strategic developments",
                geo_precision="3",
                fatalities="12",
                civilian_targeting="Civilian targeting",
            )
        )
        self.assertEqual(prepared["category"], "strategic_development")
        self.assertEqual(prepared["geo_precision"], "region")
        self.assertEqual(prepared["significance"], 100)
        self.assertIn(("fatalities", "impact"), prepared["tags"])
        self.assertIn(("civilian_targeting", "impact"), prepared["tags"])
        self.assertIsNone(prepare_acled_event(_row(event_type="Unknown")))
        self.assertEqual(acled_significance(0, None), 55)
        self.assertEqual(acled_significance(1, None), 60)
