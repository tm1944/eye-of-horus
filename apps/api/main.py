"""Hypothesis Globe FastAPI — health, sourceStatus, fixture fallback (issue #9)."""

from __future__ import annotations

import json
import base64
import hashlib
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from jsonschema import Draft202012Validator, FormatChecker
from ingest_runner import run_ingest

from db import (
    database_configured,
    fetch_links_for_event,
    fetch_mart_events,
    fetch_mart_links,
    ping_and_warmup,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "data" / "fixtures"
SNAPSHOTS_DIR = REPO_ROOT / "data" / "snapshots"
EVENTS_FIXTURE = FIXTURES_DIR / "events.json"
LINKS_FIXTURE = FIXTURES_DIR / "links.json"
EVENTS_SNAPSHOT = SNAPSHOTS_DIR / "events.json"
LINKS_SNAPSHOT = SNAPSHOTS_DIR / "links.json"
SNAPSHOT_META = SNAPSHOTS_DIR / "meta.json"

DEFAULT_VITE_ORIGIN = "http://127.0.0.1:43123"
_SCHEMA_DIR = REPO_ROOT / "packages" / "schema"
_VALIDATORS = {
    name: Draft202012Validator(
        json.loads((_SCHEMA_DIR / f"{name}.schema.json").read_text()),
        format_checker=FormatChecker(),
    )
    for name in ("event", "link")
}

# In-process last-known ingest time, updated by warehouse reads.
_last_ingest_at: str | None = None


def _cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGIN") or os.environ.get("VITE_ORIGIN") or DEFAULT_VITE_ORIGIN
    origins = [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]
    if DEFAULT_VITE_ORIGIN in origins and "http://localhost:43123" not in origins:
        origins.append("http://localhost:43123")
    return list(dict.fromkeys(origins))


app = FastAPI(title="Hypothesis Globe API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_snapshot_meta() -> dict[str, Any]:
    if not SNAPSHOT_META.is_file():
        return {}
    try:
        data = _load_json(SNAPSHOT_META)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _remember_last_ingest(value: str | None) -> str | None:
    global _last_ingest_at
    if value:
        _last_ingest_at = value
    return _last_ingest_at


def _resolved_last_ingest(ping_value: str | None = None) -> str | None:
    if ping_value:
        return _remember_last_ingest(ping_value)
    meta = _read_snapshot_meta()
    stored = meta.get("lastIngestAt")
    candidates = [value for value in (stored, _last_ingest_at) if isinstance(value, str)]
    valid: list[tuple[datetime, str]] = []
    for value in candidates:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is not None:
                valid.append((parsed, value))
        except ValueError:
            continue
    return max(valid)[1] if valid else None


def _validate_rows(data: Any, kind: str) -> list[dict[str, Any]]:
    if not isinstance(data, list):
        raise ValueError(f"{kind} data is not a JSON array")
    for index, row in enumerate(data):
        error = next(_VALIDATORS[kind].iter_errors(row), None)
        if error is not None:
            raise ValueError(f"{kind} row {index} violates the shared schema at {error.json_path}")
        if kind == "event":
            # datetime parsing is also required by the time filter.
            for field in ("occurredAt", "updatedAt"):
                parsed = datetime.fromisoformat(row[field].replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError(f"{kind} row {index} needs a timezone in {field}")
    return data


def _load_json_array(path: Path, kind: str) -> list[dict[str, Any]]:
    return _validate_rows(_load_json(path), kind)


def _load_events_cache(*, prefer_snapshot: bool) -> tuple[list[dict[str, Any]], str]:
    """Load events from snapshot and/or fixtures. Raises 503 if nothing readable."""
    order = (
        ((EVENTS_SNAPSHOT, "snapshot"), (EVENTS_FIXTURE, "fixture"))
        if prefer_snapshot
        else ((EVENTS_FIXTURE, "fixture"), (EVENTS_SNAPSHOT, "snapshot"))
    )
    errors: list[str] = []
    for path, label in order:
        if not path.is_file():
            errors.append(f"{label} missing ({path})")
            continue
        try:
            return _load_json_array(path, "event"), label
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            errors.append(f"{label} unreadable: {exc}")
    raise HTTPException(
        status_code=503,
        detail={
            "error": "No cached events available",
            "failingSource": "fixtures",
            "reasons": errors,
        },
    )


def _load_links_cache(*, prefer_snapshot: bool) -> tuple[list[dict[str, Any]], str]:
    order = (
        ((LINKS_SNAPSHOT, "snapshot"), (LINKS_FIXTURE, "fixture"))
        if prefer_snapshot
        else ((LINKS_FIXTURE, "fixture"), (LINKS_SNAPSHOT, "snapshot"))
    )
    errors: list[str] = []
    for path, label in order:
        if not path.is_file():
            errors.append(f"{label} missing ({path})")
            continue
        try:
            return _load_json_array(path, "link"), label
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            errors.append(f"{label} unreadable: {exc}")
    raise HTTPException(
        status_code=503,
        detail={
            "error": "No cached links available",
            "failingSource": "fixtures",
            "reasons": errors,
        },
    )


def _atomic_write(path: Path, contents: str) -> None:
    """Readers see either the old file or a complete replacement."""
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(contents)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _write_snapshot(events: list[dict[str, Any]], *, last_ingest_at: str | None) -> None:
    """Best-effort last-good write after a successful MART read."""
    try:
        SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        _atomic_write(EVENTS_SNAPSHOT,
            json.dumps(events, indent=2, ensure_ascii=False) + "\n",
        )
        meta = {
            **_read_snapshot_meta(),
            "lastIngestAt": last_ingest_at,
            "savedAt": _now_iso(),
            "eventCount": len(events),
        }
        _atomic_write(SNAPSHOT_META, json.dumps(meta, indent=2) + "\n")
        _remember_last_ingest(last_ingest_at)
    except OSError:
        pass


def _force_fixtures(fixture_flag: bool) -> bool:
    return fixture_flag or not database_configured()


def _source_status(*, database: str) -> dict[str, str]:
    return {"usgs": "ok", "firms": "ok", "database": database}


def _parse_iso(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("timezone required")
        return parsed
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="start/end must be ISO-8601 timestamps with a timezone") from exc


def _event_time(event: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(event["occurredAt"].replace("Z", "+00:00"))


def _filtered_events(
    events: list[dict[str, Any]],
    *,
    types: str | None,
    start: datetime | None,
    end: datetime | None,
    min_significance: float,
) -> list[dict[str, Any]]:
    layer_ids = {part.strip() for part in types.split(",") if part.strip()} if types else None

    out: list[dict[str, Any]] = []
    for event in events:
        if layer_ids and event["layerId"] not in layer_ids:
            continue
        if float(event["significance"]) < min_significance:
            continue
        occurred = _event_time(event)
        if start and occurred < start:
            continue
        if end and occurred >= end:
            continue
        out.append(event)
    return out


def _page_events(events: list[dict[str, Any]], limit: int, cursor: str | None) -> tuple[list[dict[str, Any]], str | None]:
    # Bind an offset to the actual result set so a refresh cannot silently skip
    # or duplicate events halfway through paging. Restart on a 409 response.
    fingerprint = hashlib.sha256(json.dumps(events, sort_keys=True).encode()).hexdigest()
    offset = 0
    if cursor is not None:
        try:
            if len(cursor) > 512:
                raise ValueError("cursor too long")
            data = json.loads(base64.b64decode(cursor, altchars=b"-_", validate=True))
            offset = data["offset"]
            if type(offset) is not int or offset < 0 or not isinstance(data["fingerprint"], str):
                raise ValueError("invalid cursor payload")
        except (ValueError, KeyError, TypeError, UnicodeError) as exc:
            raise HTTPException(422, detail="Invalid event cursor") from exc
        if data["fingerprint"] != fingerprint:
            raise HTTPException(409, detail="Events changed; restart pagination without a cursor")
    end = offset + limit
    next_cursor = None
    if end < len(events):
        next_cursor = base64.urlsafe_b64encode(json.dumps({"offset": end, "fingerprint": fingerprint}).encode()).decode()
    return events[offset:end], next_cursor


def _load_events_for_request(
    *,
    fixture_flag: bool,
) -> tuple[list[dict[str, Any]], dict[str, str], str | None]:
    """Fall back on failed reads; a successful empty dataset remains empty."""
    if _force_fixtures(fixture_flag):
        events, _label = _load_events_cache(prefer_snapshot=False)
        return events, _source_status(database="fixture"), None

    # Request limits apply after filters and must not truncate the shared cache.
    mart_events, ping = fetch_mart_events()
    last_ingest = _resolved_last_ingest(ping.last_ingest_at)

    if mart_events is not None:
        _write_snapshot(mart_events, last_ingest_at=last_ingest)
        return mart_events, _source_status(database="ok"), None

    try:
        events, label = _load_events_cache(prefer_snapshot=True)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}
        detail = {
            **detail,
            "failingSource": "database",
            "databaseStatus": ping.status,
            "databaseDetail": ping.detail,
        }
        raise HTTPException(status_code=503, detail=detail) from exc

    database_status = ping.status if ping.status in {"dark", "error"} else "dark"
    detail = ping.detail or f"Serving {label} after TigerData {database_status}"
    return events, _source_status(database=database_status), detail


@app.get("/health")
def health() -> dict[str, Any]:
    """Database ping + last ingest. SELECT 1 runs when DATABASE_URL is set."""
    ping = ping_and_warmup(fetch_last_ingest=True)
    data_source = "warehouse"
    if ping.status == "ok":
        rows, read_ping = fetch_mart_events(ping=ping)
        if rows is None:
            ping = read_ping
        else:
            try:
                _validate_rows(rows, "event")
            except ValueError as exc:
                ping = DatabasePing("error", ping.warehouse_ping, ping.last_ingest_at, str(exc), ping.warmup_ms)
    last_ingest = _resolved_last_ingest(ping.last_ingest_at)
    using_fixtures = ping.status == "fixture" or not database_configured()
    ok = ping.status in {"ok", "fixture"} or _cache_available()
    return {
        "ok": ok,
        "usingFixtures": using_fixtures or ping.status in {"dark", "error"},
        "database": ping.status,
        "warmupMs": ping.warmup_ms,
        "lastIngestAt": last_ingest,
        "detail": detail,
    }


@app.get("/events")
def list_events(
    types: str | None = None,
    start: str | None = None,
    end: str | None = None,
    minSignificance: float = 0,
    limit: int = Query(default=2000, ge=1, le=8000),
    cursor: str | None = None,
    fixture: int | None = None,
) -> dict[str, Any]:
    start_dt, end_dt = _parse_iso(start), _parse_iso(end)
    if start_dt is not None and end_dt is not None and start_dt > end_dt:
        raise HTTPException(status_code=422, detail="start must be before or equal to end")
    events, source_status, fallback_detail = _load_events_for_request(
        fixture_flag=fixture == 1,
    )
    filtered = _filtered_events(
        events,
        types=types,
        start=start_dt,
        end=end_dt,
        min_significance=minSignificance,
    )
    page, next_cursor = _page_events(filtered, limit, cursor)
    body: dict[str, Any] = {
        "generatedAt": _now_iso(),
        "sourceStatus": source_status,
        "events": page,
        "nextCursor": next_cursor,
    }
    if fallback_detail:
        body["fallbackDetail"] = fallback_detail
    return body


@app.get("/events/{event_id}/links")
def get_event_links(event_id: str, fixture: int | None = None) -> list[dict[str, Any]]:
    events, _status, _detail = _load_events_for_request(
        fixture_flag=fixture == 1,
    )
    ids = {event["id"] for event in events}
    if event_id not in ids:
        raise HTTPException(status_code=404, detail=f"event not found: {event_id}")
    if not _force_fixtures(fixture == 1):
        stored = fetch_links_for_event(event_id)
        if stored is not None:
            return stored
    links, _ = _load_links_cache(prefer_snapshot=not _force_fixtures(fixture == 1))
    return [
        link
        for link in links
        if link["sourceId"] == event_id or link["targetId"] == event_id
    ]


@app.get("/events/{event_id}")
def get_event(event_id: str, fixture: int | None = None) -> dict[str, Any]:
    events, _status, _detail = _load_events_for_request(
        fixture_flag=fixture == 1,
    )
    for event in events:
        if event["id"] == event_id:
            return event
    raise HTTPException(status_code=404, detail=f"event not found: {event_id}")


def _extract_ingest_secret(
    authorization: str | None,
    x_ingest_secret: str | None,
) -> str | None:
    if x_ingest_secret and x_ingest_secret.strip():
        return x_ingest_secret.strip()
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        return token or None
    return None


@app.post("/ingest/run")
def ingest_run(
    authorization: str | None = Header(default=None),
    x_ingest_secret: str | None = Header(default=None, alias="X-Ingest-Secret"),
) -> dict[str, Any]:
    """Run USGS, GDACS, and optional FIRMS ingest when INGEST_SECRET matches."""
    expected = os.environ.get("INGEST_SECRET", "").strip()
    provided = _extract_ingest_secret(authorization, x_ingest_secret)
    authorized = (
        bool(provided)
        and bool(expected)
        and secrets.compare_digest(provided.encode(), expected.encode())
    )
    if not authorized:
        raise HTTPException(status_code=401, detail="Unauthorized: valid INGEST_SECRET required")

    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    from jobs.ingest.run import run_ingest

    result = run_ingest()
    if result.get("ok"):
        _remember_last_ingest(_now_iso())
    result["lastIngestAt"] = _resolved_last_ingest(None)
    return result
