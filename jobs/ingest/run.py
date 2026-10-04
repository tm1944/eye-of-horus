"""Load USGS, GDACS, and optional FIRMS rows into TigerData.

USGS and GDACS need no key. FIRMS runs only when FIRMS_MAP_KEY is set in .env.
Apply sql/001_init.sql first: python -m jobs.ingest.apply_schema
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from db import database_configured, database_url, load_repo_env  # noqa: E402

USGS_FEEDS = (
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
)
GDACS_URL = (
    "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
    "?eventlist=EQ,TC,FL,VO,DR,WF&alertlevel=Green;Orange;Red&fromDate={start}&toDate={end}"
)
# Day range 2: a 1-day window is the last 24 hours, and VIIRS NRT often
# stops on the previous calendar day, which comes back as a header-only CSV.
FIRMS_URL = (
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_NRT/{west},{south},{east},{north}/2"
)
FIRMS_TILE_DEGREES = 10
FIRMS_CAP = 5000
FIRMS_CELL_DEGREES = 0.5
FIRMS_MIN_COUNT = 8
FIRMS_MIN_FRP = 20.0
ACLED_TOKEN_URL = "https://acleddata.com/oauth/token"
ACLED_READ_URL = "https://acleddata.com/api/acled/read"
ACLED_INFO_URL = "https://acleddata.com/"
ACLED_CAP = 5000
ACLED_PAGE_SIZE = 5000
ACLED_CONFLICT_TYPES = {
    "Battles",
    "Explosions/Remote violence",
    "Violence against civilians",
    "Riots",
}
_ACLED_KIND_TABLE = {
    "conflict": "mart.conflict",
    "protest": "mart.protest",
    "strategic_development": "mart.strategic_development",
}
_ACLED_KIND_FIELDS = (
    "event_type",
    "disorder_type",
    "fatalities",
    "civilian_targeting",
    "actor1",
    "assoc_actor_1",
    "actor2",
    "assoc_actor_2",
    "inter1",
    "inter2",
    "interaction",
    "time_precision",
    "geo_precision_code",
    "location",
    "admin1",
    "admin2",
    "admin3",
    "region",
    "country",
    "iso",
    "source_name",
    "source_scale",
    "population_best",
)

GDACS_CATEGORY = {
    "EQ": "earthquake",
    "TC": "cyclone",
    "FL": "flood",
    "VO": "volcano",
    "DR": "drought",
    "WF": "wildfire",
}

_EVENT_UPSERT = """
INSERT INTO mart.event (
  event_id, source, source_event_id, category, subtype, title, summary, info_url,
  occurred_at, updated_at, ended_at, lng, lat, alt_m, geo_precision, geo_source,
  significance, weight, country_iso3, entities, raw_ref
) VALUES (
  %(event_id)s, %(source)s, %(source_event_id)s, %(category)s, %(subtype)s,
  %(title)s, %(summary)s, %(info_url)s, %(occurred_at)s, %(updated_at)s,
  %(ended_at)s, %(lng)s, %(lat)s, %(alt_m)s, %(geo_precision)s, %(geo_source)s,
  %(significance)s, %(weight)s, %(country_iso3)s, %(entities)s::jsonb, %(raw_ref)s
)
ON CONFLICT (source, source_event_id) DO UPDATE SET
  category = EXCLUDED.category,
  subtype = EXCLUDED.subtype,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  info_url = EXCLUDED.info_url,
  occurred_at = EXCLUDED.occurred_at,
  updated_at = EXCLUDED.updated_at,
  ended_at = EXCLUDED.ended_at,
  lng = EXCLUDED.lng,
  lat = EXCLUDED.lat,
  alt_m = EXCLUDED.alt_m,
  geo_precision = EXCLUDED.geo_precision,
  geo_source = EXCLUDED.geo_source,
  significance = EXCLUDED.significance,
  weight = EXCLUDED.weight,
  country_iso3 = EXCLUDED.country_iso3,
  entities = EXCLUDED.entities,
  raw_ref = EXCLUDED.raw_ref,
  ingested_at = now()
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fetch(url: str, timeout: int = 60) -> bytes:
    request = Request(url, headers={"User-Agent": "hypothesis-globe/ingest"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def _connect():
    import psycopg

    return psycopg.connect(database_url(), connect_timeout=20)


def _record_batch(cur, source: str, payload) -> str:
    batch_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO raw.ingest_batch (batch_id, source, pulled_at, payload)
        VALUES (%s, %s, %s, %s::jsonb)
        """,
        (batch_id, source, _now(), json.dumps(payload)),
    )
    return batch_id


def _blank_event(**overrides) -> dict:
    row = {
        "event_id": None,
        "source": None,
        "source_event_id": None,
        "category": None,
        "subtype": None,
        "title": None,
        "summary": None,
        "info_url": None,
        "occurred_at": None,
        "updated_at": None,
        "ended_at": None,
        "lng": None,
        "lat": None,
        "alt_m": None,
        "geo_precision": "point",
        "geo_source": "native",
        "significance": 0,
        "weight": None,
        "country_iso3": None,
        "entities": "[]",
        "raw_ref": None,
    }
    row.update(overrides)
    return row


def _num(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value):
    numeric = _num(value)
    if numeric is None:
        return None
    return int(numeric)


def _alert_significance(level, score) -> float:
    name = str(level or "").lower()
    if name == "red":
        return 90
    if name == "orange":
        return 70
    if name == "green":
        return 40
    numeric = _num(score)
    if numeric is None:
        return 20
    return min(100.0, numeric * 30)


def _iso3(value) -> str | None:
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, dict):
        value = value.get("iso3")
    if not value:
        return None
    text = str(value).strip().upper()
    return text[:3] if text else None


def _info_url(props: dict) -> str | None:
    url = props.get("url") or props.get("link")
    if isinstance(url, dict):
        return url.get("report") or url.get("details") or url.get("geometry")
    return url if isinstance(url, str) else None


def _severity(props: dict) -> tuple[float | None, str, str | None]:
    data = props.get("severitydata") or {}
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            data = {}
    return _num(data.get("severity")), str(data.get("severityunit") or ""), data.get("severitytext")


def ingest_usgs(cur) -> dict:
    body = {"features": []}
    feed = USGS_FEEDS[0]
    for feed in USGS_FEEDS:
        body = json.loads(_fetch(feed))
        if body.get("features"):
            break
    batch_id = _record_batch(cur, "usgs", body)
    count = 0
    for feature in body.get("features") or []:
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or [None, None, None]
        lng, lat = _num(coords[0] if len(coords) > 0 else None), _num(coords[1] if len(coords) > 1 else None)
        if lng is None or lat is None or not props.get("code") and not feature.get("id"):
            continue
        source_id = str(feature.get("id") or props.get("code"))
        depth_km = _num(coords[2] if len(coords) > 2 else None)
        mag = _num(props.get("mag"))
        sig = props.get("sig")
        occurred = datetime.fromtimestamp(int(props["time"]) / 1000, tz=timezone.utc)
        updated_ms = props.get("updated")
        updated = (
            datetime.fromtimestamp(int(updated_ms) / 1000, tz=timezone.utc) if updated_ms else None
        )
        event_id = f"usgs:{source_id}"
        cur.execute(
            _EVENT_UPSERT,
            _blank_event(
                event_id=event_id,
                source="usgs",
                source_event_id=source_id,
                category="earthquake",
                subtype=props.get("type") or "earthquake",
                title=props.get("title") or f"M {mag}",
                summary=props.get("place"),
                info_url=props.get("url"),
                occurred_at=occurred,
                updated_at=updated,
                lng=lng,
                lat=lat,
                alt_m=None if depth_km is None else -depth_km * 1000,
                significance=float(sig) if _num(sig) is not None else (mag or 0) * 10,
                weight=mag,
                raw_ref=f"raw.ingest_batch:{batch_id}",
                entities=json.dumps(
                    [{"type": "place", "text": props.get("place") or "", "confidence": 0.9}]
                    if props.get("place")
                    else []
                ),
            ),
        )
        cur.execute(
            """
            INSERT INTO mart.earthquake (
              event_id, magnitude, mag_type, depth_km, tsunami, felt, cdi, mmi, sig, alert, status, place
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO UPDATE SET
              magnitude = EXCLUDED.magnitude,
              mag_type = EXCLUDED.mag_type,
              depth_km = EXCLUDED.depth_km,
              tsunami = EXCLUDED.tsunami,
              felt = EXCLUDED.felt,
              cdi = EXCLUDED.cdi,
              mmi = EXCLUDED.mmi,
              sig = EXCLUDED.sig,
              alert = EXCLUDED.alert,
              status = EXCLUDED.status,
              place = EXCLUDED.place
            """,
            (
                event_id,
                mag,
                props.get("magType"),
                depth_km,
                bool(props.get("tsunami")),
                _int(props.get("felt")),
                _num(props.get("cdi")),
                _num(props.get("mmi")),
                _int(sig),
                props.get("alert"),
                props.get("status"),
                props.get("place"),
            ),
        )
        if props.get("tsunami"):
            cur.execute(
                """
                INSERT INTO mart.event_tag (event_id, tag, tag_kind)
                VALUES (%s, 'tsunami', 'keyword')
                ON CONFLICT (event_id, tag) DO NOTHING
                """,
                (event_id,),
            )
        count += 1
    return {"source": "usgs", "events": count, "feed": feed.rsplit("/", 1)[-1]}


def _point(feature: dict, props: dict) -> tuple[float | None, float | None]:
    geom = feature.get("geometry") or {}
    if geom.get("type") == "Point":
        coords = geom.get("coordinates") or []
        if len(coords) >= 2:
            return _num(coords[0]), _num(coords[1])
    return _num(props.get("longitude") or props.get("lon")), _num(props.get("latitude") or props.get("lat"))


def _upsert_gdacs_kind(cur, category: str, event_id: str, props: dict, severity, unit: str, text) -> None:
    level = props.get("alertlevel")
    score = _num(props.get("alertscore"))
    population = _int(props.get("population") or props.get("affectedpopulation"))
    shared = (
        event_id,
        props.get("eventid"),
        props.get("episodeid"),
        level,
        score,
        population,
        props.get("glide"),
    )
    if category == "earthquake":
        cur.execute(
            """
            INSERT INTO mart.earthquake (
              event_id, gdacs_event_id, episode_id, alert_level, alert_score, population, glide, magnitude
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO UPDATE SET
              gdacs_event_id = EXCLUDED.gdacs_event_id,
              episode_id = EXCLUDED.episode_id,
              alert_level = EXCLUDED.alert_level,
              alert_score = EXCLUDED.alert_score,
              population = EXCLUDED.population,
              glide = EXCLUDED.glide,
              magnitude = COALESCE(EXCLUDED.magnitude, mart.earthquake.magnitude)
            """,
            (*shared, severity if "m" in unit.lower() or unit == "" else None),
        )
        return
    if category == "cyclone":
        wind = severity if "km" in unit.lower() else None
        cur.execute(
            """
            INSERT INTO mart.cyclone (
              event_id, gdacs_event_id, episode_id, alert_level, alert_score, population, glide,
              storm_name, max_wind_kmh, storm_class
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO UPDATE SET
              alert_level = EXCLUDED.alert_level,
              alert_score = EXCLUDED.alert_score,
              population = EXCLUDED.population,
              storm_name = EXCLUDED.storm_name,
              max_wind_kmh = EXCLUDED.max_wind_kmh,
              storm_class = EXCLUDED.storm_class
            """,
            (*shared, props.get("name"), wind, text),
        )
        return
    if category == "flood":
        cur.execute(
            """
            INSERT INTO mart.flood (
              event_id, gdacs_event_id, episode_id, alert_level, alert_score, population, glide,
              flood_severity_score, severity_text, country, iso3
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO UPDATE SET
              flood_severity_score = EXCLUDED.flood_severity_score,
              severity_text = EXCLUDED.severity_text,
              alert_level = EXCLUDED.alert_level,
              alert_score = EXCLUDED.alert_score
            """,
            (*shared, severity, text, props.get("country"), _iso3(props.get("iso3"))),
        )
        return
    if category == "drought":
        area = severity if "km" in unit.lower() else None
        cur.execute(
            """
            INSERT INTO mart.drought (
              event_id, gdacs_event_id, episode_id, alert_level, alert_score, population, glide,
              affected_area_km2, country, iso3
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO UPDATE SET
              affected_area_km2 = EXCLUDED.affected_area_km2,
              alert_level = EXCLUDED.alert_level,
              alert_score = EXCLUDED.alert_score
            """,
            (*shared, area, props.get("country"), _iso3(props.get("iso3"))),
        )
        return
    if category == "volcano":
        cur.execute(
            """
            INSERT INTO mart.volcano (
              event_id, gdacs_event_id, episode_id, alert_level, alert_score, population, glide,
              volcano_name, severity_text, country, iso3
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO UPDATE SET
              volcano_name = EXCLUDED.volcano_name,
              severity_text = EXCLUDED.severity_text,
              alert_level = EXCLUDED.alert_level,
              alert_score = EXCLUDED.alert_score
            """,
            (*shared, props.get("name"), text, props.get("country"), _iso3(props.get("iso3"))),
        )
        return
    burned = severity if category == "wildfire" and unit else None
    cur.execute(
        """
        INSERT INTO mart.wildfire (
          event_id, gdacs_event_id, episode_id, alert_level, alert_score, population, glide, burned_area_ha
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (event_id) DO UPDATE SET
          gdacs_event_id = EXCLUDED.gdacs_event_id,
          episode_id = EXCLUDED.episode_id,
          alert_level = EXCLUDED.alert_level,
          alert_score = EXCLUDED.alert_score,
          population = EXCLUDED.population,
          glide = EXCLUDED.glide,
          burned_area_ha = EXCLUDED.burned_area_ha
        """,
        (*shared, burned),
    )


def ingest_gdacs(cur) -> dict:
    end = _now().date()
    start = end - timedelta(days=7)
    body = json.loads(_fetch(GDACS_URL.format(start=start.isoformat(), end=end.isoformat())))
    batch_id = _record_batch(cur, "gdacs", body)
    count = 0
    for feature in body.get("features") or []:
        props = feature.get("properties") or {}
        event_type = str(props.get("eventtype") or "").upper()
        category = GDACS_CATEGORY.get(event_type)
        lng, lat = _point(feature, props)
        if category is None or lng is None or lat is None or props.get("eventid") is None:
            continue
        episode = props.get("episodeid") or 0
        source_id = f"{event_type}:{props.get('eventid')}:{episode}"
        event_id = f"gdacs:{source_id}"
        severity, unit, text = _severity(props)
        from_date = props.get("fromdate")
        to_date = props.get("todate")
        cur.execute(
            _EVENT_UPSERT,
            _blank_event(
                event_id=event_id,
                source="gdacs",
                source_event_id=source_id,
                category=category,
                subtype=event_type,
                title=props.get("name") or props.get("htmldescription") or source_id,
                summary=text,
                info_url=_info_url(props),
                occurred_at=from_date or _now(),
                updated_at=_now(),
                ended_at=to_date,
                lng=lng,
                lat=lat,
                geo_precision="point",
                geo_source="native",
                significance=_alert_significance(props.get("alertlevel"), props.get("alertscore")),
                weight=severity if severity is not None else _num(props.get("alertscore")),
                country_iso3=_iso3(props.get("iso3")),
                raw_ref=f"raw.ingest_batch:{batch_id}",
            ),
        )
        _upsert_gdacs_kind(cur, category, event_id, props, severity, unit, text)
        count += 1
    return {"source": "gdacs", "events": count}


def _cell(lat: float, lng: float) -> tuple[float, float]:
    step = FIRMS_CELL_DEGREES
    return (round(lat / step) * step, round(lng / step) * step)


def _firms_tiles() -> list[tuple[int, int, int, int]]:
    step = FIRMS_TILE_DEGREES
    tiles = []
    lat = -60
    while lat < 70:
        lng = -180
        while lng < 180:
            tiles.append((lng, lat, min(lng + step, 180), min(lat + step, 90)))
            lng += step
        lat += step
    return tiles


def _fetch_firms_rows(key: str) -> list[dict]:
    def one(tile: tuple[int, int, int, int]) -> list[dict]:
        west, south, east, north = tile
        try:
            text = _fetch(
                FIRMS_URL.format(key=key, west=west, south=south, east=east, north=north),
                timeout=60,
            ).decode("utf-8", errors="replace")
        except Exception:
            return []
        return list(csv.DictReader(io.StringIO(text)))

    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for batch in pool.map(one, _firms_tiles()):
            rows.extend(batch)
    return rows


def ingest_firms(cur, rows: list[dict] | None = None) -> dict:
    load_repo_env()
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        return {"source": "firms", "status": "skipped", "detail": "FIRMS_MAP_KEY is empty"}
    if rows is None:
        rows = _fetch_firms_rows(key)
    rows.sort(key=lambda row: _num(row.get("frp")) or 0, reverse=True)
    rows = rows[:FIRMS_CAP]
    batch_id = _record_batch(cur, "firms", {"kept": len(rows), "cap": FIRMS_CAP})
    grouped: dict[tuple[float, float, str], list[dict]] = defaultdict(list)
    # Latest detection per cluster: its event time (not midnight of the acquisition date).
    latest: dict[tuple[float, float, str], datetime] = {}
    for row in rows:
        lat, lng = _num(row.get("latitude")), _num(row.get("longitude"))
        if lat is None or lng is None:
            continue
        acq_date = row.get("acq_date") or ""
        acq_time = (row.get("acq_time") or "0000").zfill(4)
        try:
            acq_at = datetime.strptime(f"{acq_date}{acq_time}", "%Y-%m-%d%H%M").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        hotspot_id = f"firms:{row.get('satellite')}:{acq_date}:{acq_time}:{lat:.4f}:{lng:.4f}"
        cluster_key = (*_cell(lat, lng), acq_date)
        grouped[cluster_key].append((hotspot_id, row))
        latest[cluster_key] = max(latest.get(cluster_key, acq_at), acq_at)
        cur.execute(
            """
            INSERT INTO mart.wildfire_hotspot (
              hotspot_id, lat, lng, acq_at, satellite, confidence, frp, brightness, daynight, raw_ref
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (hotspot_id, acq_at) DO UPDATE SET
              frp = EXCLUDED.frp,
              confidence = EXCLUDED.confidence,
              raw_ref = EXCLUDED.raw_ref
            """,
            (
                hotspot_id,
                lat,
                lng,
                acq_at,
                row.get("satellite"),
                row.get("confidence"),
                _num(row.get("frp")),
                _num(row.get("bright_ti4") or row.get("brightness")),
                row.get("daynight"),
                f"raw.ingest_batch:{batch_id}",
            ),
        )
    clusters = 0
    for (cell_lat, cell_lng, acq_date), members in grouped.items():
        frps = [_num(item.get("frp")) or 0 for _hotspot_id, item in members]
        if len(members) < FIRMS_MIN_COUNT and max(frps, default=0) < FIRMS_MIN_FRP:
            continue
        event_id = f"firms-cluster:{acq_date}:{cell_lat:.1f}:{cell_lng:.1f}"
        source_id = f"{acq_date}:{cell_lat:.1f}:{cell_lng:.1f}"
        mean_frp = sum(frps) / len(frps)
        cur.execute(
            _EVENT_UPSERT,
            _blank_event(
                event_id=event_id,
                source="firms",
                source_event_id=source_id,
                category="wildfire",
                subtype="viirs_cluster",
                title=f"VIIRS hotspot cluster {cell_lat:.1f}, {cell_lng:.1f}",
                summary="NASA FIRMS cluster. Cite NASA FIRMS.",
                info_url="https://firms.modaps.eosdis.nasa.gov/",
                occurred_at=latest[(cell_lat, cell_lng, acq_date)],
                updated_at=_now(),
                lng=cell_lng,
                lat=cell_lat,
                significance=min(100.0, max(frps)),
                weight=max(frps),
                raw_ref=f"raw.ingest_batch:{batch_id}",
            ),
        )
        cur.execute(
            """
            INSERT INTO mart.wildfire (
              event_id, hotspot_count, max_frp, mean_frp, satellite, confidence, daynight
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO UPDATE SET
              hotspot_count = EXCLUDED.hotspot_count,
              max_frp = EXCLUDED.max_frp,
              mean_frp = EXCLUDED.mean_frp
            """,
            (
                event_id,
                len(members),
                max(frps),
                mean_frp,
                members[0][1].get("satellite"),
                members[0][1].get("confidence"),
                members[0][1].get("daynight"),
            ),
        )
        cur.execute(
            """
            UPDATE mart.wildfire_hotspot
            SET event_id = %s
            WHERE hotspot_id = ANY(%s)
            """,
            (event_id, [hotspot_id for hotspot_id, _item in members]),
        )
        clusters += 1
    return {"source": "firms", "status": "ok", "hotspots": len(rows), "clusters": clusters}


def acled_category(event_type: str | None) -> str | None:
    if event_type in ACLED_CONFLICT_TYPES:
        return "conflict"
    if event_type == "Protests":
        return "protest"
    if event_type == "Strategic developments":
        return "strategic_development"
    return None


def acled_geo_precision(code) -> str:
    return {1: "point", 2: "city", 3: "region"}.get(_int(code) or 0, "point")


def acled_significance(fatalities: int | None, civilian_targeting: str | None) -> float:
    score = 55.0
    if fatalities:
        score += min(30.0, fatalities * 5)
    if civilian_targeting and str(civilian_targeting).strip():
        score += 15
    return min(100.0, score)


def _acled_crowd_size(tags: str) -> str | None:
    match = re.search(r"crowd size\s*=\s*([^;]+)", tags, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(1).strip() or None


def _acled_tags(row: dict, category_event_type: str) -> list[tuple[str, str]]:
    tags: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add(value, kind: str) -> None:
        text = str(value or "").strip()
        if not text or text in seen:
            return
        seen.add(text)
        tags.append((text, kind))

    add(category_event_type, "keyword")
    add(row.get("sub_event_type"), "keyword")
    add(row.get("disorder_type"), "keyword")
    for part in str(row.get("tags") or "").split(";"):
        add(part, "keyword")
    if (_int(row.get("fatalities")) or 0) > 0:
        add("fatalities", "impact")
    if str(row.get("civilian_targeting") or "").strip():
        add("civilian_targeting", "impact")
    return tags


def prepare_acled_event(row: dict) -> dict | None:
    event_type = str(row.get("event_type") or "").strip()
    category = acled_category(event_type)
    source_id = str(row.get("event_id_cnty") or "").strip()
    lat, lng = _num(row.get("latitude")), _num(row.get("longitude"))
    event_date = str(row.get("event_date") or "").strip()
    if category is None or not source_id or lat is None or lng is None or not event_date:
        return None
    try:
        occurred_at = datetime.strptime(event_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    updated_at = None
    timestamp = _int(row.get("timestamp"))
    if timestamp:
        updated_at = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    location = str(row.get("location") or "").strip()
    country = str(row.get("country") or "").strip()
    subtype = str(row.get("sub_event_type") or "").strip() or None
    place = ", ".join(part for part in (location, country) if part)
    title = f"{subtype or event_type} in {place}" if place else (subtype or event_type)
    fatalities = _int(row.get("fatalities"))
    civilian = str(row.get("civilian_targeting") or "").strip() or None
    entities = []
    for actor in (row.get("actor1"), row.get("actor2")):
        text = str(actor or "").strip()
        if text:
            entities.append({"type": "actor", "text": text, "confidence": 1})
    kind = {
        "event_type": event_type,
        "disorder_type": row.get("disorder_type") or None,
        "fatalities": fatalities,
        "civilian_targeting": civilian,
        "actor1": row.get("actor1") or None,
        "assoc_actor_1": row.get("assoc_actor_1") or None,
        "actor2": row.get("actor2") or None,
        "assoc_actor_2": row.get("assoc_actor_2") or None,
        "inter1": None if row.get("inter1") in (None, "") else str(row.get("inter1")),
        "inter2": None if row.get("inter2") in (None, "") else str(row.get("inter2")),
        "interaction": None if row.get("interaction") in (None, "") else str(row.get("interaction")),
        "time_precision": _int(row.get("time_precision")),
        "geo_precision_code": _int(row.get("geo_precision")),
        "location": location or None,
        "admin1": row.get("admin1") or None,
        "admin2": row.get("admin2") or None,
        "admin3": row.get("admin3") or None,
        "region": row.get("region") or None,
        "country": country or None,
        "iso": _int(row.get("iso")),
        "source_name": row.get("source") or None,
        "source_scale": row.get("source_scale") or None,
        "population_best": _num(row.get("population_best")),
    }
    if category == "protest":
        kind["crowd_size"] = _acled_crowd_size(str(row.get("tags") or ""))
    return {
        "event_id": f"acled:{source_id}",
        "source_event_id": source_id,
        "category": category,
        "subtype": subtype,
        "title": title,
        "summary": row.get("notes") or None,
        "occurred_at": occurred_at,
        "updated_at": updated_at,
        "lng": lng,
        "lat": lat,
        "geo_precision": acled_geo_precision(row.get("geo_precision")),
        "significance": acled_significance(fatalities, civilian),
        "weight": fatalities or 0,
        "entities": entities,
        "kind": kind,
        "tags": _acled_tags(row, event_type),
    }


def _acled_request(url: str, data: dict | None = None, token: str | None = None) -> dict:
    headers = {"User-Agent": "hypothesis-globe/ingest", "Accept": "application/json"}
    body = None
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        body = urlencode(data).encode()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, data=body, headers=headers)
    try:
        with urlopen(request, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except HTTPError as exc:
        raise RuntimeError(f"http {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError("network") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("unexpected response")
    return payload


def _clean_access_token(value: str) -> str:
    """Keep the access-token JWT when the OAuth JSON was pasted after it."""
    value = value.strip()
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    marker = value.find("refresh_token")
    if marker != -1:
        value = value[:marker]
    value = value.strip().strip("\"'{},")
    parts = value.split(".")
    if len(parts) < 3:
        return value
    signature = re.match(r"[A-Za-z0-9_-]+", parts[2])
    if signature:
        parts[2] = signature.group(0)
    return ".".join(parts[:3])


def _acled_access_token() -> tuple[str | None, dict | None]:
    load_repo_env()
    provided = _clean_access_token(os.environ.get("ACLED_ACCESS_TOKEN", ""))
    if provided:
        return provided, None
    username = os.environ.get("ACLED_USERNAME", "").strip()
    password = os.environ.get("ACLED_PASSWORD", "").strip()
    if not username or not password:
        return None, {
            "source": "acled",
            "status": "skipped",
            "detail": "ACLED_ACCESS_TOKEN is empty",
        }
    try:
        token_body = _acled_request(
            ACLED_TOKEN_URL,
            {
                "username": username,
                "password": password,
                "grant_type": "password",
                "client_id": "acled",
                "scope": "authenticated",
            },
        )
    except RuntimeError as exc:
        return None, {"source": "acled", "status": "error", "detail": f"ACLED login failed ({exc})"}
    token = str(token_body.get("access_token") or "")
    if not token:
        return None, {"source": "acled", "status": "error", "detail": "ACLED login failed (no token)"}
    return token, None


def _fetch_acled_rows() -> tuple[list[dict] | None, dict | None, dict | None]:
    token, problem = _acled_access_token()
    if problem:
        return None, None, problem
    end = _now().date()
    start = end - timedelta(days=6)
    window = {"start": start.isoformat(), "end": end.isoformat()}
    rows: list[dict] = []
    page = 1
    try:
        # Monadic keeps one row per event and still uses page numbers.
        # Cursor pagination is for dyadic exports and is not sent here.
        while len(rows) < ACLED_CAP and page <= 10:
            params = {
                "_format": "json",
                "export_type": "monadic",
                "event_date": f"{window['start']}|{window['end']}",
                "event_date_where": "BETWEEN",
                "population": "TRUE",
                "limit": str(min(ACLED_PAGE_SIZE, ACLED_CAP - len(rows))),
                "page": str(page),
            }
            payload = _acled_request(ACLED_READ_URL + "?" + urlencode(params), token=token)
            if payload.get("success") is False:
                status = payload.get("status") or "error"
                return None, None, {"source": "acled", "status": "error", "detail": f"ACLED read failed ({status})"}
            batch = payload.get("data") or []
            if isinstance(batch, dict):
                batch = [batch]
            rows.extend(item for item in batch if isinstance(item, dict))
            if not batch or len(batch) < int(params["limit"]):
                break
            page += 1
    except RuntimeError as exc:
        return None, None, {"source": "acled", "status": "error", "detail": f"ACLED read failed ({exc})"}
    return rows[:ACLED_CAP], window, None


def _upsert_acled_kind(cur, category: str, event_id: str, kind: dict) -> None:
    fields = list(_ACLED_KIND_FIELDS)
    if category == "protest":
        fields.append("crowd_size")
    columns = ", ".join(["event_id", *fields])
    placeholders = ", ".join(["%s"] * (len(fields) + 1))
    updates = ", ".join(f"{name} = EXCLUDED.{name}" for name in fields)
    table = _ACLED_KIND_TABLE[category]
    cur.execute(
        f"""
        INSERT INTO {table} ({columns})
        VALUES ({placeholders})
        ON CONFLICT (event_id) DO UPDATE SET {updates}
        """,
        [event_id, *[kind.get(name) for name in fields]],
    )


def load_acled(cur, rows: list[dict], window: dict) -> dict:
    prepared = [item for item in (prepare_acled_event(row) for row in rows) if item]
    counts = {category: 0 for category in _ACLED_KIND_TABLE}
    batch_id = _record_batch(cur, "acled", {"window": window, "kept": len(prepared), "cap": ACLED_CAP})
    for item in prepared:
        event_id = item["event_id"]
        cur.execute(
            _EVENT_UPSERT,
            _blank_event(
                event_id=event_id,
                source="acled",
                source_event_id=item["source_event_id"],
                category=item["category"],
                subtype=item["subtype"],
                title=item["title"],
                summary=item["summary"],
                info_url=ACLED_INFO_URL,
                occurred_at=item["occurred_at"],
                updated_at=item["updated_at"],
                lng=item["lng"],
                lat=item["lat"],
                geo_precision=item["geo_precision"],
                geo_source="native",
                significance=item["significance"],
                weight=item["weight"],
                entities=json.dumps(item["entities"]),
                raw_ref=f"raw.ingest_batch:{batch_id}",
            ),
        )
        _upsert_acled_kind(cur, item["category"], event_id, item["kind"])
        cur.execute("DELETE FROM mart.event_tag WHERE event_id = %s", (event_id,))
        for tag, tag_kind in item["tags"]:
            cur.execute(
                """
                INSERT INTO mart.event_tag (event_id, tag, tag_kind)
                VALUES (%s, %s, %s)
                ON CONFLICT (event_id, tag) DO NOTHING
                """,
                (event_id, tag, tag_kind),
            )
        counts[item["category"]] += 1
    return {"source": "acled", "status": "ok", "events": len(prepared), **counts}


CONFLICT_CSV_PATH = REPO_ROOT / "data" / "backup_csvs" / "finalconflictCSV.csv"
CONFLICT_CSV_CATEGORIES = {"conflict", "protest", "terror", "politics", "crime"}


def conflict_csv_significance(goldstein) -> float:
    magnitude = abs(_num(goldstein) or 0)
    return min(100.0, 55.0 + magnitude * 4.5)


def conflict_csv_geo_precision(place: str) -> str:
    if "(general)" in place.lower() or "," not in place:
        return "region"
    return "city"


def prepare_conflict_csv_row(row: dict) -> dict | None:
    category = str(row.get("category") or "").strip()
    url = str(row.get("SOURCEURL") or "").strip()
    title = str(row.get("title") or "").strip()
    lat, lng = _num(row.get("ActionGeo_Lat")), _num(row.get("ActionGeo_Long"))
    if category not in CONFLICT_CSV_CATEGORIES or not url or not title or lat is None or lng is None:
        return None
    try:
        occurred_at = datetime.strptime(str(row.get("SQLDATE") or "").strip(), "%Y%m%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    place = str(row.get("ActionGeo_FullName") or "").strip()
    actors = []
    for name in (row.get("Actor1Name"), row.get("Actor2Name")):
        text = str(name or "").strip()
        if text:
            actors.append({"type": "actor", "text": text, "confidence": 1})
    tags = [(category, "keyword")]
    event_code = str(row.get("EventCode") or "").strip()
    if event_code:
        tags.append((event_code, "keyword"))
    kind = None
    if category in {"conflict", "protest"}:
        kind = {name: None for name in _ACLED_KIND_FIELDS}
        kind["event_type"] = category
        kind["actor1"] = str(row.get("Actor1Name") or "").strip() or None
        kind["actor2"] = str(row.get("Actor2Name") or "").strip() or None
        kind["location"] = place or None
    return {
        "event_id": f"conflict-csv:{url}",
        "source_event_id": url,
        "category": category,
        "subtype": event_code or None,
        "title": title,
        "summary": str(row.get("description") or "").strip() or None,
        "info_url": url,
        "occurred_at": occurred_at,
        "lng": lng,
        "lat": lat,
        "geo_precision": conflict_csv_geo_precision(place),
        "significance": conflict_csv_significance(row.get("GoldsteinScale")),
        "weight": _int(row.get("NumArticles")) or 0,
        "entities": actors,
        "tags": tags,
        "kind": kind,
    }


def read_conflict_csv(path: Path | None = None) -> list[dict]:
    csv_path = path or CONFLICT_CSV_PATH
    with csv_path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def load_conflict_csv(cur, rows: list[dict] | None = None) -> dict:
    if rows is None:
        if not CONFLICT_CSV_PATH.is_file():
            return {"source": "conflict_csv", "status": "skipped", "detail": "finalconflictCSV.csv is missing"}
        rows = read_conflict_csv()
    prepared = [item for item in (prepare_conflict_csv_row(row) for row in rows) if item]
    counts = {category: 0 for category in sorted(CONFLICT_CSV_CATEGORIES)}
    batch_id = _record_batch(cur, "conflict_csv", {"file": CONFLICT_CSV_PATH.name, "kept": len(prepared)})
    for item in prepared:
        event_id = item["event_id"]
        cur.execute(
            _EVENT_UPSERT,
            _blank_event(
                event_id=event_id,
                source="conflict_csv",
                source_event_id=item["source_event_id"],
                category=item["category"],
                subtype=item["subtype"],
                title=item["title"],
                summary=item["summary"],
                info_url=item["info_url"],
                occurred_at=item["occurred_at"],
                updated_at=item["occurred_at"],
                lng=item["lng"],
                lat=item["lat"],
                geo_precision=item["geo_precision"],
                geo_source="native",
                significance=item["significance"],
                weight=item["weight"],
                entities=json.dumps(item["entities"]),
                raw_ref=f"raw.ingest_batch:{batch_id}",
            ),
        )
        if item["kind"] is not None:
            _upsert_acled_kind(cur, item["category"], event_id, item["kind"])
        cur.execute("DELETE FROM mart.event_tag WHERE event_id = %s", (event_id,))
        for tag, tag_kind in item["tags"]:
            cur.execute(
                """
                INSERT INTO mart.event_tag (event_id, tag, tag_kind)
                VALUES (%s, %s, %s)
                ON CONFLICT (event_id, tag) DO NOTHING
                """,
                (event_id, tag, tag_kind),
            )
        counts[item["category"]] += 1
    return {"source": "conflict_csv", "status": "ok", "events": len(prepared), **counts}


def run_ingest() -> dict:
    load_repo_env()
    if not database_configured():
        return {
            "ok": False,
            "status": "needs_database_url",
            "detail": "Paste DATABASE_URL into the gitignored .env file, then run this again.",
        }
    import psycopg

    firms_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    firms_rows = _fetch_firms_rows(firms_key) if firms_key else None
    acled_rows, acled_window, acled_problem = _fetch_acled_rows()
    summary = []
    conn = psycopg.connect(database_url(), connect_timeout=20)
    try:
        for loader in (ingest_usgs, ingest_gdacs):
            with conn.transaction():
                with conn.cursor() as cur:
                    summary.append(loader(cur))
        with conn.transaction():
            with conn.cursor() as cur:
                summary.append(ingest_firms(cur, firms_rows))
        if acled_problem:
            summary.append(acled_problem)
        else:
            with conn.transaction():
                with conn.cursor() as cur:
                    summary.append(load_acled(cur, acled_rows or [], acled_window or {}))
        with conn.transaction():
            with conn.cursor() as cur:
                summary.append(load_conflict_csv(cur))
        # Thumbnails last, outside the loaders' transactions: only rows still without an
        # image are looked up, so repeat runs are cheap. A failure here never fails ingest.
        try:
            from jobs.ingest.images import fill_missing_images

            images = fill_missing_images(conn, sources=("usgs", "gdacs", "conflict_csv"), log=lambda _line: None)
            summary.append({"source": "images", "status": "ok", **images})
        except Exception as exc:  # noqa: BLE001 — images are decoration; keep the loaded events
            conn.rollback()
            summary.append({"source": "images", "status": "error", "detail": str(exc)[:200]})
        return {"ok": True, "status": "loaded", "sources": summary}
    finally:
        conn.close()


def main() -> None:
    result = run_ingest()
    print(json.dumps(result, indent=2))
    if not result.get("ok"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
