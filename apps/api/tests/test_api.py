"""Track C contract checks. No network, credentials, or repository cache writes."""

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
import tigerdata_client
from tigerdata_client import _row_to_event
from db import DatabasePing


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.events = json.loads(main.EVENTS_FIXTURE.read_text())
        self.links = json.loads(main.LINKS_FIXTURE.read_text())
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.enterContext(patch.dict(os.environ, {"DATABASE_URL": "", "INGEST_SECRET": "", "INGEST_COMMAND": ""}))
        self.enterContext(patch.object(main, "_last_ingest_at", None))
        for name, relative in {
            "SNAPSHOTS_DIR": "snapshots",
            "EVENTS_SNAPSHOT": "snapshots/events.json",
            "LINKS_SNAPSHOT": "snapshots/links.json",
            "SNAPSHOT_META": "snapshots/meta.json",
            "EVENTS_FIXTURE": "fixtures/events.json",
            "LINKS_FIXTURE": "fixtures/links.json",
        }.items():
            self.enterContext(patch.object(main, name, root / relative))
        main.EVENTS_FIXTURE.parent.mkdir()
        main.EVENTS_FIXTURE.write_text(json.dumps(self.events))
        main.LINKS_FIXTURE.write_text(json.dumps(self.links))
        self.client = self.enterContext(TestClient(main.app, raise_server_exceptions=False))

    def test_feed_uses_request_keywords_without_reading_or_saving_preferences(self):
        from jobs.llm import personalize

        before = personalize.CONFIG_PATH.read_bytes()
        with patch.object(personalize, "load_config", side_effect=AssertionError("Must not load preferences")):
            body = self.client.get("/feed?keywords=VIIRS&n=1").json()
        self.assertEqual(body["events"][0]["id"], self.events[1]["id"])
        self.assertEqual(body["sourceStatus"]["usgs"], "fixture")
        self.assertIsNone(body["nextCursor"])
        self.assertEqual(personalize.CONFIG_PATH.read_bytes(), before)

    def test_feed_filters_and_empty_layer_selection(self):
        response = self.client.get("/feed?types=earthquake&minSignificance=60")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["events"], [self.events[0]])
        self.assertEqual(self.client.get("/feed?types=").json()["events"], [])
        self.assertEqual(self.client.get("/feed", params={"end": self.events[1]["occurredAt"]}).json()["events"], [])

    def test_feed_validates_selections_and_limits(self):
        for query in ("n=0", "n=1001", "lat=91&lng=0", "lat=0", "lng=0", "lat=nan&lng=0",
                      "keywords=", "types=unknown", "minSignificance=-1", "start=invalid",
                      "start=2026-10-04T00:00:00Z&end=2026-10-03T00:00:00Z"):
            with self.subTest(query=query):
                self.assertEqual(self.client.get("/feed?" + query).status_code, 422)
        for query in ("n=101", "spreadDegrees=-1", "spreadDegrees=181", "spreadDegrees=nan"):
            self.assertEqual(self.client.get("/feed/pins?" + query).status_code, 422)

    def test_pin_spacing_and_location_ranking(self):
        base = {**self.events[0], "title": "Same title", "significance": 50, "lat": 0}
        rows = [{**base, "id": str(i), "lng": lng} for i, lng in enumerate((0, 5, 90, 180))]
        main.EVENTS_FIXTURE.write_text(json.dumps(rows))
        result = self.client.get("/feed/pins?n=4&spreadDegrees=30&lat=0&lng=0").json()["events"]
        self.assertEqual([row["id"] for row in result], ["0", "2", "3"])
        self.assertEqual(len(self.client.get("/feed/pins?n=4&spreadDegrees=0").json()["events"]), 4)
        self.assertEqual(self.client.get("/feed?n=1&lat=0&lng=180").json()["events"][0]["id"], "3")

    def test_feed_uses_validated_live_rows_and_snapshot_fallback(self):
        healthy = DatabasePing("ok", None)
        dark = DatabasePing("dark", None, "simulated outage")
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=(self.events, healthy)):
            live = self.client.get("/feed?types=wildfire").json()
        self.assertEqual(live["sourceStatus"]["database"], "ok")
        self.assertEqual(live["events"], [self.events[1]])
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=(None, dark)):
            cached = self.client.get("/feed?types=wildfire").json()
        self.assertEqual(cached["events"], live["events"])
        self.assertEqual(cached["sourceStatus"]["database"], "dark")
        self.assertIn("fallbackDetail", cached)

    def test_fixture_contract_detail_and_links(self):
        response = self.client.get("/events")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["events"], self.events)
        self.assertEqual(set(body), {"generatedAt", "sourceStatus", "events", "nextCursor"})
        event_id = self.events[0]["id"]
        self.assertEqual(self.client.get(f"/events/{event_id}").json(), self.events[0])
        self.assertEqual(self.client.get(f"/events/{event_id}/links").json(), self.links)
        for path in ("/events/missing", "/events/missing/links"):
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_filters_and_exclusive_end(self):
        response = self.client.get("/events", params={"types": "earthquake,wildfire", "minSignificance": 60})
        self.assertEqual(response.json()["events"], [self.events[0]])
        timestamp = self.events[0]["occurredAt"]
        response = self.client.get("/events", params={"types": "earthquake", "start": timestamp})
        self.assertEqual(response.json()["events"], [self.events[0]])
        response = self.client.get("/events", params={"types": "earthquake", "end": timestamp})
        self.assertEqual(response.json()["events"], [])

    def test_invalid_queries_are_client_errors(self):
        for params in (
            {"start": "not-a-date"},
            {"start": "2026-10-03T12:00:00"},
            {"start": "2026-10-04T00:00:00Z", "end": "2026-10-03T00:00:00Z"},
            {"limit": 0},
            {"limit": 8001},
        ):
            with self.subTest(params=params):
                self.assertEqual(self.client.get("/events", params=params).status_code, 422)

    def test_cors(self):
        response = self.client.options("/events", headers={
            "Origin": main.DEFAULT_VITE_ORIGIN,
            "Access-Control-Request-Method": "GET",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], main.DEFAULT_VITE_ORIGIN)

    def test_forced_fixture_mode_skips_warehouse(self):
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events") as fetch:
            self.assertEqual(self.client.get("/events?fixture=1").json()["events"], self.events)
            fetch.assert_not_called()

    def test_live_filter_and_small_limit_preserve_fallback_dataset(self):
        healthy = DatabasePing("ok", "2026-10-03T14:00:00Z")
        dark = DatabasePing("dark", None, "simulated outage")

        def fetch(*, limit=None):
            return self.events[:limit], healthy

        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", side_effect=fetch):
            response = self.client.get("/events?types=wildfire&limit=1")
            self.assertEqual(response.json()["events"], [self.events[1]])
            self.assertEqual(json.loads(main.EVENTS_SNAPSHOT.read_text()), self.events)
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=(None, dark)):
            response = self.client.get("/events")
            self.assertEqual(response.json()["events"], self.events)
            self.assertEqual(response.json()["sourceStatus"]["database"], "dark")

    def test_corrupt_snapshot_falls_back_to_fixtures(self):
        main.SNAPSHOTS_DIR.mkdir()
        dark = DatabasePing("dark", None, "simulated outage")
        for content in ("[", "[{}]", '["invalid event"]'):
            with self.subTest(content=content):
                main.EVENTS_SNAPSHOT.write_text(content)
                with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=(None, dark)):
                    response = self.client.get("/events")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["events"], self.events)

    def test_bad_live_rows_do_not_replace_last_good_snapshot(self):
        main.SNAPSHOTS_DIR.mkdir()
        main.EVENTS_SNAPSHOT.write_text(json.dumps(self.events))
        healthy = DatabasePing("ok", None)
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=([{}], healthy)):
            response = self.client.get("/events")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["events"], self.events)
            self.assertEqual(response.json()["sourceStatus"]["database"], "error")
            self.assertEqual(json.loads(main.EVENTS_SNAPSHOT.read_text()), self.events)

    def test_health_fails_when_fixture_cache_is_unreadable(self):
        for content in ("[", "[{}]"):
            with self.subTest(content=content):
                main.EVENTS_FIXTURE.write_text(content)
                self.assertFalse(self.client.get("/health").json()["ok"])
                self.assertEqual(self.client.get("/events").status_code, 503)

    def test_outage_without_cache_names_tigerdata(self):
        main.EVENTS_FIXTURE.unlink()
        dark = DatabasePing("dark", None, "simulated outage")
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=(None, dark)), patch.object(main, "ping_and_warmup", return_value=dark):
            self.assertFalse(self.client.get("/health").json()["ok"])
            response = self.client.get("/events")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["detail"]["failingSource"], "database")

    def test_fixture_sources_are_not_reported_as_live(self):
        status = self.client.get("/events").json()["sourceStatus"]
        self.assertEqual(status, {"usgs": "fixture", "firms": "fixture", "database": "fixture"})

    def test_cursor_pages_all_results_and_rejects_changed_data(self):
        first = self.client.get("/events?limit=1").json()
        second = self.client.get("/events", params={"limit": 1, "cursor": first["nextCursor"]}).json()
        third = self.client.get("/events", params={"limit": 1, "cursor": second["nextCursor"]}).json()
        self.assertEqual(first["events"] + second["events"] + third["events"], self.events)
        self.assertIsNone(third["nextCursor"])
        main.EVENTS_FIXTURE.write_text(json.dumps(self.events[:1]))
        self.assertEqual(self.client.get("/events", params={"cursor": first["nextCursor"]}).status_code, 409)
        self.assertEqual(self.client.get("/events?cursor=invalid").status_code, 422)

    def test_ingest_secret_and_unconfigured_runner(self):
        self.assertEqual(self.client.post("/ingest/run").status_code, 401)
        with patch.dict(os.environ, {"INGEST_SECRET": "test-only-secret"}):
            self.assertEqual(self.client.post("/ingest/run", headers={"X-Ingest-Secret": "wrong"}).status_code, 401)
            for headers in ({"X-Ingest-Secret": "test-only-secret"}, {"Authorization": "Bearer test-only-secret"}):
                response = self.client.post("/ingest/run", headers=headers)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["detail"]["failingSource"], "ingest")

    def test_authorized_ingest_runs_and_reads_new_metadata(self):
        import sys

        main.SNAPSHOTS_DIR.mkdir()
        code = (
            "from pathlib import Path; "
            f"Path({str(main.SNAPSHOT_META)!r}).write_text("
            "'{\"lastIngestAt\":\"2026-10-03T15:00:00Z\"}')"
        )
        with patch.dict(os.environ, {
            "INGEST_SECRET": "test-only-secret",
            "INGEST_COMMAND": json.dumps([sys.executable, "-c", code]),
        }):
            response = self.client.post("/ingest/run", headers={"X-Ingest-Secret": "test-only-secret"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(response.json()["lastIngestAt"], "2026-10-03T15:00:00Z")

    def test_bundled_loader_runs_through_protected_runner(self):
        import sys

        healthy = DatabasePing("ok", "2026-10-03T16:00:00Z")
        with patch.dict(os.environ, {"DATABASE_URL": "configured", "INGEST_SECRET": "test-only"}), patch.object(
            main, "run_ingest"
        ) as runner, patch.object(main, "ping_and_warmup", return_value=healthy):
            response = self.client.post("/ingest/run", headers={"X-Ingest-Secret": "test-only"})
        self.assertEqual(response.status_code, 200)
        runner.assert_called_once_with(main.REPO_ROOT, default_command=[sys.executable, "-m", "jobs.ingest"])
        self.assertEqual(response.json()["lastIngestAt"], healthy.last_ingest_at)

    def test_health_checks_mart_after_successful_ping(self):
        healthy = DatabasePing("ok", None)
        unavailable = DatabasePing("error", None, "MART.EVENT missing")
        with patch.object(main, "ping_and_warmup", return_value=healthy), patch.object(main, "fetch_mart_events", return_value=(None, unavailable)):
            body = self.client.get("/health").json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["database"], "error")
        self.assertEqual(body["dataSource"], "fixture")
        self.assertIn("MART.EVENT", body["detail"])

    def test_health_rejects_unusable_mart_with_no_cache(self):
        main.EVENTS_FIXTURE.unlink()
        healthy = DatabasePing("ok", None)
        with patch.object(main, "ping_and_warmup", return_value=healthy), patch.object(main, "fetch_mart_events", return_value=([{}], healthy)):
            body = self.client.get("/health").json()
        self.assertFalse(body["ok"])
        self.assertEqual(body["dataSource"], "unavailable")

    def test_successful_empty_warehouse_remains_empty(self):
        main.SNAPSHOTS_DIR.mkdir()
        main.EVENTS_SNAPSHOT.write_text(json.dumps(self.events))
        healthy = DatabasePing("ok", None)
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=([], healthy)), patch.object(main, "ping_and_warmup", return_value=healthy):
            body = self.client.get("/events").json()
            health = self.client.get("/health").json()
        self.assertEqual(body["events"], [])
        self.assertEqual(body["sourceStatus"]["database"], "ok")
        self.assertEqual(json.loads(main.EVENTS_SNAPSHOT.read_text()), [])
        self.assertTrue(health["ok"])
        self.assertEqual(health["dataSource"], "warehouse")

    def test_live_links_are_cached_for_an_outage(self):
        healthy = DatabasePing("ok", None)
        dark = DatabasePing("dark", None, "simulated outage")
        link = {**self.links[0], "id": "link:live", "rationale": "Warehouse relation"}
        path = f"/events/{self.events[0]['id']}/links"
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=(self.events, healthy)), patch.object(main, "fetch_mart_links", return_value=([link], healthy)):
            self.assertEqual(self.client.get(path).json(), [link])
        main.LINKS_FIXTURE.unlink()
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=(None, dark)):
            self.assertEqual(self.client.get(path).json(), [link])

    def test_all_links_endpoint_reads_once_and_falls_back(self):
        self.assertEqual(self.client.get("/links").json(), self.links)
        healthy = DatabasePing("ok", None)
        dark = DatabasePing("dark", None, "simulated outage")
        link = {**self.links[0], "id": "link:live"}
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_links", return_value=([link], healthy)), patch.object(main, "fetch_mart_events") as events:
            self.assertEqual(self.client.get("/links").json(), [link])
            events.assert_not_called()
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_links", return_value=(None, dark)):
            self.assertEqual(self.client.get("/links").json(), [link])

    def test_invalid_live_links_use_existing_cache(self):
        healthy = DatabasePing("ok", None)
        path = f"/events/{self.events[0]['id']}/links"
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=(self.events, healthy)), patch.object(main, "fetch_mart_links", return_value=([{}], healthy)):
            self.assertEqual(self.client.get(path).json(), self.links)
        self.assertFalse(main.LINKS_SNAPSHOT.exists())

    def test_source_metadata_survives_snapshot_refresh(self):
        main.SNAPSHOTS_DIR.mkdir()
        main.SNAPSHOT_META.write_text(json.dumps({
            "lastIngestAt": "2026-10-03T14:00:00Z",
            "sourceStatus": {"usgs": "ok", "firms": "error"},
        }))
        healthy = DatabasePing("ok", None)
        with patch.dict(os.environ, {"DATABASE_URL": "configured"}), patch.object(main, "fetch_mart_events", return_value=(self.events, healthy)):
            status = self.client.get("/events").json()["sourceStatus"]
        self.assertEqual(status, {"usgs": "ok", "firms": "error", "database": "ok"})
        self.assertEqual(json.loads(main.SNAPSHOT_META.read_text())["sourceStatus"]["firms"], "error")

    def test_corrupt_metadata_does_not_break_health(self):
        main.SNAPSHOTS_DIR.mkdir()
        main.SNAPSHOT_META.write_bytes(b"\xff")
        self.assertEqual(self.client.get("/health").status_code, 200)

    def test_snapshot_write_failure_preserves_previous_file(self):
        main.SNAPSHOTS_DIR.mkdir()
        main.EVENTS_SNAPSHOT.write_text(json.dumps(self.events))
        with patch.object(Path, "replace", side_effect=OSError("simulated write failure")):
            main._write_snapshot([], last_ingest_at=None)
        self.assertEqual(json.loads(main.EVENTS_SNAPSHOT.read_text()), self.events)
        self.assertEqual(list(main.SNAPSHOTS_DIR.iterdir()), [main.EVENTS_SNAPSHOT])

    def test_outage_health_uses_snapshot_ingest_time(self):
        main.SNAPSHOTS_DIR.mkdir()
        main.SNAPSHOT_META.write_text('{"lastIngestAt":"2026-10-03T14:00:00Z"}')
        dark = DatabasePing("dark", None, "simulated outage")
        with patch.object(main, "ping_and_warmup", return_value=dark):
            body = self.client.get("/health").json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["lastIngestAt"], "2026-10-03T14:00:00Z")
        self.assertEqual(body["database"], "dark")

    def test_connector_warmup_and_ingest_timestamp(self):
        from unittest.mock import MagicMock

        connector = MagicMock()
        connection = connector.connect.return_value
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect = [(1,), (datetime(2026, 10, 3, tzinfo=timezone.utc),)]
        env = {"DATABASE_URL": "postgresql://test-only.invalid/db"}
        with patch.dict(os.environ, env), patch.object(tigerdata_client, "_import_connector", return_value=connector):
            ping = tigerdata_client.ping_and_warmup()
        self.assertEqual(ping.status, "ok")
        self.assertEqual(ping.last_ingest_at, "2026-10-03T00:00:00Z")
        self.assertEqual([call.args[0] for call in cursor.execute.call_args_list], [
            "SELECT 1", "SELECT MAX(pulled_at) FROM raw.ingest_batch",
        ])
        connection.cursor.return_value.__exit__.assert_called_once()
        connection.close.assert_called_once()
        self.assertTrue(connector.connect.call_args.kwargs["autocommit"])
        self.assertEqual(connector.connect.call_args.kwargs["sslmode"], "require")
        self.assertEqual(connector.connect.call_args.kwargs["connect_timeout"], 5)

    def test_tigerdata_connection_error_does_not_disclose_credentials(self):
        from unittest.mock import MagicMock

        connector = MagicMock()
        connector.connect.side_effect = RuntimeError("postgresql://user:secret@host/db")
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://user:secret@host/db"}), patch.object(tigerdata_client, "_import_connector", return_value=connector):
            ping = tigerdata_client.ping_and_warmup()
        self.assertEqual(ping.status, "dark")
        self.assertNotIn("secret", ping.detail)
        self.assertNotIn("postgresql://", ping.detail)

    def test_tigerdata_missing_ingest_metadata_keeps_ping_usable(self):
        from unittest.mock import MagicMock

        connector = MagicMock()
        cursor = connector.connect.return_value.cursor.return_value.__enter__.return_value
        cursor.execute.side_effect = [None, RuntimeError("missing table")]
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test.invalid/db"}), patch.object(tigerdata_client, "_import_connector", return_value=connector):
            ping = tigerdata_client.ping_and_warmup()
        self.assertEqual(ping.status, "ok")
        self.assertIsNone(ping.last_ingest_at)
        self.assertIn("metadata unavailable", ping.detail)

    def test_tigerdata_fixture_mode_never_imports_driver(self):
        with patch.object(tigerdata_client, "_import_connector") as driver:
            ping = tigerdata_client.ping_and_warmup()
        self.assertEqual(ping.status, "fixture")
        driver.assert_not_called()

    def test_tigerdata_row_values_follow_json_contract(self):
        event = _row_to_event(
            ["ENTITIES", "WEIGHT", "OCCURRED_AT"],
            ('[{"type":"place","text":"Napa","confidence":0.9}]', Decimal("1.25"), datetime(2026, 10, 3, tzinfo=timezone.utc)),
        )
        self.assertIsInstance(event["entities"], list)
        self.assertEqual(event["weight"], 1.25)
        self.assertEqual(event["occurredAt"], "2026-10-03T00:00:00Z")
        json.dumps(event)

    def test_connector_reads_both_mart_tables_without_truncating_events(self):
        from unittest.mock import MagicMock

        connector = MagicMock()
        cursor = connector.connect.return_value.cursor.return_value.__enter__.return_value
        healthy = tigerdata_client.DatabasePing("ok", "ok", None)
        env = {"DATABASE_URL": "postgresql://test-only.invalid/db"}
        with patch.dict(os.environ, env), patch.object(tigerdata_client, "_import_connector", return_value=connector), patch.object(tigerdata_client, "ping_and_warmup", return_value=healthy):
            for table, rows, fetch in (
                ("EVENT", self.events, tigerdata_client.fetch_mart_events),
                ("EVENT_LINK", self.links, tigerdata_client.fetch_mart_links),
            ):
                columns = list(rows[0])
                cursor.description = [(name.upper(),) for name in columns]
                cursor.fetchall.return_value = [tuple(row[name] for name in columns) for row in rows]
                result, ping = fetch()
                self.assertEqual(result, rows)
                self.assertEqual(ping.status, "ok")
                cursor.execute.assert_called_with(f"SELECT * FROM mart.{table.lower()} ORDER BY id")


if __name__ == "__main__":
    unittest.main()
