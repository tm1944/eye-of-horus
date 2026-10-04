"""Average a satellite image's color inside each country polygon.

Usage: python3 scripts/build-country-colors.py <equirectangular.bmp> > src/data/country-colors.json

The input is a 24-bit, uncompressed BMP covering longitude -180..180 (left to right)
and latitude 90..-90 (top to bottom). Convert a JPEG with macOS `sips`:
  sips -s format bmp land_shallow_topo_2048.jpg --out blue_marble.bmp
Source used: NASA Earth Observatory "Blue Marble" land_shallow_topo_2048.jpg
(https://visibleearth.nasa.gov/images/57752), public domain.
"""
import json
import struct
import sys
from pathlib import Path

COUNTRIES = Path(__file__).resolve().parent.parent / "src/data/countries.geojson.json"


def read_bmp(path: str):
    data = Path(path).read_bytes()
    offset = struct.unpack_from("<I", data, 10)[0]
    width, height = struct.unpack_from("<ii", data, 18)
    bits, compression = struct.unpack_from("<H", data, 28)[0], struct.unpack_from("<I", data, 30)[0]
    if bits != 24 or compression != 0:
        sys.exit("expected an uncompressed 24-bit BMP")
    stride = (width * 3 + 3) & ~3
    top_down = height < 0
    height = abs(height)

    def pixel(x: int, y: int) -> tuple[int, int, int]:
        row = y if top_down else height - 1 - y
        i = offset + row * stride + x * 3
        return data[i + 2], data[i + 1], data[i]  # BGR -> RGB

    return width, height, pixel


def is_ocean(r: int, g: int, b: int) -> bool:
    # Blue Marble's deep ocean is dark navy; coastlines rarely align pixel-perfectly.
    return b > r + 25 and b > g + 25 and r + g + b < 260


def polygons(feature: dict) -> list[list[list[list[float]]]]:
    geometry = feature["geometry"]
    return [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]


def pixels_inside(polygon: list[list[list[float]]], width: int, height: int):
    """Scanline fill with the even-odd rule, so holes are excluded."""
    edges = [(ring[i - 1], ring[i]) for ring in polygon for i in range(len(ring))]
    lats = [point[1] for ring in polygon for point in ring]
    top = max(0, int((90 - max(lats)) / 180 * height))
    bottom = min(height - 1, int((90 - min(lats)) / 180 * height) + 1)
    for y in range(top, bottom + 1):
        lat = 90 - (y + 0.5) * 180 / height
        crossings = sorted(
            ax + (lat - ay) * (bx - ax) / (by - ay)
            for (ax, ay), (bx, by) in edges
            if (ay > lat) != (by > lat)
        )
        for start, end in zip(crossings[0::2], crossings[1::2]):
            first = max(0, int((start + 180) / 360 * width - 0.5) + 1)
            last = min(width - 1, int((end + 180) / 360 * width - 0.5))
            for x in range(first, last + 1):
                yield x, y


def centroid_pixel(feature: dict, width: int, height: int) -> tuple[int, int]:
    ring = max((polygon[0] for polygon in polygons(feature)), key=len)
    lng = sum(point[0] for point in ring) / len(ring)
    lat = sum(point[1] for point in ring) / len(ring)
    return min(width - 1, int((lng + 180) / 360 * width)), min(height - 1, int((90 - lat) / 180 * height))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    width, height, pixel = read_bmp(sys.argv[1])
    features = json.loads(COUNTRIES.read_text())["features"]
    colors = {}
    for feature in features:
        samples = [pixel(x, y) for polygon in polygons(feature) for x, y in pixels_inside(polygon, width, height)]
        land = [rgb for rgb in samples if not is_ocean(*rgb)] or samples
        if not land:  # smaller than a pixel at this resolution
            land = [pixel(*centroid_pixel(feature, width, height))]
        r, g, b = (round(sum(channel) / len(land)) for channel in zip(*land))
        colors[feature["id"]] = f"#{r:02x}{g:02x}{b:02x}"
    json.dump(dict(sorted(colors.items())), sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
