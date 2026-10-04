"""Estimate how many people live near each natural hazard.

The population grid is the European Commission Joint Research Centre
GHS-POP R2023A release (about 1 km cells, CC BY 4.0). Tiles are cached
under data/cache/ghsl. Scores land in mart.hazard_exposure.

Apply sql/004_exposure.sql first, then:

    python -m jobs.ingest.exposure
"""

from __future__ import annotations

import io
import math
import sys
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

RADII_KM = {
    "earthquake": 50.0,
    "wildfire": 25.0,
    "flood": 40.0,
    "cyclone": 80.0,
    "volcano": 30.0,
}
EXPOSURE_SOURCE = "JRC GHSL GHS-POP R2023A"
# A city of this size inside the radius is full exposure.
_FULL_EXPOSURE = 5_000_000
_SPARSE_PEOPLE = 500
_ALERT_INTENSITY = {"red": 1.0, "orange": 0.6, "green": 0.25}
_TILE_URL = (
    "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/"
    "GHS_POP_GLOBE_R2023A/GHS_POP_E2020_GLOBE_R2023A_4326_30ss/V1-0/tiles/"
    "GHS_POP_E2020_GLOBE_R2023A_4326_30ss_V1_0_R{row}_C{col}.zip"
)
_CACHE = REPO_ROOT / "data" / "cache" / "ghsl"
_HAZARD_SQL = """
SELECT e.event_id, e.category, e.lat, e.lng,
       q.magnitude,
       w.max_frp, w.alert_level,
       c.max_wind_kmh, c.alert_level,
       f.alert_level,
       v.alert_level
FROM mart.event e
LEFT JOIN mart.earthquake q ON q.event_id = e.event_id
LEFT JOIN mart.wildfire w ON w.event_id = e.event_id
LEFT JOIN mart.cyclone c ON c.event_id = e.event_id
LEFT JOIN mart.flood f ON f.event_id = e.event_id
LEFT JOIN mart.volcano v ON v.event_id = e.event_id
WHERE e.category = ANY(%s)
ORDER BY e.event_id
"""
_UPSERT = """
INSERT INTO mart.hazard_exposure (
  event_id, people_exposed, radius_km, intensity, impact_score,
  impact_class, exposure_source, computed_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (event_id) DO UPDATE SET
  people_exposed = EXCLUDED.people_exposed,
  radius_km = EXCLUDED.radius_km,
  intensity = EXCLUDED.intensity,
  impact_score = EXCLUDED.impact_score,
  impact_class = EXCLUDED.impact_class,
  exposure_source = EXCLUDED.exposure_source,
  computed_at = EXCLUDED.computed_at
"""


