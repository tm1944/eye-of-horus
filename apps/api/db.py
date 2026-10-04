"""TigerData (Postgres) access for health checks and event reads.

Fixture mode needs no DATABASE_URL. The connector imports only when a URL is set.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]

_EVENT_SQL = """
SELECT
  e.event_id AS id,
  e.source,
  e.info_url AS source_url,
  e.category AS layer_id,
  e.subtype,
  e.title,
  e.summary,
  e.occurred_at,
  e.updated_at,
  e.lng,
  e.lat,
  e.alt_m,
  e.geo_precision,
  e.geo_source,
  e.weight,
  e.significance,
  COALESCE(e.entities, '[]'::jsonb) AS entities,
  e.raw_ref,
  COALESCE(
    (
      SELECT jsonb_agg(t.tag ORDER BY t.tag)
      FROM mart.event_tag t
      WHERE t.event_id = e.event_id
    ),
    '[]'::jsonb
  ) AS tags,
  CASE e.category
    WHEN 'earthquake' THEN (to_jsonb(eq) - 'event_id' - 'footprint')
    WHEN 'wildfire' THEN (to_jsonb(wf) - 'event_id' - 'footprint')
    WHEN 'cyclone' THEN (to_jsonb(cy) - 'event_id' - 'footprint')
    WHEN 'flood' THEN (to_jsonb(fl) - 'event_id' - 'footprint')
    WHEN 'volcano' THEN (to_jsonb(vo) - 'event_id' - 'footprint')
    WHEN 'drought' THEN (to_jsonb(dr) - 'event_id' - 'footprint')
    ELSE '{}'::jsonb
  END AS attributes
