"""Re-fit every published trend from the series the bundle actually ships.

The bundle ships series rounded to 4 dp (stations, countries, ocean, sea ice) and
3 dp (grid cells), but the build fitted the unrounded values. That made a bundle
that could not reproduce itself: Sen's slope, Kendall's tau, the Hamed-Rao
corrected Mann-Kendall p and the FDR q values all moved when a reader recomputed
them from the published series, and one borderline verdict moved with them,
jeddah / GWETROOT / 1990-2025 shipped as "significant increasing" on HAC
p = 0.0499968 and recomputes to p = 0.0508, which is not significant.

This pass re-derives every stored trend from the shipped series using the same
`scripts.statistics` contract the build uses, and rewrites the JSON only where a
number or a verdict actually moves. It is idempotent, so `--check` is a standing
proof that the published bundle reproduces its own numbers.

    uv run python scripts/refit_bundle.py            # repair in place
    uv run python scripts/refit_bundle.py --check    # verify, write nothing
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import points_bundle  # noqa: E402
from scripts.statistics import benjamini_hochberg, compute_trend  # noqa: E402

PUBLIC = ROOT / "public" / "data"
START = 1990
END = 2025
WINDOWS = [(1990, 2025, "1990-2025"), (2000, 2025, "2000-2025"), (2010, 2025, "2010-2025")]


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _save(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _pairs(values: Any, window_start: int, window_end: int) -> list[tuple[int, float]]:
    out: list[tuple[int, float]] = []
    if not isinstance(values, list):
        return out
    for offset, value in enumerate(values):
        year = START + offset
        if not window_start <= year <= window_end:
            continue
        if value is None or isinstance(value, bool):
            continue
        if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            continue
        out.append((year, float(value)))
    return out


def _fit(values: Any, window_start: int, window_end: int) -> dict[str, Any] | None:
    pairs = _pairs(values, window_start, window_end)
    if len(pairs) < 3:
        return None
    return compute_trend([year for year, _ in pairs], [value for _, value in pairs])


def _same(left: Any, right: Any) -> bool:
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def _same_trend(old: Any, new: dict[str, Any]) -> bool:
    """True when `old` already holds every number `compute_trend` produces.

    Fitted records also carry fields the fit does not own (`q_value`,
    `significant`, which the FDR step stamps on afterwards), so comparing the
    whole dictionary would report a difference on every record for ever.
    """
    return isinstance(old, dict) and all(old.get(key) == value for key, value in new.items())


def _merge(old: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    """Keep fields the caller owns (q_value, significant) and refresh the rest."""
    if not old:
        return new
    merged = dict(old)
    merged.update(new)
    return merged


class Report:
    def __init__(self, verbose: bool = True) -> None:
        self.changes: list[str] = []
        self.verbose = verbose

    def note(self, label: str) -> None:
        self.changes.append(label)
        if self.verbose and len(self.changes) <= 40:
            print(f"  · {label}")

    def verdict_change(self, where: str, old: Any, new: Any) -> None:
        self.note(f"{where}: verdict {old} -> {new}")


def refit_points(report: Report, check: bool) -> dict[str, Any]:
    merged = points_bundle.load_bundle(PUBLIC)
    touched = 0
    for point in merged.get("points", []):
        series_by_code = point.get("series") or {}
        trends = point.get("trends") or {}
        for code, series in series_by_code.items():
            for window_start, window_end, key in WINDOWS:
                old = (trends.get(code) or {}).get(key)
                new = _fit(series, window_start, window_end)
                if old is None and new is None:
                    continue
                if old is None or new is None:
                    touched += 1
                    report.note(f"{point.get('id')} {code} {key}: trend appeared or vanished")
                elif not _same(old, new):
                    touched += 1
                    if old.get("verdict") != new.get("verdict"):
                        report.verdict_change(f"{point.get('id')} {code} {key}", old.get("verdict"), new.get("verdict"))
                    elif len(report.changes) < 400:
                        report.note(f"{point.get('id')} {code} {key}: numbers move")
                if not check and not _same(old, new):
                    trends.setdefault(code, {})[key] = new
                    point["trends"] = trends
    if not check and touched:
        points_bundle.write_bundle(PUBLIC, merged)
    return {"dataset": "points", "touched": touched}


def refit_grid(report: Report, check: bool) -> dict[str, Any]:
    path = PUBLIC / "grid.json"
    grid = _load(path)
    cells = grid.get("cells", [])
    touched = 0
    window_keys = [key for _, _, key in WINDOWS]

    for cell in cells:
        values = cell.get("values")
        trends = cell.get("trends") or {}
        for window_start, window_end, key in WINDOWS:
            old = trends.get(key)
            new = _fit(values, window_start, window_end)
            if new is None:
                if old is not None:
                    touched += 1
                    report.note(f"cell {cell.get('lat')},{cell.get('lon')} {key}: trend vanished")
                    if not check:
                        trends[key] = None
                continue
            record = {
                "slope": round(new["slope_per_decade"], 4),
                "p": round(new["p_value"], 6),
                "n": new["n"],
                "ci_low": round(new["ci_low_per_decade"], 4),
                "ci_high": round(new["ci_high_per_decade"], 4),
                "sen": round(new["sen_slope_per_decade"], 4),
                "mk_tau": round(new["mk_tau"], 4),
                "r_squared": round(new["r_squared"], 4),
                "maxlag": new["maxlag"],
                "q": (old or {}).get("q"),
                "significant": (old or {}).get("significant", False),
            }
            if old is None or not _same({k: old.get(k) for k in record if k not in {"q", "significant"}},
                                        {k: record[k] for k in record if k not in {"q", "significant"}}):
                touched += 1
                if len(report.changes) < 400:
                    report.note(f"cell {cell.get('lat')},{cell.get('lon')} {key}: numbers move")
            if not check:
                trends[key] = record
        cell["trends"] = trends

    # FDR across each window, then the per-cell defaults the globe reads.
    for _, _, key in WINDOWS:
        refs = [cell for cell in cells if (cell.get("trends") or {}).get(key)]
        if not refs:
            continue
        q_values, flags = benjamini_hochberg([cell["trends"][key]["p"] for cell in refs], q=0.05)
        for cell, q_value, flag in zip(refs, q_values, flags):
            cell["trends"][key]["q"] = round(float(q_value), 6)
            cell["trends"][key]["significant"] = bool(flag)

    counts_by_window: dict[str, Any] = {}
    for _, _, key in WINDOWS:
        window_cells = [cell["trends"][key] for cell in cells if (cell.get("trends") or {}).get(key)]
        slopes = [item["slope"] for item in window_cells]
        counts_by_window[key] = {
            "cells": len(window_cells),
            "significant_increasing": sum(1 for item in window_cells if item.get("significant") and item["slope"] > 0),
            "significant_decreasing": sum(1 for item in window_cells if item.get("significant") and item["slope"] < 0),
            "not_significant": sum(1 for item in window_cells if not item.get("significant")),
            "median_slope_per_decade": round(float(np.median(slopes)), 4) if slopes else None,
        }

    for cell in cells:
        default = (cell.get("trends") or {}).get("1990-2025")
        if default:
            for key in ("slope", "p", "n", "q", "significant"):
                cell[key] = default[key]

    meta = grid.get("meta") or {}
    old_counts = meta.get("counts_by_window") or {}
    for _, _, key in WINDOWS:
        if not _same(old_counts.get(key), counts_by_window[key]):
            report.note(f"grid counts {key}: {old_counts.get(key, {}).get('significant_increasing')}"
                        f" -> {counts_by_window[key]['significant_increasing']} significant increases")

    # The global series is a weighted mean of the cells, shipped rounded; fit it
    # from what ships, exactly like everything else.
    global_block = meta.get("global") or {}
    global_series = global_block.get("series")
    global_trends: dict[str, Any] = {}
    for window_start, window_end, key in WINDOWS:
        global_trends[key] = _fit(global_series, window_start, window_end)
        old = (global_block.get("trends") or {}).get(key)
        if old and global_trends[key] and not _same(old, global_trends[key]):
            touched += 1
            report.note(f"global {key}: numbers move")

    if not check:
        meta["counts"] = counts_by_window["1990-2025"]
        meta["counts_by_window"] = counts_by_window
        meta["global"] = {**global_block, "trends": global_trends}
        # `total_grid_cells` used to report the candidate grid (4,050), which is
        # not the number of cells the app analyses (4,039): 11 cells have fewer
        # than 20 finite years and are dropped. Name both, and make the field the
        # app reads mean what it says.
        meta["candidate_grid_cells"] = meta.get("candidate_grid_cells", meta.get("total_grid_cells"))
        meta["total_grid_cells"] = len(cells)
        grid["meta"] = meta
        grid["cells"] = cells
        _save(path, grid)
    return {"dataset": "grid", "touched": touched, "counts": counts_by_window}


def refit_countries(report: Report, check: bool) -> dict[str, Any]:
    path = PUBLIC / "countries.json"
    payload = _load(path)
    countries = payload.get("countries", [])
    touched = 0

    for country in countries:
        series_by_code = country.get("series") or {}
        trends = country.get("trends") or {}
        for code, series in series_by_code.items():
            for window_start, window_end, key in WINDOWS:
                old = (trends.get(code) or {}).get(key)
                new = _fit(series, window_start, window_end)
                if new is None:
                    continue
                record = _merge(old, new)
                if not _same_trend(old, new):
                    touched += 1
                    if old and old.get("verdict") != new.get("verdict"):
                        report.verdict_change(f"{country.get('name')} {code} {key}", old.get("verdict"), new.get("verdict"))
                if not check:
                    trends.setdefault(code, {})[key] = record
        country["trends"] = trends

    for code in {code for country in countries for code in (country.get("trends") or {})}:
        for _, _, key in WINDOWS:
            refs = [c for c in countries if (c.get("trends") or {}).get(code, {}).get(key)]
            if not refs:
                continue
            q_values, flags = benjamini_hochberg([c["trends"][code][key]["p_value"] for c in refs], q=0.05)
            for country, q_value, flag in zip(refs, q_values, flags):
                country["trends"][code][key]["q_value"] = round(float(q_value), 6)
                country["trends"][code][key]["significant"] = bool(flag)

    if not check and touched:
        payload["countries"] = countries
        _save(path, payload)
    return {"dataset": "countries", "touched": touched}


def _refit_measure_block(report: Report, check: bool, entries: list[dict[str, Any]], label: str,
                         q_digits: int) -> int:
    """Ocean regions and sea-ice records: series[measure] -> trends[measure][window]."""
    touched = 0
    for entry in entries:
        series_by_measure = entry.get("series") or {}
        trends = entry.get("trends") or {}
        for measure, series in series_by_measure.items():
            for window_start, window_end, key in WINDOWS:
                old = (trends.get(measure) or {}).get(key)
                new = _fit(series, window_start, window_end)
                if new is None:
                    continue
                if not _same_trend(old, new):
                    touched += 1
                    if old and old.get("verdict") != new.get("verdict"):
                        report.verdict_change(f"{label} {entry.get('id')} {measure} {key}", old.get("verdict"), new.get("verdict"))
                if not check:
                    trends.setdefault(measure, {})[key] = _merge(old, new)
        entry["trends"] = trends

    for measure in {m for entry in entries for m in (entry.get("trends") or {})}:
        for _, _, key in WINDOWS:
            refs = [e for e in entries if (e.get("trends") or {}).get(measure, {}).get(key)]
            if not refs:
                continue
            # The aggregate shares the basins' cells, so it is not in the family:
            # its q is left null rather than borrowed from a basin, as built.
            family = [e for e in refs if e.get("family") != "aggregate"]
            wanted: dict[str, tuple[Any, bool]] = {}
            for entry in refs:
                wanted[str(entry.get("id"))] = (None, False)
            if family:
                q_values, flags = benjamini_hochberg([e["trends"][measure][key]["p_value"] for e in family], q=0.05)
                for entry, q_value, flag in zip(family, q_values, flags):
                    wanted[str(entry.get("id"))] = (round(float(q_value), q_digits), bool(flag))
            for entry in refs:
                trend = entry["trends"][measure][key]
                q_value, flag = wanted[str(entry.get("id"))]
                if trend.get("q_value") != q_value or bool(trend.get("significant")) != flag:
                    touched += 1
                if not check:
                    trend["q_value"] = q_value
                    trend["significant"] = flag
    return touched


def refit_ocean(report: Report, check: bool) -> dict[str, Any]:
    path = PUBLIC / "ocean.json"
    payload = _load(path)
    touched = _refit_measure_block(report, check, payload.get("regions", []), "ocean", 9)
    if not check and touched:
        _save(path, payload)
    return {"dataset": "ocean", "touched": touched}


def refit_seaice(report: Report, check: bool) -> dict[str, Any]:
    path = PUBLIC / "seaice.json"
    payload = _load(path)
    touched = _refit_measure_block(report, check, payload.get("records", []), "sea ice", 12)
    if not check and touched:
        _save(path, payload)
    return {"dataset": "sea ice", "touched": touched}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify only; write nothing")
    parser.add_argument("--quiet", action="store_true", help="summary only")
    args = parser.parse_args()

    report = Report(verbose=not args.quiet)
    print(("checking" if args.check else "refitting") + " the published bundle from its own series")
    results = [
        refit_points(report, args.check),
        refit_grid(report, args.check),
        refit_countries(report, args.check),
        refit_ocean(report, args.check),
        refit_seaice(report, args.check),
    ]

    total = sum(item["touched"] for item in results)
    for item in results:
        print(f"  {item['dataset']:<10} {item['touched']:>6} records differ")
    verdicts = sum(1 for change in report.changes if "verdict " in change)
    print(f"  verdicts   {verdicts:>6} changed")

    if args.check:
        if total:
            print(f"BUNDLE NOT SELF-CONSISTENT: {total} records differ from a refit from their own series")
            return 1
        print("BUNDLE SELF-CONSISTENT: every published trend reproduces from the published series")
        return 0

    print(f"refit complete: {total} records rewritten")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