def _num(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


# Published 30 arc-second tiles are 10° squares shifted off the neat grid.
# Measured from GHS_POP R2023A GeoTIFFs (R4_C19, R10_C30): actual north is
# 0.90041646° south of 90-(row-1)*10, and actual west is 0.00791708° west of
# -180+(col-1)*10. Netherlands (52N, 5E) remains row 4, column 19.
_NORTH_SHIFT = 0.9004164601411873
_WEST_SHIFT = 0.00791707992698


def tile_index(lat: float, lng: float) -> tuple[int, int]:
    """GHSL tile containing a point. Netherlands (52N, 5E) is row 4, column 19."""
    lat = min(90.0, max(-90.0, lat))
    lng = ((lng + 180.0) % 360.0) - 180.0
    row = int((90.0 - _NORTH_SHIFT - lat) // 10) + 1
    col = int((lng + 180.0 + _WEST_SHIFT) // 10) + 1
    return min(18, max(1, row)), min(36, max(1, col))


def tile_bounds(row: int, col: int) -> tuple[float, float, float, float]:
    """West, south, east, north of one published 10-degree tile."""
    north = 90.0 - (row - 1) * 10.0 - _NORTH_SHIFT
    west = -180.0 + (col - 1) * 10.0 - _WEST_SHIFT
    return west, north - 10.0, west + 10.0, north


def tiles_covering(lat: float, lng: float, radius_km: float) -> list[tuple[int, int]]:
    """Tiles touched by a circle. A circle across ±180° includes both sides."""
    dlat = radius_km / 110.574
    dlng = radius_km / (111.320 * max(0.01, math.cos(math.radians(lat))))
    south = max(-90.0, lat - dlat)
    north = min(90.0, lat + dlat)
    west = lng - dlng
    east = lng + dlng
    if west < -180:
        spans = ((west + 360.0, 180.0), (-180.0, east))
    elif east > 180:
        spans = ((west, 180.0), (-180.0, east - 360.0))
    else:
        spans = ((west, east),)
    found: set[tuple[int, int]] = set()
    boxes = [(left, south, right, north) for left, right in spans if right >= left]
    for row in range(1, 19):
        for col in range(1, 37):
            west, tile_south, east, tile_north = tile_bounds(row, col)
            if any(west < be and east > bw and tile_south < bn and tile_north > bs for bw, bs, be, bn in boxes):
                found.add((row, col))
    return sorted(found)


def alert_intensity(level: object) -> float | None:
    if not isinstance(level, str):
        return None
    return _ALERT_INTENSITY.get(level.strip().lower())


def intensity(category: str, attrs: dict) -> float | None:
    """Hazard strength on 0–1. None when the kind row has no usable measure."""
    if category == "earthquake":
        magnitude = _num(attrs.get("magnitude"))
        return None if magnitude is None else min(1.0, magnitude / 8.0)
    if category == "wildfire":
        frp = _num(attrs.get("max_frp"))
        if frp is not None:
            return min(1.0, frp / 50.0)
        return alert_intensity(attrs.get("alert_level"))
    if category == "cyclone":
        wind = _num(attrs.get("max_wind_kmh"))
        if wind is not None:
            return min(1.0, wind / 200.0)
        return alert_intensity(attrs.get("alert_level"))
    if category in ("flood", "volcano"):
        return alert_intensity(attrs.get("alert_level"))
    return None


def impact_score(level: float, people: float) -> float:
    factor = min(1.0, math.log10(people + 1.0) / math.log10(_FULL_EXPOSURE))
    return 100.0 * max(0.0, level) * max(0.0, factor)


def impact_class(score: float, people: float) -> str:
    """0–24 Low, 25–49 Moderate, 50–74 High, 75–100 Severe.

    Fewer than 500 people cannot rise above Moderate.
    """
    if score < 25:
        label = "Low"
    elif score < 50:
        label = "Moderate"
    elif score < 75:
        label = "High"
    else:
        label = "Severe"
    if people < _SPARSE_PEOPLE and label in ("High", "Severe"):
        return "Moderate"
    return label


def score_hazard(category: str, attrs: dict, people: float, radius_km: float) -> dict | None:
    level = intensity(category, attrs)
    if level is None:
        return None
    score = impact_score(level, people)
    return {
        "people_exposed": max(0, int(round(people))),
        "radius_km": radius_km,
        "intensity": level,
        "impact_score": score,
        "impact_class": impact_class(score, people),
        "exposure_source": EXPOSURE_SOURCE,
    }


def people_in_radius(
    grid: np.ndarray,
    transform: tuple[float, float, float, float, float, float],
    radius_km: float,
    lat: float,
    lng: float,
) -> float:
    """Sum cell values whose centers fall inside the radius.

    transform is (a, b, c, d, e, f): lng = a*col + b*row + c, lat = d*col + e*row + f,
    using zero-based column and row indexes. Values below 0 are nodata.
    """
    values = np.asarray(grid, dtype=np.float64)
    if values.ndim != 2 or values.size == 0 or radius_km < 0:
        return 0.0
    rows, cols = np.indices(values.shape, dtype=np.float64)
    a, b, c, d, e, f = transform
    lngs = a * (cols + 0.5) + b * (rows + 0.5) + c
    lats = d * (cols + 0.5) + e * (rows + 0.5) + f
    inside = _haversine_km(lat, lng, lats, lngs) <= radius_km
    usable = np.where(np.isfinite(values) & (values >= 0), values, 0.0)
    return float(usable[inside].sum())


def _haversine_km(lat1: float, lng1: float, lat2: np.ndarray, lng2: np.ndarray) -> np.ndarray:
    radius = 6371.0088
    phi1 = np.radians(lat1)
    phi2 = np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlng = (np.radians(lng2 - lng1) + np.pi) % (2 * np.pi) - np.pi
    height = np.sin(dphi / 2) ** 2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlng / 2) ** 2
    return 2 * radius * np.arcsin(np.minimum(1.0, np.sqrt(height)))


def _attrs_from_row(category: str, row: tuple) -> dict:
    if category == "earthquake":
        return {"magnitude": row[4]}
    if category == "wildfire":
        return {"max_frp": row[5], "alert_level": row[6]}
    if category == "cyclone":
        return {"max_wind_kmh": row[7], "alert_level": row[8]}
    if category == "flood":
        return {"alert_level": row[9]}
    if category == "volcano":
        return {"alert_level": row[10]}
    return {}


def ensure_tile(cache: Path, row: int, col: int) -> Path | None:
    """Return the cached GeoTIFF, downloading the JRC zip when needed.

    None means the tile is not published (open ocean). Other HTTP failures raise.
    """
    dest = cache / f"R{row}_C{col}.tif"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    request = Request(_TILE_URL.format(row=row, col=col), headers={"User-Agent": "hypothesis-globe/exposure"})
    try:
        with urlopen(request, timeout=120) as response:
            payload = response.read()
    except HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".tif")]
        if len(names) != 1:
            raise RuntimeError(f"GHSL tile R{row}_C{col} did not contain one GeoTIFF")
        cache.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(archive.read(names[0]))
    return dest


