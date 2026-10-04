"""TigerData/PostgreSQL reads with bounded connection/query waits and safe errors."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

_COLUMN_ALIASES = {
    "ID": "id",
    "SOURCE": "source",
    "SOURCE_URL": "sourceUrl",
    "SOURCEURL": "sourceUrl",
    "IMAGE_URL": "imageUrl",
    "IMAGEURL": "imageUrl",
    "LAYER_ID": "layerId",
    "LAYERID": "layerId",
    "SUBTYPE": "subtype",
    "TITLE": "title",
    "SUMMARY": "summary",
    "OCCURRED_AT": "occurredAt",
    "OCCURREDAT": "occurredAt",
    "UPDATED_AT": "updatedAt",
    "UPDATEDAT": "updatedAt",
    "ENDED_AT": "endedAt",
    "ENDEDAT": "endedAt",
    "LNG": "lng",
    "LAT": "lat",
    "ALT_M": "altM",
    "ALTM": "altM",
    "GEO_PRECISION": "geoPrecision",
    "GEOPRECISION": "geoPrecision",
    "GEO_SOURCE": "geoSource",
    "GEOSOURCE": "geoSource",
    "WEIGHT": "weight",
    "SIGNIFICANCE": "significance",
    "COUNTRY_ISO3": "countryIso3",
    "COUNTRYISO3": "countryIso3",
    "KEYWORDS": "keywords",
    "ENTITIES": "entities",
    "RAW_REF": "rawRef",
    "RAWREF": "rawRef",
    "TAGS": "tags",
    "ATTRIBUTES": "attributes",
    "CITATIONS": "citations",
    "SOURCE_ID": "sourceId",
    "SOURCEID": "sourceId",
    "TARGET_ID": "targetId",
    "TARGETID": "targetId",
    "RELATION": "relation",
    "CONFIDENCE": "confidence",
    "RATIONALE": "rationale",
    "MODEL": "model",
}


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


def _row_to_event(columns: list[str], row: tuple[Any, ...]) -> dict[str, Any]:
    event: dict[str, Any] = {}
    for name, value in zip(columns, row, strict=True):
        key = _COLUMN_ALIASES.get(name.upper(), name)
        if isinstance(value, datetime):
            value = _iso_z(value)
        elif isinstance(value, Decimal):
            value = float(value)
        elif key in ("entities", "keywords", "tags", "attributes", "citations") and isinstance(value, str):
            value = json.loads(value)
        event[key] = value
    return event


@dataclass
class DatabasePing:
    status: str
    warehouse_ping: str
    last_ingest_at: str | None
    detail: str | None = None
    warmup_ms: int | None = None


def database_configured() -> bool:
    return bool(os.environ.get("DATABASE_URL", "").strip())


def _import_connector():
    import psycopg
    return psycopg


def _connect():
    # Tiger Cloud uses TLS. Never include the URL or driver exception in API output.
    return _import_connector().connect(
        os.environ["DATABASE_URL"].strip(),
        sslmode="require", connect_timeout=5,
        options="-c statement_timeout=10000", autocommit=True,
    )


def ping_and_warmup(*, fetch_last_ingest: bool = True) -> DatabasePing:
    if not database_configured():
        return DatabasePing("fixture", "skipped", None, "DATABASE_URL unset; fixture mode")
    started = time.perf_counter()
    try:
        connection = _connect()
    except Exception:
        return DatabasePing("dark", "dark", None, "TigerData connection failed; check server configuration")
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
            last_ingest = None
            detail = None
            if fetch_last_ingest:
                try:
                    cursor.execute("SELECT MAX(pulled_at) FROM raw.ingest_batch")
                    row = cursor.fetchone()
                    last_ingest = _iso_z(row[0] if row else None)
                except Exception:
                    detail = "TigerData reachable; ingest metadata unavailable"
            return DatabasePing("ok", "ok", last_ingest, detail, int((time.perf_counter() - started) * 1000))
    except Exception:
        return DatabasePing("dark", "dark", None, "TigerData health query failed")
    finally:
        connection.close()


def fetch_mart_events(*, limit: int | None = None, ping: DatabasePing | None = None) -> tuple[list[dict[str, Any]] | None, DatabasePing]:
    return _fetch_mart("event", limit=limit, ping=ping)


def fetch_mart_links() -> tuple[list[dict[str, Any]] | None, DatabasePing]:
    return _fetch_mart("event_link")


def _fetch_mart(table: str, *, limit: int | None = None, ping: DatabasePing | None = None) -> tuple[list[dict[str, Any]] | None, DatabasePing]:
    if table not in {"event", "event_link"}:
        raise ValueError("Unsupported MART table")
    ping = ping or ping_and_warmup()
    if ping.status != "ok":
        return None, ping
    try:
        connection = _connect()
    except Exception:
        return None, DatabasePing("dark", "dark", ping.last_ingest_at, "TigerData connection failed")
    try:
        with connection.cursor() as cursor:
            # Stable ordering is required by offset pagination. Identifiers are
            # fixed internal values; a request cannot supply table names or SQL.
            query = f"SELECT * FROM mart.{table} ORDER BY id"
            if limit is None:
                cursor.execute(query)
            else:
                cursor.execute(query + " LIMIT %s", (limit,))
            columns = [column[0] for column in cursor.description]
            return [_row_to_event(columns, row) for row in cursor.fetchall()], ping
    except Exception:
        return None, DatabasePing("error", "ok", ping.last_ingest_at, f"TigerData mart.{table} read failed", ping.warmup_ms)
    finally:
        connection.close()
