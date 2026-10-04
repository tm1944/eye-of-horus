"""Exercise the shared PR #30 adapter without accessing the shared database."""

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

import db


class DatabaseTests(unittest.TestCase):
    def test_environment_precedence_and_legacy_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / ".env").write_text('DATABASE_URL="postgresql://primary.invalid/db"\n')
            (root / ".env.local").write_text('DATABASE_URL=legacy\nFIRMS_MAP_KEY=test-only\n')
            with patch.object(db, "REPO_ROOT", root), patch.dict(os.environ, {}, clear=True):
                db.load_repo_env()
                self.assertEqual(db.database_url(), "postgresql://primary.invalid/db")
                self.assertEqual(os.environ["FIRMS_MAP_KEY"], "test-only")
                os.environ["DATABASE_URL"] = "process-wins"
                db.load_repo_env()
                self.assertEqual(db.database_url(), "process-wins")

    def test_event_read_reuses_ping_and_does_not_truncate(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.description = []
        cursor.fetchall.return_value = []
        healthy = db.DatabasePing("ok", None)
        with patch.object(db, "_connect", return_value=connection), patch.object(db, "ping_and_warmup") as ping:
            self.assertEqual(db.fetch_mart_events(ping=healthy), ([], healthy))
        ping.assert_not_called()
        sql = cursor.execute.call_args.args[0]
        self.assertNotIn("LIMIT", sql)
        self.assertIn("e.event_id", sql)
        connection.close.assert_called_once()

    def test_connection_failures_do_not_disclose_credentials(self):
        with patch.object(db, "database_configured", return_value=True), patch.object(
            db, "_connect", side_effect=RuntimeError("postgresql://user:private@host/db")
        ):
            result = db.ping_and_warmup()
        self.assertEqual(result.status, "dark")
        self.assertNotIn("private", result.detail)

    def test_all_links_are_read_for_complete_snapshot(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [("link:1", "a", "b", "related", Decimal("0.9"), "Reason", [], "model")]
        with patch.object(db, "database_configured", return_value=True), patch.object(db, "_connect", return_value=connection):
            links, ping = db.fetch_mart_links()
        self.assertEqual(ping.status, "ok")
        self.assertEqual(cursor.execute.call_args.args[1], (None, None, None))
        self.assertEqual(links[0]["confidence"], 0.9)
        json.dumps(links)

    def test_postgres_numeric_and_nested_attributes_are_json_serializable(self):
        row = {
            "id": "test", "source": "usgs", "layer_id": "earthquake", "title": "Test",
            "lng": Decimal("1.2"), "lat": Decimal("3.4"), "significance": Decimal("5"),
            "geo_precision": "point", "geo_source": "native",
            "occurred_at": datetime(2026, 10, 3, tzinfo=timezone.utc),
            "attributes": {"depth": Decimal("6.7")},
        }
        event = db._row_to_event(row)
        self.assertEqual(event["attributes"]["depth"], 6.7)
        json.dumps(event)

    def test_connection_requires_tls_and_bounded_queries(self):
        with patch.object(db, "database_url", return_value="postgresql://test.invalid/db"), patch("psycopg.connect") as connect:
            db._connect()
        self.assertEqual(connect.call_args.kwargs["sslmode"], "require")
        self.assertEqual(connect.call_args.kwargs["connect_timeout"], 5)
        self.assertIn("statement_timeout=10000", connect.call_args.kwargs["options"])
