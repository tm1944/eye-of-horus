"""Run real local child processes; never invoke the external data sources."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import ingest_runner


class IngestTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.enterContext(patch.dict(os.environ, {"INGEST_COMMAND": "", "INGEST_TIMEOUT_SECONDS": "5"}))

    def command(self, code):
        os.environ["INGEST_COMMAND"] = json.dumps([sys.executable, "-c", code])

    def test_executes_configured_process_from_repo_directory(self):
        self.command("from pathlib import Path; Path('completed.txt').write_text('done')")
        ingest_runner.run_ingest(self.root)
        self.assertEqual((self.root / "completed.txt").read_text(), "done")

    def test_missing_or_malformed_configuration(self):
        for value in ("", "not-json", '"shell command"', '[]', '[1]'):
            with self.subTest(value=value):
                os.environ["INGEST_COMMAND"] = value
                with self.assertRaises(HTTPException) as caught:
                    ingest_runner.run_ingest(self.root)
                self.assertEqual(caught.exception.status_code, 503)

    def test_process_failure_does_not_expose_child_output(self):
        self.command("import sys; print('private-token'); sys.exit(2)")
        with self.assertRaises(HTTPException) as caught:
            ingest_runner.run_ingest(self.root)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertNotIn("private-token", str(caught.exception.detail))
        self.assertEqual(caught.exception.detail["exitCode"], 2)

    def test_timeout_releases_lock_for_next_run(self):
        os.environ["INGEST_TIMEOUT_SECONDS"] = "1"
        self.command("import time; time.sleep(10)")
        with self.assertRaises(HTTPException) as caught:
            ingest_runner.run_ingest(self.root)
        self.assertEqual(caught.exception.status_code, 504)
        self.command("pass")
        ingest_runner.run_ingest(self.root)

    def test_concurrent_request_is_rejected(self):
        self.command("pass")
        with ingest_runner._run_lock:
            with self.assertRaises(HTTPException) as caught:
                ingest_runner.run_ingest(self.root)
        self.assertEqual(caught.exception.status_code, 409)

    def test_nonexistent_executable(self):
        os.environ["INGEST_COMMAND"] = json.dumps([str(self.root / "missing-loader")])
        with self.assertRaises(HTTPException) as caught:
            ingest_runner.run_ingest(self.root)
        self.assertEqual(caught.exception.status_code, 503)