FROM mart.event e
LEFT JOIN mart.earthquake eq ON eq.event_id = e.event_id
LEFT JOIN mart.wildfire wf ON wf.event_id = e.event_id
LEFT JOIN mart.cyclone cy ON cy.event_id = e.event_id
LEFT JOIN mart.flood fl ON fl.event_id = e.event_id
LEFT JOIN mart.volcano vo ON vo.event_id = e.event_id
LEFT JOIN mart.drought dr ON dr.event_id = e.event_id
"""


@dataclass
class DatabasePing:
    status: str  # ok | dark | error | fixture
    last_ingest_at: str | None
    detail: str | None = None
    warmup_ms: int | None = None


def load_repo_env() -> None:
    """Load repo-root .env without overriding variables already set in the process."""
    path = REPO_ROOT / ".env"
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def database_url() -> str:
    load_repo_env()
    return os.environ.get("DATABASE_URL", "").strip()


def database_configured() -> bool:
    return bool(database_url())


def _iso_z(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("+00:00"):
        text = text[:-6] + "Z"
    return text


def _connect():
    import psycopg

    return psycopg.connect(database_url(), connect_timeout=15)


def _json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _clean_attributes(value: Any) -> dict[str, Any]:
    data = _json_value(value) or {}
    if not isinstance(data, dict):
        return {}
    cleaned: dict[str, Any] = {}
    for key, item in data.items():
        if item is None or key == "event_id":
            continue
        if isinstance(item, datetime):
            item = _iso_z(item)
        cleaned[key] = item
    return cleaned


def _row_to_event(row: dict[str, Any]) -> dict[str, Any]:
    entities = _json_value(row.get("entities")) or []
    tags = _json_value(row.get("tags")) or []
    return {
        "id": row["id"],
        "source": row["source"],
        "sourceUrl": row.get("source_url"),
        "layerId": row["layer_id"],
        "subtype": row.get("subtype"),
        "title": row["title"],
        "summary": row.get("summary"),
        "occurredAt": _iso_z(row.get("occurred_at")),
        "updatedAt": _iso_z(row.get("updated_at")) or _iso_z(row.get("occurred_at")),
        "lng": row["lng"],
        "lat": row["lat"],
        "altM": row.get("alt_m"),
        "geoPrecision": row["geo_precision"],
        "geoSource": row["geo_source"],
        "weight": 0 if row.get("weight") is None else row.get("weight"),
        "significance": row["significance"],
        "entities": entities if isinstance(entities, list) else [],
        "rawRef": row.get("raw_ref"),
        "tags": tags if isinstance(tags, list) else [],
        "attributes": _clean_attributes(row.get("attributes")),
    }


def ping_and_warmup(*, fetch_last_ingest: bool = True) -> DatabasePing:
    if not database_configured():
        return DatabasePing(
            status="fixture",
            last_ingest_at=None,
            detail="DATABASE_URL unset; fixture mode",
        )

    started = time.perf_counter()
    try:
        conn = _connect()
    except Exception as exc:  # noqa: BLE001 — surface network and auth failures
        return DatabasePing(
            status="dark",
            last_ingest_at=None,
            detail=f"TigerData unreachable: {exc}",
        )

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
            warmup_ms = int((time.perf_counter() - started) * 1000)
            last_ingest_at = None
            if fetch_last_ingest:
                try:
                    cur.execute("SELECT MAX(pulled_at) FROM raw.ingest_batch")
                    row = cur.fetchone()
                    last_ingest_at = _iso_z(row[0] if row else None)
                except Exception:  # noqa: BLE001 — schema may not be applied yet
                    conn.rollback()
                    last_ingest_at = None
            return DatabasePing(
                status="ok",
                last_ingest_at=last_ingest_at,
                warmup_ms=warmup_ms,
            )
    except Exception as exc:  # noqa: BLE001
        return DatabasePing(
            status="dark",
            last_ingest_at=None,
            detail=f"TigerData warmup failed: {exc}",
            warmup_ms=int((time.perf_counter() - started) * 1000),
        )
    finally:
        conn.close()


def fetch_mart_events(*, limit: int = 8000) -> tuple[list[dict[str, Any]] | None, DatabasePing]:
    ping = ping_and_warmup(fetch_last_ingest=True)
    if ping.status != "ok":
        return None, ping

    try:
        conn = _connect()
    except Exception as exc:  # noqa: BLE001
        return None, DatabasePing(
            status="dark",
            last_ingest_at=ping.last_ingest_at,
            detail=f"TigerData unreachable on event read: {exc}",
            warmup_ms=ping.warmup_ms,
        )

    try:
        with conn.cursor() as cur:
            cur.execute(
                _EVENT_SQL + "\nORDER BY e.occurred_at DESC\nLIMIT %s",
                (int(limit),),
            )
            columns = [col.name for col in cur.description]
            events = [_row_to_event(dict(zip(columns, row, strict=True))) for row in cur.fetchall()]
            return events, ping
    except Exception as exc:  # noqa: BLE001
        return None, DatabasePing(
            status="error",
            last_ingest_at=ping.last_ingest_at,
            detail=f"mart.event unavailable: {exc}",
            warmup_ms=ping.warmup_ms,
        )
    finally:
        conn.close()


def fetch_links_for_event(event_id: str) -> list[dict[str, Any]] | None:
    """Return links touching event_id, or None when the database cannot be read."""
    if not database_configured():
        return None
    try:
        conn = _connect()
    except Exception:  # noqa: BLE001
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT link_id, source_id, target_id, relation, confidence,
                       rationale, citations, model
                FROM mart.event_link
                WHERE source_id = %s OR target_id = %s
                """,
                (event_id, event_id),
            )
            links = []
            for link_id, source_id, target_id, relation, confidence, rationale, citations, model in cur.fetchall():
                item = {
                    "id": link_id,
                    "sourceId": source_id,
                    "targetId": target_id,
                    "relation": relation,
                    "confidence": confidence,
                    "rationale": rationale or "",
                    "model": model or "",
                }
                parsed = _json_value(citations)
                if isinstance(parsed, list) and parsed:
                    item["citations"] = parsed
                links.append(item)
            return links
    except Exception:  # noqa: BLE001
        return None
    finally:
        conn.close()


def load_feed_events(layers: list[str], significance_floor: float) -> list[dict[str, Any]]:
    """Recent events for the personalisation job. Raises if the database is down."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                _EVENT_SQL
                + """
                WHERE e.category = ANY(%s)
                  AND e.significance >= %s
                  AND e.occurred_at >= NOW() - INTERVAL '7 days'
                ORDER BY e.occurred_at DESC
                LIMIT 5000
                """,
                (layers, significance_floor),
            )
            columns = [col.name for col in cur.description]
            return [_row_to_event(dict(zip(columns, row, strict=True))) for row in cur.fetchall()]
    finally:
        conn.close()


def write_event_links(links: list[dict[str, Any]]) -> None:
    conn = _connect()
    try:
        with conn.cursor() as cur:
            for link in links:
                cur.execute(
                    """
                    INSERT INTO mart.event_link
                      (link_id, source_id, target_id, relation, confidence, rationale, citations, model)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (link_id) DO NOTHING
                    """,
                    (
                        link["id"],
                        link["sourceId"],
                        link["targetId"],
                        link["relation"],
                        link["confidence"],
                        link.get("rationale"),
                        json.dumps(link.get("citations") or []),
                        link.get("model"),
                    ),
                )
        conn.commit()
    finally:
        conn.close()
