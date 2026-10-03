"""FastAPI GET /events from fixtures. No Snowflake or Gemini in this slice."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

REPO_ROOT = Path(__file__).resolve().parents[2]
EVENTS_PATH = REPO_ROOT / "data" / "fixtures" / "events.json"
LINKS_PATH = REPO_ROOT / "data" / "fixtures" / "links.json"

DEFAULT_VITE_ORIGIN = "http://127.0.0.1:43123"


def _cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGIN") or os.environ.get("VITE_ORIGIN") or DEFAULT_VITE_ORIGIN
    origins = [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]
    # Local Vite often uses either host form; keep both when using the default.
    if DEFAULT_VITE_ORIGIN in origins and "http://localhost:43123" not in origins:
        origins.append("http://localhost:43123")
    return list(dict.fromkeys(origins))


app = FastAPI(title="Hypothesis Globe API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _use_fixtures(fixture_flag: bool) -> bool:
    if fixture_flag:
        return True
    return not os.environ.get("SNOWFLAKE_ACCOUNT")


def _require_fixtures(fixture: int | None) -> None:
    if _use_fixtures(fixture == 1):
        return
    raise HTTPException(
        status_code=501,
        detail=(
            "Snowflake MART is not wired yet. "
            "Unset SNOWFLAKE_ACCOUNT or pass ?fixture=1 to read data/fixtures."
        ),
    )


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _event_time(event: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(event["occurredAt"].replace("Z", "+00:00"))


def _source_status(*, using_fixtures: bool) -> dict[str, str]:
    if using_fixtures:
        return {"usgs": "ok", "firms": "ok", "snowflake": "fixture"}
    return {"usgs": "ok", "firms": "ok", "snowflake": "ok"}


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


@app.get("/health")
def health() -> dict[str, Any]:
    using_fixtures = _use_fixtures(False)
    return {
        "ok": True,
        "usingFixtures": using_fixtures,
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
    del cursor  # Opaque cursor reserved; fixtures fit in one page.
    _require_fixtures(fixture)
    events = _filtered_events(
        _load_json(EVENTS_PATH),
        types=types,
        start=start,
        end=end,
        min_significance=minSignificance,
        limit=limit,
    )
    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sourceStatus": _source_status(using_fixtures=True),
        "events": events,
        "nextCursor": None,
    }


@app.get("/events/{event_id}/links")
def get_event_links(event_id: str, fixture: int | None = None) -> list[dict[str, Any]]:
    _require_fixtures(fixture)
    events = {event["id"]: event for event in _load_json(EVENTS_PATH)}
    if event_id not in events:
        raise HTTPException(status_code=404, detail=f"event not found: {event_id}")
    return [
        link
        for link in _load_json(LINKS_PATH)
        if link["sourceId"] == event_id or link["targetId"] == event_id
    ]


@app.get("/events/{event_id}")
def get_event(event_id: str, fixture: int | None = None) -> dict[str, Any]:
    _require_fixtures(fixture)
    for event in _load_json(EVENTS_PATH):
        if event["id"] == event_id:
            return event
    raise HTTPException(status_code=404, detail=f"event not found: {event_id}")
