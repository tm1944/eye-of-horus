"""Map conflict CSV rows without calling the network or the database."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from jobs.ingest.run import conflict_csv_significance, prepare_conflict_csv_row


def _row(**overrides):
    row = {
        "SQLDATE": "20261002",
        "Actor1Name": "NATO",
        "Actor2Name": "MILITARY",
        "EventCode": "190",
        "ActionGeo_FullName": "Baltic Sea, Oceans (general), Oceans",
        "ActionGeo_Lat": "56.0",
        "ActionGeo_Long": "18.0",
        "GoldsteinScale": "-10.0",
        "NumArticles": "96",
        "SOURCEURL": "https://example.com/story",
        "title": "Example conflict",
        "description": "A coded summary.",
        "category": "conflict",
    }
    row.update(overrides)
    return row


class ConflictCsvTests(unittest.TestCase):
    def test_conflict_row_builds_kind_and_clears_marker_threshold(self):
        prepared = prepare_conflict_csv_row(_row())
        self.assertEqual(prepared["category"], "conflict")
        self.assertEqual(prepared["event_id"], "conflict-csv:https://example.com/story")
        self.assertEqual(prepared["geo_precision"], "region")
        self.assertEqual(prepared["significance"], 100)
        self.assertEqual(prepared["weight"], 96)
        self.assertEqual(prepared["kind"]["event_type"], "conflict")
        self.assertEqual(prepared["kind"]["actor1"], "NATO")
        self.assertEqual(prepared["occurred_at"].isoformat(), "2026-10-02T00:00:00+00:00")
        self.assertIn(("190", "keyword"), prepared["tags"])

    def test_city_protest_and_crime_categories(self):
        protest = prepare_conflict_csv_row(
            _row(
                category="protest",
                ActionGeo_FullName="Helsinki, Finland",
                GoldsteinScale="0",
                SOURCEURL="https://example.com/protest",
            )
        )
        self.assertEqual(protest["geo_precision"], "city")
        self.assertEqual(protest["significance"], 55)
        self.assertEqual(protest["kind"]["location"], "Helsinki, Finland")
        crime = prepare_conflict_csv_row(_row(category="crime", SOURCEURL="https://example.com/crime"))
        self.assertEqual(crime["category"], "crime")
        self.assertIsNone(crime["kind"])

    def test_incomplete_rows_are_skipped(self):
        self.assertIsNone(prepare_conflict_csv_row(_row(ActionGeo_Lat="")))
        self.assertIsNone(prepare_conflict_csv_row(_row(category="weather")))
        self.assertEqual(conflict_csv_significance("-9"), 95.5)