def _sum_tile(path: Path, lat: float, lng: float, radius_km: float, bounds: tuple[float, float, float, float]) -> float:
    import rasterio
    from rasterio.windows import Window, from_bounds

    west, south, east, north = bounds
    dlat = radius_km / 110.574
    dlng = radius_km / (111.320 * max(0.01, math.cos(math.radians(lat))))
    box = (
        max(west, lng - dlng),
        max(south, lat - dlat),
        min(east, lng + dlng),
        min(north, lat + dlat),
    )
    if box[2] <= box[0] or box[3] <= box[1]:
        return 0.0
    with rasterio.open(path) as src:
        raster = src.bounds
        if box[2] <= raster.left or box[0] >= raster.right or box[3] <= raster.bottom or box[1] >= raster.top:
            return 0.0
        try:
            window = from_bounds(*box, transform=src.transform).intersection(Window(0, 0, src.width, src.height))
        except rasterio.errors.WindowError:
            return 0.0
        window = window.round_offsets(op="floor").round_lengths(op="ceil")
        window = window.intersection(Window(0, 0, src.width, src.height))
        if window.width < 1 or window.height < 1:
            return 0.0
        grid = src.read(1, window=window)
        affine = src.window_transform(window)
    transform = (affine.a, affine.b, affine.c, affine.d, affine.e, affine.f)
    return people_in_radius(grid, transform, radius_km, lat, lng)


def population_near(lat: float, lng: float, radius_km: float, cache: Path = _CACHE) -> float | None:
    """People inside the radius, or None when a needed tile is not published."""
    total = 0.0
    for row, col in tiles_covering(lat, lng, radius_km):
        path = ensure_tile(cache, row, col)
        if path is None:
            return None
        total += _sum_tile(path, lat, lng, radius_km, tile_bounds(row, col))
    return total


def main() -> None:
    from db import database_configured, database_url, load_repo_env

    load_repo_env()
    if not database_configured():
        print("DATABASE_URL is empty. Set it in .env, then run: python -m jobs.ingest.exposure")
        raise SystemExit(1)
    import psycopg

    categories = list(RADII_KM)
    scored = 0
    skipped = 0
    with psycopg.connect(database_url(), connect_timeout=20) as conn:
        with conn.cursor() as cur:
            cur.execute(_HAZARD_SQL, (categories,))
            rows = cur.fetchall()
            for row in rows:
                event_id, category, lat, lng = row[0], row[1], row[2], row[3]
                radius = RADII_KM[category]
                attrs = _attrs_from_row(category, row)
                if intensity(category, attrs) is None or lat is None or lng is None:
                    skipped += 1
                    continue
                people = population_near(float(lat), float(lng), radius)
                if people is None:
                    print(f"skip {event_id}: GHSL tile not published")
                    skipped += 1
                    continue
                scored_row = score_hazard(category, attrs, people, radius)
                if scored_row is None:
                    skipped += 1
                    continue
                cur.execute(
                    _UPSERT,
                    (
                        event_id,
                        scored_row["people_exposed"],
                        scored_row["radius_km"],
                        scored_row["intensity"],
                        scored_row["impact_score"],
                        scored_row["impact_class"],
                        scored_row["exposure_source"],
                    ),
                )
                scored += 1
                print(
                    f"{event_id}: {scored_row['impact_class']} "
                    f"({scored_row['people_exposed']} people within {radius:.0f} km)"
                )
        conn.commit()
    print(f"Exposure scores written: {scored}. Skipped: {skipped}.")


if __name__ == "__main__":
    main()
