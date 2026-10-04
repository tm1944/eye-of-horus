"""Hypothesis Globe FastAPI — health, sourceStatus, fixture fallback (issue #9)."""

from __future__ import annotations

import json
import base64
import hashlib
import os
import secrets
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import threading
import time
from typing import Literal

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

import taste
import user_state
from fastapi.middleware.cors import CORSMiddleware
from jsonschema import Draft202012Validator, FormatChecker
from ingest_runner import run_ingest

from db import (
    fetch_mart_events,
    fetch_mart_links,
    ping_and_warmup,
    database_configured,
    load_repo_env,
    DatabasePing,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "data" / "fixtures"
SNAPSHOTS_DIR = REPO_ROOT / "data" / "snapshots"
# API-shaped (mart.event) fixtures. data/fixtures/events.json is the news
# pipeline's staging file (run_ingest.py → tigerdata/upload.py), not API data.
EVENTS_FIXTURE = FIXTURES_DIR / "api_events.json"
LINKS_FIXTURE = FIXTURES_DIR / "api_links.json"
EVENTS_SNAPSHOT = SNAPSHOTS_DIR / "events.json"
LINKS_SNAPSHOT = SNAPSHOTS_DIR / "links.json"
SNAPSHOT_META = SNAPSHOTS_DIR / "meta.json"
# My Feed (demo): one local profile file, the interest catalogue, and cached embeddings.
USER_STATE = REPO_ROOT / "data" / "users" / "demo.json"
INTERESTS = REPO_ROOT / "data" / "interests.json"
EMBEDDINGS = REPO_ROOT / "data" / "cache" / "embeddings.json"

DEFAULT_VITE_ORIGIN = "http://127.0.0.1:43123"
_SCHEMA_DIR = REPO_ROOT / "packages" / "schema"
_VALIDATORS = {
    name: Draft202012Validator(
        json.loads((_SCHEMA_DIR / f"{name}.schema.json").read_text()),
        format_checker=FormatChecker(),
    )
    for name in ("event", "link")
}

load_repo_env()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from jobs.llm.personalize import get_feed, get_globe_pins

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


def _source_status(*, database: str, data_source: str) -> dict[str, str]:
    # Warehouse availability does not prove the sensors ingested successfully.
    sensor_status = "fixture" if data_source == "fixture" else "unknown"
    status = {"usgs": sensor_status, "firms": sensor_status, "database": database}
    if data_source != "fixture":
        stored = _read_snapshot_meta().get("sourceStatus", {})
        if isinstance(stored, dict):
            for source in ("usgs", "firms"):
                value = stored.get(source)
                if isinstance(value, str) and value in {"ok", "error", "dark", "unknown"}:
                    status[source] = value
    return status


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
        events, label = _load_events_cache(prefer_snapshot=False)
        return events, _source_status(database="fixture", data_source=label), None

    # Request limits apply after filters and must not truncate the shared cache.
    mart_events, ping = fetch_mart_events()
    last_ingest = _resolved_last_ingest(ping.last_ingest_at)

    if mart_events is not None:
        try:
            _validate_rows(mart_events, "event")
        except ValueError as exc:
            ping = DatabasePing("error", ping.last_ingest_at, str(exc))
        else:
            _write_snapshot(mart_events, last_ingest_at=last_ingest)
            return mart_events, _source_status(database="ok", data_source="warehouse"), None

    # TigerData dark / error / misconfigured → last good snapshot or fixtures.
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
    return events, _source_status(database=database_status, data_source=label), detail


@app.get("/health")
def health() -> dict[str, Any]:
    """Warehouse ping + last ingest. Call before the pitch to warm SELECT 1."""
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
                ping = DatabasePing("error", ping.last_ingest_at, str(exc), ping.warmup_ms)
    last_ingest = _resolved_last_ingest(ping.last_ingest_at)
    ok = ping.status == "ok"
    detail = ping.detail
    if ping.status != "ok":
        try:
            _, data_source = _load_events_cache(prefer_snapshot=ping.status != "fixture")
            ok = True
        except HTTPException:
            data_source = "unavailable"
            detail = f"{detail or 'Warehouse unavailable'}; no readable event cache"
    return {
        "ok": ok,
        "usingFixtures": data_source == "fixture",
        "dataSource": data_source,
        "sourceStatus": _source_status(database=ping.status, data_source=data_source),
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


def _load_links_for_request(*, fixture_flag: bool, live: bool) -> list[dict[str, Any]]:
    """Read every link, caching good live reads; fall back to snapshot or fixtures."""
    links = None
    link_ping = None
    if not _force_fixtures(fixture_flag) and live:
        links, link_ping = fetch_mart_links()
        if links is not None:
            try:
                _validate_rows(links, "link")
            except ValueError:
                links = None
            else:
                try:
                    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
                    _atomic_write(LINKS_SNAPSHOT, json.dumps(links, indent=2) + "\n")
                except OSError:
                    pass
    if links is None:
        try:
            links, _ = _load_links_cache(prefer_snapshot=not _force_fixtures(fixture_flag))
        except HTTPException as exc:
            if link_ping is not None:
                raise HTTPException(503, detail={
                    "failingSource": "database", "error": "No usable links or link cache",
                }) from exc
            raise
    return links


@app.get("/links")
def list_links(fixture: int | None = None) -> list[dict[str, Any]]:
    """Every link in one read, so the globe can draw arcs without a request per event."""
    return _load_links_for_request(fixture_flag=fixture == 1, live=True)


@app.get("/events/{event_id}/links")
def get_event_links(event_id: str, fixture: int | None = None) -> list[dict[str, Any]]:
    events, _status, _detail = _load_events_for_request(
        fixture_flag=fixture == 1,
    )
    ids = {event["id"] for event in events}
    if event_id not in ids:
        raise HTTPException(status_code=404, detail=f"event not found: {event_id}")
    links = _load_links_for_request(fixture_flag=fixture == 1, live=_status["database"] == "ok")
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
    """Run the configured Track B loader after authenticating the request."""
    expected = os.environ.get("INGEST_SECRET", "").strip()
    provided = _extract_ingest_secret(authorization, x_ingest_secret)
    authorized = (
        bool(provided)
        and bool(expected)
        and secrets.compare_digest(provided.encode(), expected.encode())
    )
    if not authorized:
        raise HTTPException(status_code=401, detail="Unauthorized: valid INGEST_SECRET required")

    default_command = [sys.executable, "-m", "jobs.ingest"] if database_configured() else None
    run_ingest(REPO_ROOT, default_command=default_command)
    if database_configured():
        _remember_last_ingest(ping_and_warmup(fetch_last_ingest=True).last_ingest_at)
    return {
        "ok": True,
        "status": "completed",
        "lastIngestAt": _resolved_last_ingest(None),
    }


def _feed_selection(
    types: str | None = Query(default=None, max_length=500),
    keywords: list[str] = Query(default=[], max_length=20),
    lat: float | None = Query(default=None, ge=-90, le=90, allow_inf_nan=False),
    lng: float | None = Query(default=None, ge=-180, le=180, allow_inf_nan=False),
    minSignificance: float = Query(default=0, ge=0, le=100, allow_inf_nan=False),
    start: str | None = None,
    end: str | None = None,
    fixture: int = Query(default=0, ge=0, le=1),
) -> dict[str, Any]:
    if (lat is None) != (lng is None):
        raise HTTPException(422, detail="lat and lng must be supplied together")
    if any(not keyword.strip() or len(keyword) > 100 for keyword in keywords):
        raise HTTPException(422, detail="Each keyword must contain 1–100 characters")
    known_layers = _VALIDATORS["event"].schema["properties"]["layerId"]["enum"]
    layers = known_layers if types is None else [part.strip() for part in types.split(",") if part.strip()]
    if any(layer not in known_layers for layer in layers):
        raise HTTPException(422, detail="Unknown event type")
    start_dt, end_dt = _parse_iso(start), _parse_iso(end)
    if start_dt is not None and end_dt is not None and start_dt > end_dt:
        raise HTTPException(422, detail="start must be before or equal to end")
    return {
        "config": {"layers": layers, "keywords": [keyword.strip() for keyword in keywords],
                   "coordinates": [] if lat is None else [{"lat": lat, "lng": lng}],
                   "significanceFloor": minSignificance},
        "start": start_dt, "end": end_dt, "fixture": fixture == 1,
    }


def _ranked_response(selection: dict[str, Any], n: int, spread: float | None = None) -> dict[str, Any]:
    events, source_status, fallback_detail = _load_events_for_request(fixture_flag=selection["fixture"])
    config = selection["config"]
    candidates = _filtered_events(events, types=None, start=selection["start"], end=selection["end"],
                                  min_significance=config["significanceFloor"])
    candidates = [event for event in candidates if event["layerId"] in config["layers"]]
    ranked = (get_feed(n=n, config=config, events=candidates) if spread is None else
              get_globe_pins(n=n, spread_degrees=spread, config=config, events=candidates))
    body = {"generatedAt": _now_iso(), "sourceStatus": source_status,
            "events": ranked, "nextCursor": None}
    if fallback_detail:
        body["fallbackDetail"] = fallback_detail
    return body


@app.get("/feed")
def feed(n: int = Query(default=100, ge=1, le=1000), selection: dict = Depends(_feed_selection)):
    """Rank events using selections supplied only for this request."""
    return _ranked_response(selection, n)


@app.get("/feed/pins")
def feed_pins(
    n: int = Query(default=10, ge=1, le=100),
    spreadDegrees: float = Query(default=30, ge=0, le=180, allow_inf_nan=False),
    selection: dict = Depends(_feed_selection),
):
    """Return up to n ranked events with the requested angular separation."""
    return _ranked_response(selection, n, spreadDegrees)


# ---------------------------------------------------------------------------
# MY FEED (demo) — a single local profile; see apps/api/taste.py and user_state.py.
# ---------------------------------------------------------------------------

_state_lock = threading.Lock()
_cache: dict[str, tuple[float, Any]] = {}
FEED_CACHE_SECONDS = 30  # events and links change on ingest, not between clicks


def _cached(key: str, ttl: float, load):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    value = load()
    _cache[key] = (time.monotonic(), value)
    return value


def _catalogue() -> list[dict[str, Any]]:
    return _cached("interests", 3600, lambda: json.loads(INTERESTS.read_text(encoding="utf-8"))["interests"])


def _embeddings() -> dict[str, np.ndarray]:
    """Unit vectors keyed by event id and `interest:<id>`; reloaded when the file changes."""
    try:
        stamp = EMBEDDINGS.stat().st_mtime
    except OSError:
        return {}
    hit = _cache.get("embeddings")
    if hit and hit[0] == stamp:
        return hit[1]
    raw = json.loads(EMBEDDINGS.read_text(encoding="utf-8")).get("vectors", {})
    vectors = {}
    for key, values in raw.items():
        vector = np.asarray(values, dtype=np.float32)
        norm = float(np.linalg.norm(vector))
        if norm > 0:
            vectors[key] = vector / norm
    _cache["embeddings"] = (stamp, vectors)
    return vectors


def _feed_events() -> list[dict[str, Any]]:
    return _cached("events", FEED_CACHE_SECONDS, lambda: _load_events_for_request(fixture_flag=False)[0])


def _same_event_pairs() -> list[tuple[str, str]]:
    def load():
        try:
            links = _load_links_for_request(fixture_flag=False, live=True)
        except HTTPException:
            return []
        return [(link["sourceId"], link["targetId"]) for link in links if link.get("relation") in ("same-event", "same_event")]
    return _cached("same-event", FEED_CACHE_SECONDS, load)


def _update_state(change) -> dict[str, Any]:
    with _state_lock:
        state = change(user_state.load(USER_STATE))
        user_state.save(USER_STATE, state)
    return user_state.public(state)


View = Literal["headlines", "explore", "feed"]


class InterestsBody(BaseModel):
    interests: list[str] = Field(min_length=1, max_length=40)


class ViewBody(BaseModel):
    view: View | None = None


class FeedbackBody(BaseModel):
    value: Literal["more", "less"] | None
    view: View | None = None


class InteractionBody(BaseModel):
    eventId: str = Field(min_length=1, max_length=300)
    kind: Literal["open", "source"]
    view: View | None = None


@app.get("/interests")
def list_interests() -> dict[str, Any]:
    """The onboarding catalogue (seed text omitted: it only matters to the ranking)."""
    data = json.loads(INTERESTS.read_text(encoding="utf-8"))
    return {"groups": data["groups"], "interests": [{key: value for key, value in item.items() if key != "seed"} for item in data["interests"]]}


@app.get("/me")
def get_me() -> dict[str, Any]:
    return user_state.public(user_state.load(USER_STATE))


@app.delete("/me")
def reset_me() -> dict[str, Any]:
    """Start the demo over: forget interests, saves, feedback and history."""
    return _update_state(lambda _state: user_state.empty())


@app.put("/me/interests")
def put_interests(body: InterestsBody) -> dict[str, Any]:
    known = {item["id"] for item in _catalogue()}
    unknown = [interest for interest in body.interests if interest not in known]
    if unknown:
        raise HTTPException(422, detail=f"Unknown interests: {', '.join(unknown)}")
    return _update_state(lambda state: user_state.set_interests(state, body.interests, user_state.now_iso()))


# `:path` because some event ids contain URLs (conflict-csv:https://…/…); the server decodes
# %2F back to "/" before routing, so a plain {event_id} would never match them.
@app.post("/me/reading-list/{event_id:path}")
def save_item(event_id: str, body: ViewBody | None = None) -> dict[str, Any]:
    view = body.view if body else None
    return _update_state(lambda state: user_state.set_saved(state, event_id, True, view, user_state.now_iso()))


@app.delete("/me/reading-list/{event_id:path}")
def unsave_item(event_id: str) -> dict[str, Any]:
    return _update_state(lambda state: user_state.set_saved(state, event_id, False, None, user_state.now_iso()))


@app.put("/me/feedback/{event_id:path}")
def put_feedback(event_id: str, body: FeedbackBody) -> dict[str, Any]:
    return _update_state(lambda state: user_state.set_feedback(state, event_id, body.value, body.view, user_state.now_iso()))


@app.post("/me/interactions")
def post_interaction(body: InteractionBody) -> dict[str, bool]:
    _update_state(lambda state: user_state.add_interaction(state, body.eventId, body.kind, body.view, user_state.now_iso()))
    return {"ok": True}


@app.get("/me/feed")
def my_feed(n: int = Query(default=20, ge=1, le=100), savedOnly: int = Query(default=0, ge=0, le=1)) -> dict[str, Any]:
    """The demo user's feed (ranked by the taste vector), or their reading list."""
    state = user_state.load(USER_STATE)
    events = _feed_events()
    if savedOnly:
        ranked = taste.reading_list({event["id"]: event for event in events}, state)
    else:
        events = taste.feed_candidates(events)
        # Centre on the candidates, then fill any interest seed that is not embedded yet.
        vectors = _cached("seeded", FEED_CACHE_SECONDS, lambda: taste.with_seed_fallback(
            taste.centered(_embeddings(), {event["id"] for event in events}), _catalogue(), events))
        ranked = taste.rank_feed(events, state, _catalogue(), vectors, datetime.now(timezone.utc), n=n, same_event=_same_event_pairs())
    return {"generatedAt": _now_iso(), "events": ranked, "embeddings": bool(_embeddings())}
