"""Land/ocean raster for the 4° grid, from the cached Natural Earth polygons.

The GISTEMP file ships anomalies only — no land mask — so an ocean region needs
its own coastline test. Natural Earth's 10m countries shapefile is already
cached beside the populated-places table, and countries are land: a cell whose
centre falls outside every polygon is water.

Parsed with the standard library, in the same spirit as the DBF tables in
build_cities, so the build keeps no shapefile or geopandas dependency.
"""

from __future__ import annotations

import struct
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SHP_ZIP = ROOT / "data" / "cache" / "naturalearth" / "ne_10m_admin_0_countries.zip"
SHP_NAME = "ne_10m_admin_0_countries.shp"


def load_rings(path: Path = SHP_ZIP, name: str = SHP_NAME) -> list[tuple[float, float, float, float, tuple[float, ...], tuple[float, ...]]]:
    """Every polygon ring as (min_lon, min_lat, max_lon, max_lat, xs, ys)."""

    with zipfile.ZipFile(path) as archive:
        data = archive.read(name)

    rings: list[Any] = []
    offset = 100  # shapefile header
    while offset + 8 <= len(data):
        _, content_length = struct.unpack(">ii", data[offset : offset + 8])
        offset += 8
        body = data[offset : offset + content_length * 2]
        offset += content_length * 2
        if len(body) < 44:
            continue
        shape_type = struct.unpack("<i", body[0:4])[0]
        if shape_type != 5:  # polygon only; null records carry nothing to test
            continue
        num_parts, num_points = struct.unpack("<ii", body[36:44])
        parts = struct.unpack(f"<{num_parts}i", body[44 : 44 + 4 * num_parts])
        start = 44 + 4 * num_parts
        flat = struct.unpack(f"<{num_points * 2}d", body[start : start + 16 * num_points])
        for index, first in enumerate(parts):
            last = parts[index + 1] if index + 1 < len(parts) else num_points
            if last - first < 4:
                continue
            xs = flat[first * 2 : last * 2 : 2]
            ys = flat[first * 2 + 1 : last * 2 : 2]
            rings.append((min(xs), min(ys), max(xs), max(ys), xs, ys))
    return rings


def is_land(lat: float, lon: float, rings: list[tuple[float, float, float, float, tuple[float, ...], tuple[float, ...]]]) -> bool:
    """Even-odd point-in-polygon across all rings, so lake holes read as water.

    Bounding boxes skip almost every ring before the edge loop, which is what
    makes 4,050 cells against a 10m coastline a few seconds rather than minutes.
    """

    crossings = 0
    for min_lon, min_lat, max_lon, max_lat, xs, ys in rings:
        if lon < min_lon or lon > max_lon or lat < min_lat or lat > max_lat:
            continue
        previous = len(xs) - 1
        for index in range(len(xs)):
            x_i, y_i = xs[index], ys[index]
            x_j, y_j = xs[previous], ys[previous]
            if (y_i > lat) != (y_j > lat):
                intersect = (x_j - x_i) * (lat - y_i) / (y_j - y_i) + x_i
                if lon < intersect:
                    crossings += 1
            previous = index
    return crossings % 2 == 1


def classify(cells: list[dict[str, Any]], rings=None) -> int:
    """Stamp is_ocean on every cell in place; returns how many are water."""

    rings = rings if rings is not None else load_rings()
    ocean = 0
    for cell in cells:
        water = not is_land(float(cell["lat"]), float(cell["lon"]), rings)
        cell["is_ocean"] = water
        ocean += int(water)
    return ocean
