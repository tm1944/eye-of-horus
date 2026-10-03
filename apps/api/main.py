"""Hypothesis Globe FastAPI — health, sourceStatus, fixture fallback (issue #9)."""

from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from snowflake_client import (
    fetch_mart_events,
    ping_and_warmup,
    snowflake_account_set,
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

# In-process last-known ingest time (updated by health ping / ingest stub).
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
    except (OSError, json.JSONDecodeError):
        return {}


def _remember_last_ingest(value: str | None) -> str | None:
    global _last_ingest_at
    if value:
        _last_ingest_at = value
    return _last_ingest_at


def _resolved_last_ingest(ping_value: str | None = None) -> str | None:
    if ping_value:
        return _remember_last_ingest(ping_value)
    if _last_ingest_at:
        return _last_ingest_at
    meta = _read_snapshot_meta()
    stored = meta.get("lastIngestAt")
    return stored if isinstance(stored, str) and stored else None


def _load_json_array(path: Path, label: str) -> list[dict[str, Any]]:
    data = _load_json(path)
    if not isinstance(data, list):
        raise ValueError(f"{label} is not a JSON array ({path})")
    return data


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
            return _load_json_array(path, label), label
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
            return _load_json_array(path, label), label
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


def _write_snapshot(events: list[dict[str, Any]], *, last_ingest_at: str | None) -> None:
    """Best-effort last-good write after a successful MART read."""
    try:
        SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        EVENTS_SNAPSHOT.write_text(
            json.dumps(events, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        if LINKS_FIXTURE.is_file() and not LINKS_SNAPSHOT.is_file():
            LINKS_SNAPSHOT.write_text(LINKS_FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
        meta = {
            "lastIngestAt": last_ingest_at,
            "savedAt": _now_iso(),
            "eventCount": len(events),
        }
        SNAPSHOT_META.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        _remember_last_ingest(last_ingest_at)
    except OSError:
        pass


def _force_fixtures(fixture_flag: bool) -> bool:
    return fixture_flag or not snowflake_account_set()


def _source_status(*, snowflake: str) -> dict[str, str]:
    # Sensor rows in fixtures/snapshots are treated as healthy weekend feeds.
    # Track B will flip these to error/dark when live ingest reports failures.
    return {"usgs": "ok", "firms": "ok", "snowflake": snowflake}


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _event_time(event: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(event["occurredAt"].replace("Z", "+00:00"))


def _filtered_events(
    events: list[dict[str, Any]],
    *,
    types: str | None,
    start: str | None,
    end: str | None,
    min_significance: float,
    limit: int,
) -> list[dict[str, Any]]:
    layer_ids = {part.strip() for part in types.split(",") if part.strip()} if types else None
    start_dt = _parse_iso(start)
    end_dt = _parse_iso(end)

    out: list[dict[str, Any]] = []
    for event in events:
        if layer_ids and event["layerId"] not in layer_ids:
            continue
        if float(event["significance"]) < min_significance:
            continue
        occurred = _event_time(event)
        if start_dt and occurred < start_dt:
            continue
        if end_dt and occurred >= end_dt:
            continue
        out.append(event)
        if len(out) >= limit:
            break
    return out


def _load_events_for_request(
    *,
    fixture_flag: bool,
    limit: int,
) -> tuple[list[dict[str, Any]], dict[str, str], str | None]:
    """Return (events, sourceStatus, fallbackDetail). Never blanks the globe when cache exists."""
    if _force_fixtures(fixture_flag):
        events, _label = _load_events_cache(prefer_snapshot=False)
        return events, _source_status(snowflake="fixture"), None

    mart_events, ping = fetch_mart_events(limit=limit)
    last_ingest = _resolved_last_ingest(ping.last_ingest_at)

    if mart_events is not None:
        _write_snapshot(mart_events, last_ingest_at=last_ingest)
        return mart_events, _source_status(snowflake="ok"), None

    # Snowflake dark / error / misconfigured → last good snapshot or fixtures.
    try:
        events, label = _load_events_cache(prefer_snapshot=True)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}
        detail = {
            **detail,
            "failingSource": "snowflake",
            "snowflakeStatus": ping.status,
            "snowflakeDetail": ping.detail,
        }
        raise HTTPException(status_code=503, detail=detail) from exc

    snowflake_status = ping.status if ping.status in {"dark", "error"} else "dark"
    detail = ping.detail or f"Serving {label} after Snowflake {snowflake_status}"
    return events, _source_status(snowflake=snowflake_status), detail


@app.get("/health")
def health() -> dict[str, Any]:
    """Warehouse ping + last ingest. Call before the pitch to warm SELECT 1."""
    ping = ping_and_warmup(fetch_last_ingest=True)
    last_ingest = _resolved_last_ingest(ping.last_ingest_at)
    using_fixtures = ping.status == "fixture" or not snowflake_account_set()
    ok = ping.status in {"ok", "fixture"} or _cache_available()
    return {
        "ok": ok,
        "usingFixtures": using_fixtures or ping.status in {"dark", "error"},
        "snowflake": ping.status,
        "warehousePing": ping.warehouse_ping,
        "warmupMs": ping.warmup_ms,
        "lastIngestAt": last_ingest,
        "detail": ping.detail,
    }


def _cache_available() -> bool:
    return EVENTS_SNAPSHOT.is_file() or EVENTS_FIXTURE.is_file()


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
    del cursor  # Opaque cursor reserved; fixtures fit in one page.
    events, source_status, fallback_detail = _load_events_for_request(
        fixture_flag=fixture == 1,
        limit=limit,
    )
    filtered = _filtered_events(
        events,
        types=types,
        start=start,
        end=end,
        min_significance=minSignificance,
        limit=limit,
    )
    body: dict[str, Any] = {
        "generatedAt": _now_iso(),
        "sourceStatus": source_status,
        "events": filtered,
        "nextCursor": None,
    }
    if fallback_detail:
        body["fallbackDetail"] = fallback_detail
    return body


@app.get("/events/{event_id}/links")
def get_event_links(event_id: str, fixture: int | None = None) -> list[dict[str, Any]]:
    events, _status, _detail = _load_events_for_request(
        fixture_flag=fixture == 1,
        limit=8000,
    )
    ids = {event["id"] for event in events}
    if event_id not in ids:
        raise HTTPException(status_code=404, detail=f"event not found: {event_id}")
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
        limit=8000,
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
    """Protected stub. Track B owns live USGS/FIRMS loaders; this PR only gates auth."""
    expected = os.environ.get("INGEST_SECRET", "").strip()
    provided = _extract_ingest_secret(authorization, x_ingest_secret)
    authorized = (
        bool(provided)
        and bool(expected)
        and len(provided) == len(expected)
        and secrets.compare_digest(provided, expected)
    )
    if not authorized:
        raise HTTPException(status_code=401, detail="Unauthorized: valid INGEST_SECRET required")

    # No-op until track B loaders land. Do not click during the pitch.
    return {
        "ok": True,
        "status": "noop",
        "detail": (
            "Ingest loaders are not wired in this API slice (track B). "
            "Auth accepted; no USGS/FIRMS job started."
        ),
        "lastIngestAt": _resolved_last_ingest(None),
    }
