"""Optional Snowflake connector path for health warmup and MART reads.

Fixture mode needs zero Snowflake env and does not import the connector until
SNOWFLAKE_ACCOUNT is set. Pin: snowflake-connector-python==4.7.3.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any


SNOWFLAKE_ENV_REQUIRED = (
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_USER",
    "SNOWFLAKE_PASSWORD",
    "SNOWFLAKE_WAREHOUSE",
)

# Snowflake often returns uppercase identifiers; map to Event contract names.
_COLUMN_ALIASES = {
    "ID": "id",
    "SOURCE": "source",
    "SOURCE_URL": "sourceUrl",
    "SOURCEURL": "sourceUrl",
    "LAYER_ID": "layerId",
    "LAYERID": "layerId",
    "TITLE": "title",
    "SUMMARY": "summary",
    "OCCURRED_AT": "occurredAt",
    "OCCURREDAT": "occurredAt",
    "UPDATED_AT": "updatedAt",
    "UPDATEDAT": "updatedAt",
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
    "ENTITIES": "entities",
    "RAW_REF": "rawRef",
    "RAWREF": "rawRef",
    "SOURCE_ID": "sourceId",
    "SOURCEID": "sourceId",
    "TARGET_ID": "targetId",
    "TARGETID": "targetId",
    "RELATION": "relation",
    "CONFIDENCE": "confidence",
    "RATIONALE": "rationale",
    "MODEL": "model",
}


@dataclass
class SnowflakePing:
    status: str  # ok | dark | error | fixture
    warehouse_ping: str  # ok | skipped | error | dark
    last_ingest_at: str | None
    detail: str | None = None
    warmup_ms: int | None = None


def snowflake_account_set() -> bool:
    return bool(os.environ.get("SNOWFLAKE_ACCOUNT", "").strip())


def missing_snowflake_env() -> list[str]:
    return [name for name in SNOWFLAKE_ENV_REQUIRED if not os.environ.get(name, "").strip()]


def _connect_kwargs() -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "account": os.environ["SNOWFLAKE_ACCOUNT"].strip(),
        "user": os.environ["SNOWFLAKE_USER"].strip(),
        "password": os.environ["SNOWFLAKE_PASSWORD"],
        "warehouse": os.environ["SNOWFLAKE_WAREHOUSE"].strip(),
        "database": os.environ.get("SNOWFLAKE_DATABASE", "EVENTS").strip() or "EVENTS",
        "schema": os.environ.get("SNOWFLAKE_SCHEMA", "MART").strip() or "MART",
    }
    role = os.environ.get("SNOWFLAKE_ROLE", "").strip()
    if role:
        kwargs["role"] = role
    return kwargs


def _import_connector():
    try:
        import snowflake.connector  # type: ignore

        return snowflake.connector
    except ImportError as exc:
        raise RuntimeError(
            "snowflake-connector-python is not installed. "
            "pip install snowflake-connector-python==4.7.3"
        ) from exc


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


def ping_and_warmup(*, fetch_last_ingest: bool = True) -> SnowflakePing:
    """Warmup SELECT 1. Safe to call before the pitch room fills."""
    if not snowflake_account_set():
        return SnowflakePing(
            status="fixture",
            warehouse_ping="skipped",
            last_ingest_at=None,
            detail="SNOWFLAKE_ACCOUNT unset; fixture mode",
        )

    missing = missing_snowflake_env()
    if missing:
        return SnowflakePing(
            status="error",
            warehouse_ping="error",
            last_ingest_at=None,
            detail=f"Snowflake misconfigured; missing {', '.join(missing)}",
        )

    try:
        connector = _import_connector()
    except RuntimeError as exc:
        return SnowflakePing(
            status="error",
            warehouse_ping="error",
            last_ingest_at=None,
            detail=str(exc),
        )

    started = time.perf_counter()
    try:
        conn = connector.connect(**_connect_kwargs())
    except Exception as exc:  # noqa: BLE001 — surface any connector/network failure
        return SnowflakePing(
            status="dark",
            warehouse_ping="dark",
            last_ingest_at=None,
            detail=f"Snowflake unreachable: {exc}",
        )

    last_ingest_at: str | None = None
    try:
        cur = conn.cursor()
        try:
            cur.execute("SELECT 1")
            cur.fetchone()
            warmup_ms = int((time.perf_counter() - started) * 1000)
            if fetch_last_ingest:
                try:
                    cur.execute("SELECT MAX(pulled_at) FROM RAW.INGEST_BATCH")
                    row = cur.fetchone()
                    last_ingest_at = _iso_z(row[0] if row else None)
                except Exception:  # noqa: BLE001 — RAW may not exist until track B
                    last_ingest_at = None
            return SnowflakePing(
                status="ok",
                warehouse_ping="ok",
                last_ingest_at=last_ingest_at,
                detail=None,
                warmup_ms=warmup_ms,
            )
        finally:
            cur.close()
    except Exception as exc:  # noqa: BLE001
        return SnowflakePing(
            status="dark",
            warehouse_ping="dark",
            last_ingest_at=None,
            detail=f"Snowflake warmup failed: {exc}",
            warmup_ms=int((time.perf_counter() - started) * 1000),
        )
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


def _row_to_event(columns: list[str], row: tuple[Any, ...]) -> dict[str, Any]:
    event: dict[str, Any] = {}
    for name, value in zip(columns, row, strict=True):
        key = _COLUMN_ALIASES.get(name.upper(), name)
        if isinstance(value, datetime):
            value = _iso_z(value)
        elif isinstance(value, Decimal):
            value = float(value)
        elif key == "entities" and isinstance(value, str):
            value = json.loads(value)
        event[key] = value
    return event


def fetch_mart_events(*, limit: int | None = None, ping: SnowflakePing | None = None) -> tuple[list[dict[str, Any]] | None, SnowflakePing]:
    return _fetch_mart("EVENT", limit=limit, ping=ping)


def fetch_mart_links() -> tuple[list[dict[str, Any]] | None, SnowflakePing]:
    return _fetch_mart("EVENT_LINK")


def _fetch_mart(table: str, *, limit: int | None = None, ping: SnowflakePing | None = None) -> tuple[list[dict[str, Any]] | None, SnowflakePing]:
    """Read one of the fixed MART tables. Table names never come from HTTP."""
    if table not in {"EVENT", "EVENT_LINK"}:
        raise ValueError("Unsupported MART table")
    ping = ping or ping_and_warmup(fetch_last_ingest=True)
    if ping.status != "ok":
        return None, ping

    try:
        connector = _import_connector()
        conn = connector.connect(**_connect_kwargs())
    except Exception as exc:  # noqa: BLE001
        return None, SnowflakePing(
            status="dark",
            warehouse_ping="dark",
            last_ingest_at=ping.last_ingest_at,
            detail=f"Snowflake unreachable on MART read: {exc}",
            warmup_ms=ping.warmup_ms,
        )

    try:
        cur = conn.cursor()
        try:
            limit_sql = f" LIMIT {int(limit)}" if limit is not None else ""
            cur.execute(f"SELECT * FROM MART.{table}{limit_sql}")
            rows = cur.fetchall()
            columns = [col[0] for col in cur.description]
            events = [_row_to_event(columns, row) for row in rows]
            return events, ping
        except Exception as exc:  # noqa: BLE001 — table missing until track B
            return None, SnowflakePing(
                status="error",
                warehouse_ping="ok",
                last_ingest_at=ping.last_ingest_at,
                detail=f"MART.{table} unavailable; {exc}",
                warmup_ms=ping.warmup_ms,
            )
        finally:
            cur.close()
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
