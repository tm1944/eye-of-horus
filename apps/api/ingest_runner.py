"""Execute a server-configured loader without accepting commands from HTTP."""

import json
import os
import subprocess
import threading
from pathlib import Path

from fastapi import HTTPException

_run_lock = threading.Lock()


def run_ingest(repo_root: Path) -> None:
    raw = os.environ.get("INGEST_COMMAND", "")
    if not raw:
        raise HTTPException(503, detail={
            "failingSource": "ingest",
            "error": "INGEST_COMMAND is not configured; connect Track B's loader first",
        })
    try:
        command = json.loads(raw)
        if not isinstance(command, list) or not command or not all(
            isinstance(arg, str) and arg and "\0" not in arg for arg in command
        ):
            raise ValueError("expected a nonempty JSON argument array")
        timeout = int(os.environ.get("INGEST_TIMEOUT_SECONDS", "60"))
        if not 1 <= timeout <= 300:
            raise ValueError("timeout must be between 1 and 300 seconds")
    except (ValueError, TypeError) as exc:
        raise HTTPException(503, detail={
            "failingSource": "ingest", "error": "Invalid ingestion configuration",
        }) from exc

    if not _run_lock.acquire(blocking=False):
        raise HTTPException(409, detail="An ingestion job is already running")
    try:
        # The server operator supplies every argument. Never invoke a shell or
        # return child output, which could contain credentials or raw records.
        result = subprocess.run(
            command, cwd=repo_root, timeout=timeout, check=False,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if result.returncode:
            raise HTTPException(502, detail={
                "failingSource": "ingest", "error": "Ingestion job failed",
                "exitCode": result.returncode,
            })
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, detail={
            "failingSource": "ingest", "error": "Ingestion job timed out",
        }) from exc
    except OSError as exc:
        raise HTTPException(503, detail={
            "failingSource": "ingest", "error": "Cannot start configured ingestion job",
        }) from exc
    finally:
        _run_lock.release()
