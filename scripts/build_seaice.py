"""Fetch the Sea Ice Index series and build the sea-ice bundle.

    uv run python scripts/build_seaice.py [--refresh]

Output:
  public/data/seaice.json

Source: NSIDC/NOAA Sea Ice Index (G02135) monthly extent and area, served as CSV
timeseries by NOAA's Physical Sciences Laboratory, two files per hemisphere, no
Earthdata account. The same index is published by NSIDC as 24 per-month CSVs;
that host throttles a bulk fetch (mixed 500s, then connection refusals after ~30
rapid requests), and series with identical provenance are the better dependency
for a build that has to be reproducible.

Two measures come out of it:
  SEAICE      extent, 10⁶ km², the area with at least 15% ice cover
  SEAICECONC  concentration, %, 100 × ice area ÷ extent, the mean concentration
              of the ice-covered area (area weights each cell by its ice fraction)

The app's contract is annual means only, so the twelve monthly values for a year
are averaged into one number. Averaging deliberately hides the seasonal cycle
(the Arctic loses ice every September and refreezes by March); the case report
says so rather than letting one line imply a flat twelve-month record.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.statistics import benjamini_hochberg, compute_trend

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "data"
CACHE = ROOT / "data" / "cache" / "seaice"
OUT = PUBLIC / "seaice.json"

PSL = "https://psl.noaa.gov/data/timeseries/month/data"
USER_AGENT = "signal-and-noise/0.1 (NASA Space Apps data build)"
START = 1990
END = 2025
WINDOWS = [(1990, 2025, "1990-2025"), (2000, 2025, "2000-2025"), (2010, 2025, "2010-2025")]
BH_Q = 0.05

VARIABLES = {
    "SEAICE": {
        "label": "Sea ice extent",
        "units": "10⁶ km²",
        "definition": "area with at least 15% ice cover",
        "rate": "million km² per decade",
    },
    "SEAICECONC": {
        "label": "Sea ice concentration",
        "units": "%",
        "definition": "100 × ice area ÷ extent: the mean concentration of the ice-covered area",
        "rate": "percentage points per decade",
    },
}

# Two hemispheres and their sum form one family per measure: unlike the ocean
# aggregate this is a genuine decomposition (arctic + antarctic = global), so all
# three are corrected together and each keeps its own q. Extent and concentration
# are separate families because they are separate measures, not cells of one.
HEMISPHERES = [
    {
        "id": "arctic-sea-ice",
        "name": "Arctic sea ice",
        "extent_file": "n_iceextent.mon.csv",
        "area_file": "n_icearea.mon.csv",
        "lat": 84.0,
        "lon": 0.0,
        "aliases": ["arctic sea ice", "arctic ice", "sea ice in the arctic", "northern sea ice"],
    },
    {
        "id": "antarctic-sea-ice",
        "name": "Antarctic sea ice",
        "extent_file": "s_iceextent.mon.csv",
        "area_file": "s_icearea.mon.csv",
        "lat": -74.0,
        "lon": 0.0,
        "aliases": ["antarctic sea ice", "antarctic ice", "sea ice in the antarctic", "southern sea ice"],
    },
]

COMBINED = {
    "id": "global-sea-ice",
    "name": "Global sea ice",
    "lat": 70.0,
    "lon": 0.0,
    "aliases": ["global sea ice", "sea ice", "polar sea ice", "world sea ice", "total sea ice"],
}

MISSING = -9999.0


def download(filename: str, refresh: bool) -> Path:
    path = CACHE / filename
    if path.exists() and not refresh:
        return path
    CACHE.mkdir(parents=True, exist_ok=True)
    url = f"{PSL}/{filename}"
    last: Exception | None = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = response.read()
            if b"Date" not in payload[:120]:
                raise RuntimeError(f"{url} did not return the PSL timeseries CSV")
            path.write_bytes(payload)
            return path
        except Exception as error:  # noqa: BLE001 - retried below, then raised
            last = error
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"could not download {url}: {last}")


def read_monthly(path: Path) -> dict[tuple[int, int], float]:
    """(year, month) -> value in 10⁶ km². The first line is a comment."""

    values: dict[tuple[int, int], float] = {}
    for index, line in enumerate(path.read_text().splitlines()):
        if index == 0 or not line.strip():
            continue
        cells = [cell.strip() for cell in line.split(",")]
        if len(cells) < 2:
            continue
        date = cells[0]
        try:
            year = int(date[0:4])
            month = int(date[5:7])
            value = float(cells[1])
        except ValueError:
            continue
        if not math.isfinite(value) or value <= MISSING:
            continue
        values[(year, month)] = value
    return values


def annual_means(monthly: dict[tuple[int, int], float], years: list[int]) -> list[float | None]:
    series: list[float | None] = []
    for year in years:
        present = [monthly[(year, month)] for month in range(1, 13) if (year, month) in monthly]
        # A year counts only with all twelve months: a mean of ten months would
        # move with which months are missing, not with the ice.
        series.append(round(sum(present) / 12, 4) if len(present) == 12 else None)
    return series


def concentration(area: list[float | None], extent: list[float | None]) -> list[float | None]:
    """100 × area ÷ extent, per year. Needs both means for that year."""

    series: list[float | None] = []
    for index, value in enumerate(extent):
        covered = area[index]
        if not isinstance(value, (int, float)) or not isinstance(covered, (int, float)) or value <= 0:
            series.append(None)
            continue
        series.append(round(100 * covered / value, 3))
    return series


def build_record(spec: dict[str, Any], series: dict[str, list[float | None]], years: list[int]) -> dict[str, Any]:
    trends: dict[str, Any] = {}
    for code, values in series.items():
        pairs = [
            (years[index], value)
            for index, value in enumerate(values)
            if isinstance(value, (int, float)) and math.isfinite(value)
        ]
        windows: dict[str, Any] = {}
        for window_start, window_end, key in WINDOWS:
            window_pairs = [(year, value) for year, value in pairs if window_start <= year <= window_end]
            windows[key] = compute_trend(
                [year for year, _ in window_pairs], [value for _, value in window_pairs]
            )
        trends[code] = windows

    return {
        "id": spec["id"],
        "name": spec["name"],
        "aliases": sorted({alias.lower() for alias in spec["aliases"]}),
        "lat": spec["lat"],
        "lon": spec["lon"],
        "months": 12,
        "series": series,
        "trends": trends,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="re-download the cached CSVs")
    args = parser.parse_args()

    years = list(range(START, END + 1))
    records: list[dict[str, Any]] = []
    sums: dict[str, dict[str, list[float | None]]] = {"area": {}, "extent": {}}

    for spec in HEMISPHERES:
        print(f"· {spec['name']}")
        extent = annual_means(read_monthly(download(spec["extent_file"], args.refresh)), years)
        area = annual_means(read_monthly(download(spec["area_file"], args.refresh)), years)
        complete = sum(1 for value in extent if value is not None) + sum(
            1 for value in area if value is not None
        )
        if complete < 40:
            raise RuntimeError(f"{spec['name']} has only {complete} complete hemisphere-years in {START}–{END}")
        conc = concentration(area, extent)
        sums["extent"][spec["id"]] = extent
        sums["area"][spec["id"]] = area
        records.append(build_record(spec, {"SEAICE": extent, "SEAICECONC": conc}, years))
        print(
            f"  36/{len(years)} years · extent {extent[0]}→{extent[-1]} · "
            f"concentration {conc[0]}%→{conc[-1]}%"
        )

    # Global sea ice is the sum of the two hemispheres, year by year; global
    # concentration is the ratio of the summed areas, never the mean of the two
    # hemispheric percentages (11.7 + 11.4 million km² do not average to 50%).
    north = sums["extent"]["arctic-sea-ice"]
    south = sums["extent"]["antarctic-sea-ice"]
    north_area = sums["area"]["arctic-sea-ice"]
    south_area = sums["area"]["antarctic-sea-ice"]
    combined_extent = [
        round(north[index] + south[index], 4)
        if isinstance(north[index], (int, float)) and isinstance(south[index], (int, float))
        else None
        for index in range(len(years))
    ]
    combined_area = [
        round(north_area[index] + south_area[index], 4)
        if isinstance(north_area[index], (int, float)) and isinstance(south_area[index], (int, float))
        else None
        for index in range(len(years))
    ]
    records.append(
        build_record(
            COMBINED,
            {"SEAICE": combined_extent, "SEAICECONC": concentration(combined_area, combined_extent)},
            years,
        )
    )

    for code in VARIABLES:
        for _, _, key in WINDOWS:
            refs = [record for record in records if record["trends"][code].get(key)]
            q_values, significant = benjamini_hochberg(
                [record["trends"][code][key]["p_value"] for record in refs], q=BH_Q
            )
            for record, q_value, is_significant in zip(refs, q_values, significant):
                trend = record["trends"][code][key]
                # Twelve decimals: the Arctic p is ~1e-12, and rounding q to nine
                # would store 0 for a value that is not zero.
                trend["q_value"] = round(float(q_value), 12)
                trend["significant"] = bool(is_significant)

    payload = {
        "meta": {
            "source": "NSIDC/NOAA Sea Ice Index (G02135) monthly extent and area, via NOAA PSL timeseries",
            "dataset": "G02135",
            "urls": [
                f"{PSL}/{spec[file]}"
                for spec in HEMISPHERES
                for file in ("extent_file", "area_file")
            ],
            "start_year": START,
            "end_year": END,
            "years": years,
            "windows": [key for _, _, key in WINDOWS],
            "months": 12,
            "variables": VARIABLES,
            "family": f"Benjamini–Hochberg q = {BH_Q} across the three records, separately per measure",
            "label": "sea ice",
            "note": (
                "Annual mean of the twelve monthly values; the seasonal cycle is averaged, not shown. "
                "Concentration is 100 × ice area ÷ extent."
            ),
        },
        "records": records,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))

    print(f"· wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")
    for code, variable in VARIABLES.items():
        print(f"· {variable['label']} ({variable['units']})")
        for record in records:
            trend = record["trends"][code]["1990-2025"]
            print(
                f"  {record['name']:<20} {trend['slope_per_decade']:+.3f} {variable['rate']} · "
                f"p {trend['p_value']:.4f} · q {trend['q_value']:.3g} · {trend['verdict']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
