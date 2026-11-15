"""Verify the shipped data bundle without touching the network."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "data"

if __package__ in (None, ""):
    sys.path.insert(0, str(ROOT))

from scripts import points_bundle  # noqa: E402

POINT_CODES = ("T2M", "PRECTOTCORR", "GWETROOT", "ALLSKY_SFC_SW_DWN")
WINDOWS = ("1990-2025", "2000-2025", "2010-2025")


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def read(name: str) -> dict:
    path = PUBLIC / name
    if not path.exists():
        fail(f"missing {name}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"{name} is not valid JSON: {error}")
    return {}


def close(actual: float, expected: float, tolerance: float = 1e-6) -> bool:
    return math.isfinite(actual) and abs(actual - expected) <= tolerance


def main() -> int:
    variables = read("variables.json")
    # The station bundle is an index plus detail shards; this check recomputes
    # every trend, so it needs the merged records.
    points_payload = points_bundle.load_bundle(PUBLIC)
    grid = read("grid.json")
    rag = read("rag_index.json")
    sources = read("sources.json")

    variables_list = variables.get("variables", [])
    if len([v for v in variables_list if v.get("kind") == "point"]) < 4:
        fail("expected four point variables")
    if not any(v.get("code") == "GISTEMP" for v in variables_list):
        fail("missing the GISTEMP variable")
    if any(not v.get("keywords") for v in variables_list):
        fail("every variable needs retrieval keywords")

    points = points_payload.get("points", [])
    if len(points) < 25:
        fail(f"expected at least 25 points, found {len(points)}")
    if len(grid.get("cells", [])) < 2_000:
        fail(f"expected at least 2,000 grid cells, found {len(grid.get('cells', []))}")
    if len(rag.get("docs", [])) < 5:
        fail("retrieval index is missing variable documents")
    if len(rag.get("places", [])) < len(points):
        fail("retrieval index is missing places")

    expected_sources = {"earthdata", "planetary", "power", "meteomatics", "gistemp", "blue-marble"}
    source_map = {source.get("id"): source for source in sources.get("sources", [])}
    if set(source_map) != expected_sources:
        fail(f"unexpected source set: {sorted(source_map)}")
    if any(source.get("status") != "ok" for source in source_map.values()):
        fail("one or more live source checks are not ok")
    if "gibs" in source_map:
        fail("stale GIBS source is still present")

    featured = [point for point in points if point.get("featured")]
    if len(featured) < 10:
        fail(f"expected at least 10 featured points, found {len(featured)}")
    live = [point for point in points if point.get("live")]
    if len(live) < 5:
        fail(f"expected at least 5 live points, found {len(live)}")
    imagery = [point for point in points if point.get("imagery")]
    if len(imagery) < 10:
        fail(f"expected at least 10 context images, found {len(imagery)}")

    for point in points:
        for code, windows in point.get("trends", {}).items():
            for window, trend in windows.items():
                if not trend:
                    continue
                corrected = trend.get("mk_p_corrected")
                if not isinstance(corrected, (int, float)):
                    fail(f"{point.get('id')} {code} {window} has no corrected Mann-Kendall p-value")
                both = trend["p_value"] < 0.05 and corrected < 0.05
                significant = trend.get("verdict", "").startswith("significant")
                if significant and not both:
                    fail(f"{point.get('id')} {code} {window} claims a trend without both tests")
                if both and trend.get("verdict") == "no significant trend":
                    signs = (trend["slope_per_decade"] > 0) == (trend["mk_tau"] > 0)
                    if signs:
                        fail(f"{point.get('id')} {code} {window} passed both tests but is not proven")

        usable_variables = 0
        for code in POINT_CODES:
            series = point.get("series", {}).get(code)
            if not series or len(series) != 36:
                fail(f"{point.get('id')} {code} series is not 36 annual values")
            finite = [value for value in series if isinstance(value, (int, float)) and math.isfinite(value)]
            if len(finite) >= 30:
                usable_variables += 1
            for window in WINDOWS:
                trend = point.get("trends", {}).get(code, {}).get(window)
                if len(finite) >= 20 and not trend:
                    fail(f"{point.get('id')} {code} {window} trend is missing")
                if trend and window == "1990-2025" and trend.get("n") != len(finite):
                    fail(f"{point.get('id')} {code} 1990 trend has the wrong sample size")
        if usable_variables < 3:
            fail(f"{point.get('id')} has fewer than three usable variables")
        if not point.get("trends", {}).get("T2M", {}).get("1990-2025"):
            fail(f"{point.get('id')} has no temperature trend")

    for point in imagery:
        path = ROOT / "public" / point["imagery"].lstrip("/")
        if not path.exists() or path.stat().st_size < 5_000:
            fail(f"context image missing or too small for {point.get('id')}")

    for point in featured:
        meta = point.get("imagery_meta") or {}
        if meta.get("source_id") not in {"sentinel-2", "blue-marble"}:
            fail(f"{point.get('id')} has no source-labelled imagery")
        if not meta.get("label") or not meta.get("attribution"):
            fail(f"{point.get('id')} imagery has no label or attribution")
        if point.get("imagery") and meta.get("source_id") == "sentinel-2" and "sentinel" not in point["imagery"]:
            fail(f"{point.get('id')} Sentinel metadata points at the wrong file")
    if sum(1 for point in featured if (point.get("imagery_meta") or {}).get("source_id") == "sentinel-2") < 10:
        fail("fewer than 10 featured points use Sentinel-2 imagery")

    nairobi = next(point for point in points if point.get("id") == "nairobi")
    if not close(nairobi["trends"]["T2M"]["1990-2025"]["slope_per_decade"], 0.3129869154869154):
        fail("Nairobi fixture slope changed")

    mcmurdo = next(point for point in points if point.get("id") == "mcmurdo")
    mcmurdo_trend = mcmurdo["trends"]["T2M"]["1990-2025"]
    if mcmurdo_trend["p_value"] < 0.05 or mcmurdo_trend["slope_per_decade"] <= 0.25:
        fail("McMurdo is no longer the steep-but-unproven red herring")

    global_trend = grid.get("meta", {}).get("global", {}).get("trends", {}).get("1990-2025", {})
    if not close(global_trend.get("slope_per_decade", 0), 0.2361647361647351):
        fail("global fixture slope changed")
    if global_trend.get("maxlag") != 3:
        fail("global HAC lag is not the contract lag")
    counts = grid.get("meta", {}).get("counts_by_window", {}).get("1990-2025", {})
    if counts != {
        "cells": 4039,
        "significant_increasing": 3039,
        "significant_decreasing": 78,
        "not_significant": 922,
        "median_slope_per_decade": 0.2324,
    }:
        fail(f"grid counts changed: {counts}")

    print(f"points: {len(points)} · featured: {len(featured)} · live: {len(live)}")
    print(f"grid: {len(grid['cells'])} cells · global slope: {global_trend['slope_per_decade']:.4f}")
    print(f"sources: {', '.join(sorted(source_map))}")
    print("data verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
