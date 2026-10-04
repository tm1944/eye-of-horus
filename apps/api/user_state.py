"""
The demo user's profile: a local JSON file (no accounts, nothing stored in TigerData).

State functions take a profile dict and return an updated copy; reading and writing the file
is separate, so the rules are easy to test.
"""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_INTERACTIONS = 500
VIEWS = ("headlines", "explore", "feed")


def empty() -> dict[str, Any]:
    return {"version": 1, "onboardedAt": None, "interests": [], "readingList": [], "feedback": {}, "interactions": []}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path: Path) -> dict[str, Any]:
    """The saved profile, or a fresh one if the file is missing or unreadable."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return empty()
    if not isinstance(data, dict):
        return empty()
    return {**empty(), **{key: value for key, value in data.items() if key in empty()}}


def save(path: Path, state: dict[str, Any]) -> None:
    """Atomic: readers see the old file or the complete new one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
        handle.write(json.dumps(state, indent=2) + "\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def set_interests(state: dict[str, Any], interests: list[str], at: str) -> dict[str, Any]:
    unique = list(dict.fromkeys(interests))
    return {**state, "interests": unique, "onboardedAt": state.get("onboardedAt") or at}


def set_saved(state: dict[str, Any], event_id: str, saved: bool, view: str | None, at: str) -> dict[str, Any]:
    items = [item for item in state.get("readingList") or [] if item["eventId"] != event_id]
    if saved:
        existing = next((item for item in state.get("readingList") or [] if item["eventId"] == event_id), None)
        items.append(existing or {"eventId": event_id, "addedAt": at, "view": view})
    return {**state, "readingList": items}


def set_feedback(state: dict[str, Any], event_id: str, value: str | None, view: str | None, at: str) -> dict[str, Any]:
    feedback = {key: item for key, item in (state.get("feedback") or {}).items() if key != event_id}
    if value in ("more", "less"):
        feedback[event_id] = {"value": value, "at": at, "view": view}
    return {**state, "feedback": feedback}


def add_interaction(state: dict[str, Any], event_id: str, kind: str, view: str | None, at: str) -> dict[str, Any]:
    interactions = [*(state.get("interactions") or []), {"eventId": event_id, "kind": kind, "view": view, "at": at}]
    return {**state, "interactions": interactions[-MAX_INTERACTIONS:]}


def public(state: dict[str, Any]) -> dict[str, Any]:
    """What the frontend needs: onboarding status, picks, and per-item save/feedback state."""
    return {
        "onboarded": bool(state.get("onboardedAt")),
        "interests": state.get("interests") or [],
        "readingList": [item["eventId"] for item in state.get("readingList") or []],
        "feedback": {key: item["value"] for key, item in (state.get("feedback") or {}).items()},
    }
