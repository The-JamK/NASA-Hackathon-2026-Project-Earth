"""Build the ocean bundles from the committed GISTEMP grid.

    uv run python scripts/build_ocean.py

Outputs:
  public/data/grid.json   (adds is_ocean per cell, and ocean counts in meta)
  public/data/ocean.json  (region means, trends, extent and aliases)

Why regions rather than points: the trend field already draws every GISTEMP cell
over water as well as land. An ocean "station" would duplicate that field as
clutter, so the ocean is presented the way countries are, as a place you ask
about, averaged from the cells inside it.

The means are weighted by cos(lat): each 4° cell covers less ground toward the
poles, so an unweighted mean would let Arctic cells outweigh tropical ones.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.landmask import classify, load_rings
from scripts.statistics import benjamini_hochberg, compute_trend

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "data"
GRID = PUBLIC / "grid.json"
OCEAN = PUBLIC / "ocean.json"

START = 1990
END = 2025
WINDOWS = [(1990, 2025, "1990-2025"), (2000, 2025, "2000-2025"), (2010, 2025, "2010-2025")]
BH_Q = 0.05

# Disjoint basins partition the ocean, so the family correction covers each cell
# once. `global` is an aggregate over all of them and is therefore not part of the
# family, its q is left null rather than borrowed from the basins.
BASINS: list[dict[str, Any]] = [
    {
        "id": "north-pacific",
        "name": "North Pacific",
        "aliases": ["north pacific", "northern pacific"],
        "lat": (20, 66),
        "lon": (120, 140), # 120°E eastward 140° to 100°W: the basin crosses the dateline
        "extent": "20–66°N, 120°E–100°W",
    },
    {
        "id": "tropical-pacific",
        "name": "Tropical Pacific",
        "aliases": ["tropical pacific", "central pacific", "east pacific", "pacific", "nino", "niño", "el nino", "el niño"],
        "lat": (-20, 20),
        "lon": (150, 130), # 150°E eastward 130° to 80°W
        "extent": "20°S–20°N, 150°E–80°W",
    },
    {
        "id": "south-pacific",
        "name": "South Pacific",
        "aliases": ["south pacific", "southern pacific"],
        "lat": (-55, -20),
        "lon": (150, 140), # 150°E eastward 140° to 70°W
        "extent": "55–20°S, 150°E–70°W",
    },
    {
        "id": "north-atlantic",
        "name": "North Atlantic",
        # A bare basin name goes to its largest basin by cell count, so "the
        # Atlantic" is the North Atlantic (178 cells) rather than a coin flip.
        "aliases": ["north atlantic", "northern atlantic", "atlantic"],
        "lat": (20, 66),
        "lon": (-80, 80), # 80°W eastward to 0°
        "extent": "20–66°N, 80°W–0°",
    },
    {
        "id": "south-atlantic",
        "name": "South Atlantic",
        "aliases": ["south atlantic", "southern atlantic"],
        "lat": (-55, -20),
        "lon": (-60, 80), # 60°W eastward to 20°E
        "extent": "55–20°S, 60°W–20°E",
    },
    {
        "id": "indian-ocean",
        "name": "Indian Ocean",
        "aliases": ["indian ocean", "indian"],
        "lat": (-55, 25),
        "lon": (20, 100), # 20°E eastward to 120°E
        "extent": "55°S–25°N, 20–120°E",
    },
    {
        "id": "southern-ocean",
        "name": "Southern Ocean",
        "aliases": ["southern ocean", "antarctic ocean", "south ocean"],
        "lat": (-75, -55),
        "lon": (-180, 360),
        "extent": "75–55°S, all longitudes",
    },
    {
        "id": "arctic-ocean",
        "name": "Arctic Ocean",
        "aliases": ["arctic ocean"],
        "lat": (66, 90),
        "lon": (-180, 360),
        "extent": "north of 66°N",
    },
]

GLOBAL_OCEAN = {
    "id": "global-ocean",
    "name": "Global ocean",
    "aliases": ["global ocean", "world ocean", "the ocean", "ocean", "sea surface"],
    "lat": (-90, 90),
    "lon": (-180, 360),
    "extent": "every ocean cell on the globe",
}


def in_bounds(lat: float, lon: float, bounds: dict[str, Any]) -> bool:
    low, high = bounds["lat"]
    if not low <= lat <= high:
        return False
    start, span = bounds["lon"]
    # Longitudes run -179…177; a Pacific box is a wrapped span, not a min/max.
    return (lon - start) % 360 <= span


def members(cells: list[dict[str, Any]], bounds: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        cell
        for cell in cells
        if cell.get("is_ocean") and in_bounds(float(cell["lat"]), float(cell["lon"]), bounds)
    ]


def area_weight(lat: float) -> float:
    return math.cos(math.radians(lat))


def region_series(cells: list[dict[str, Any]], years: list[int]) -> list[float | None]:
    series: list[float | None] = []
    for index in range(len(years)):
        total = 0.0
        weight_sum = 0.0
        for cell in cells:
            values = cell.get("values") or []
            if index >= len(values):
                continue
            value = values[index]
            if not isinstance(value, (int, float)) or not math.isfinite(value):
                continue
            weight = area_weight(float(cell["lat"]))
            total += value * weight
            weight_sum += weight
        series.append(round(total / weight_sum, 4) if weight_sum else None)
    return series


def region_centroid(cells: list[dict[str, Any]]) -> tuple[float, float]:
    """Weighted circular mean, so a Pacific region does not centroid at 0°E."""

    weight_sum = 0.0
    lat_sum = 0.0
    x_sum = 0.0
    y_sum = 0.0
    for cell in cells:
        lat = float(cell["lat"])
        weight = area_weight(lat)
        weight_sum += weight
        lat_sum += lat * weight
        radians = math.radians(float(cell["lon"]))
        x_sum += math.cos(radians) * weight
        y_sum += math.sin(radians) * weight
    if not weight_sum:
        return 0.0, 0.0
    return round(lat_sum / weight_sum, 2), round(math.degrees(math.atan2(y_sum, x_sum)), 2)


def build_region(spec: dict[str, Any], cells: list[dict[str, Any]], years: list[int]) -> dict[str, Any] | None:
    chosen = members(cells, spec)
    if not chosen:
        return None
    series = region_series(chosen, years)
    pairs = [
        (years[index], value)
        for index, value in enumerate(series)
        if isinstance(value, (int, float)) and math.isfinite(value)
    ]
    if len(pairs) < 20:
        return None

    trends: dict[str, Any] = {}
    for window_start, window_end, key in WINDOWS:
        window_pairs = [(year, value) for year, value in pairs if window_start <= year <= window_end]
        trends[key] = compute_trend([year for year, _ in window_pairs], [value for _, value in window_pairs])

    lat, lon = region_centroid(chosen)
    return {
        "id": spec["id"],
        "name": spec["name"],
        "aliases": sorted({alias.lower() for alias in spec["aliases"]}),
        "lat": lat,
        "lon": lon,
        "cells": len(chosen),
        "extent": spec["extent"],
        "lat_bounds": list(spec["lat"]),
        "lon_bounds": list(spec["lon"]),
        "series": {"GISTEMP": series},
        "trends": {"GISTEMP": trends},
    }


def main() -> int:
    grid = json.loads(GRID.read_text())
    cells = grid["cells"]
    years = list(grid["meta"]["years"])

    print(f"· land mask · {len(cells):,} cells")
    rings = load_rings()
    ocean = classify(cells, rings)
    print(f"  ocean cells {ocean:,} · land cells {len(cells) - ocean:,}")

    regions: list[dict[str, Any]] = []
    for spec in BASINS:
        region = build_region(spec, cells, years)
        if region:
            region["family"] = "basins"
            regions.append(region)
        else:
            print(f"  skipped {spec['name']}: too few complete years")

    # One family correction across the disjoint basins, at each window.
    for _, _, key in WINDOWS:
        refs = [region for region in regions if region["trends"]["GISTEMP"].get(key)]
        if not refs:
            continue
        q_values, significant = benjamini_hochberg(
            [region["trends"]["GISTEMP"][key]["p_value"] for region in refs], q=BH_Q
        )
        for region, q_value, is_significant in zip(refs, q_values, significant):
            trend = region["trends"]["GISTEMP"][key]
            # Nine decimals, not six: a basin p of 4.6e-8 must not round its q
            # down to zero, which would read as a smaller q than p.
            trend["q_value"] = round(float(q_value), 9)
            trend["significant"] = bool(is_significant)

    aggregate = build_region(GLOBAL_OCEAN, cells, years)
    if aggregate:
        aggregate["family"] = "aggregate"
        # Not part of the basin family: it shares the basins' cells, so a family
        # correction across it would count every cell twice. Its q stays null and
        # the case report says so instead of borrowing a number.
        for _, _, key in WINDOWS:
            trend = aggregate["trends"]["GISTEMP"].get(key)
            if trend:
                trend["q_value"] = None
                trend["significant"] = bool(trend.get("p_value", 1) < BH_Q)
        regions.append(aggregate)

    ocean_counts = grid["meta"].setdefault("counts", {})
    ocean_counts["ocean_cells"] = ocean
    ocean_counts["land_cells"] = len(cells) - ocean
    grid["meta"]["ocean_cells"] = ocean
    grid["meta"]["land_mask"] = "Natural Earth 1:10m countries, cell-centre test"
    GRID.write_text(json.dumps(grid, separators=(",", ":")))

    payload = {
        "meta": {
            "source": "NASA GISTEMP v4 gridded anomalies, ocean cells only",
            "start_year": START,
            "end_year": END,
            "years": years,
            "windows": [key for _, _, key in WINDOWS],
            "weighting": "cos(lat) area weight per cell",
            "family": f"Benjamini–Hochberg q = {BH_Q} across the {len(BASINS)} basins",
            "label": "sea surface temperature",
        },
        "regions": regions,
    }
    OCEAN.write_text(json.dumps(payload, separators=(",", ":")))

    print(f"· ocean regions · {len(regions)}")
    for region in regions:
        trend = region["trends"]["GISTEMP"]["1990-2025"]
        print(
            f"  {region['name']:<17} {region['cells']:>4} cells · "
            f"{trend['slope_per_decade']:+.3f} °C/decade · p {trend['p_value']:.3f} · "
            f"verdict {trend['verdict']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
