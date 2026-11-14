"""Build the Case Files data bundles from real cached sources.

    uv run python scripts/build_data.py --env-file ~/Desktop/.../.env

Outputs:
  public/data/variables.json
  public/data/points.json
  public/data/grid.json
  public/data/rag_index.json
  public/data/sources.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.envfile import load_env
from scripts.fetch_sources import (
    POWER_CODES,
    check_earthdata,
    check_planetary,
    fetch_meteomatics,
    fetch_power_point,
    load_gistemp_global,
    load_gistemp_grid,
)
from scripts.statistics import (
    annual_from_power,
    benjamini_hochberg,
    compute_trend,
    series_array,
)

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "data"
IMAGERY = PUBLIC / "imagery"
PUBLIC.mkdir(parents=True, exist_ok=True)
IMAGERY.mkdir(parents=True, exist_ok=True)

START = 1990
END = 2025
YEARS = list(range(START, END + 1))
WINDOWS = [(1990, 2025, "1990-2025"), (2000, 2025, "2000-2025"), (2010, 2025, "2010-2025")]

VARIABLES = [
    {
        "code": "T2M",
        "label": "Temperature at 2 m",
        "short": "Temperature",
        "units": "°C",
        "source": "NASA POWER (MERRA-2 derived)",
        "kind": "point",
        "baseline": "absolute temperature — no anomaly baseline",
        "description": "Annual mean air temperature two metres above the surface. Use for warming, heat, and cooling questions at a place.",
        "keywords": "temperature temp warming warmed warm heat hot cold climate air degrees",
        "supported": True,
    },
    {
        "code": "PRECTOTCORR",
        "label": "Precipitation (corrected)",
        "short": "Rainfall",
        "units": "mm/day",
        "source": "NASA POWER (MERRA-2 derived)",
        "kind": "point",
        "baseline": "absolute precipitation — no anomaly baseline",
        "description": "Annual mean precipitation rate. Use for rain, rainfall, drying, drought, and wetting questions at a place.",
        "keywords": "rain rainfall raining precipitation dry drier drying drought wet wetter monsoon storm water",
        "supported": True,
    },
    {
        "code": "GWETROOT",
        "label": "Root-zone soil wetness",
        "short": "Soil moisture",
        "units": "fraction",
        "source": "NASA POWER (MERRA-2 derived)",
        "kind": "point",
        "baseline": "absolute wetness fraction",
        "description": "Annual mean root-zone soil wetness. Use for soil moisture, agricultural drought, and land drying questions.",
        "keywords": "soil moisture wetness drought agriculture land dryness dry drier declining groundwater root zone",
        "supported": True,
    },
    {
        "code": "ALLSKY_SFC_SW_DWN",
        "label": "Surface solar irradiance",
        "short": "Solar radiation",
        "units": "kWh/m²/day",
        "source": "NASA POWER (MERRA-2 derived)",
        "kind": "point",
        "baseline": "absolute irradiance",
        "description": "Annual mean all-sky downward shortwave radiation at the surface. Use for sunlight, solar, cloudiness, and radiation questions.",
        "keywords": "solar sunlight radiation sunshine irradiance cloud cloudiness energy bright brighter dimmer",
        "supported": True,
    },
    {
        "code": "GISTEMP",
        "label": "Surface temperature anomaly",
        "short": "Temperature anomaly",
        "units": "°C",
        "source": "NASA GISTEMP v4",
        "kind": "grid",
        "baseline": "anomalies relative to 1951–1980",
        "description": "Global gridded surface temperature anomaly. Use for global, regional, continent, and map-scale warming questions with a 1951–1980 baseline.",
        "keywords": "global planet world earth map region continent temperature warming warmed anomaly gistemp places",
        "supported": True,
    },
]

CITIES = [
    ("nairobi", "Nairobi", "Kenya", "Africa", -1.2921, 36.8219, []),
    ("lagos", "Lagos", "Nigeria", "Africa", 6.5244, 3.3792, []),
    ("cairo", "Cairo", "Egypt", "Africa", 30.0444, 31.2357, ["egypt"]),
    ("cape-town", "Cape Town", "South Africa", "Africa", -33.9249, 18.4241, []),
    ("dakar", "Dakar", "Senegal", "Africa", 14.7167, -17.4677, []),
    ("niamey", "Niamey", "Niger", "Africa", 13.5116, 2.1254, ["sahel"]),
    ("addis-ababa", "Addis Ababa", "Ethiopia", "Africa", 9.0320, 38.7469, []),
    ("accra", "Accra", "Ghana", "Africa", 5.6037, -0.1870, []),
    ("tokyo", "Tokyo", "Japan", "Asia", 35.6762, 139.6503, ["japan"]),
    ("delhi", "Delhi", "India", "Asia", 28.6139, 77.2090, ["india"]),
    ("beijing", "Beijing", "China", "Asia", 39.9042, 116.4074, ["china"]),
    ("jakarta", "Jakarta", "Indonesia", "Asia", -6.2088, 106.8456, []),
    ("dubai", "Dubai", "UAE", "Asia", 25.2048, 55.2708, []),
    ("bangkok", "Bangkok", "Thailand", "Asia", 13.7563, 100.5018, []),
    ("seoul", "Seoul", "South Korea", "Asia", 37.5665, 126.9780, []),
    ("mumbai", "Mumbai", "India", "Asia", 19.0760, 72.8777, []),
    ("singapore", "Singapore", "Singapore", "Asia", 1.3521, 103.8198, []),
    ("london", "London", "United Kingdom", "Europe", 51.5074, -0.1278, ["uk", "europe"]),
    ("paris", "Paris", "France", "Europe", 48.8566, 2.3522, []),
    ("madrid", "Madrid", "Spain", "Europe", 40.4168, -3.7038, []),
    ("stockholm", "Stockholm", "Sweden", "Europe", 59.3293, 18.0686, []),
    ("athens", "Athens", "Greece", "Europe", 37.9838, 23.7275, []),
    ("berlin", "Berlin", "Germany", "Europe", 52.5200, 13.4050, []),
    ("rome", "Rome", "Italy", "Europe", 41.9028, 12.4964, []),
    ("oslo", "Oslo", "Norway", "Europe", 59.9139, 10.7522, []),
    ("tromso", "Tromsø", "Norway", "Europe", 69.6492, 18.9553, ["arctic", "arctic circle"]),
    ("new-york", "New York", "United States", "North America", 40.7128, -74.0060, ["nyc", "usa", "us"]),
    ("mexico-city", "Mexico City", "Mexico", "North America", 19.4326, -99.1332, ["mexico"]),
    ("vancouver", "Vancouver", "Canada", "North America", 49.2827, -123.1207, ["canada"]),
    ("miami", "Miami", "United States", "North America", 25.7617, -80.1918, []),
    ("anchorage", "Anchorage", "United States", "North America", 61.2181, -149.9003, ["alaska"]),
    ("los-angeles", "Los Angeles", "United States", "North America", 34.0522, -118.2437, ["la"]),
    ("chicago", "Chicago", "United States", "North America", 41.8781, -87.6298, []),
    ("sao-paulo", "São Paulo", "Brazil", "South America", -23.5505, -46.6333, ["brazil"]),
    ("buenos-aires", "Buenos Aires", "Argentina", "South America", -34.6037, -58.3816, ["argentina"]),
    ("lima", "Lima", "Peru", "South America", -12.0464, -77.0428, ["peru"]),
    ("bogota", "Bogotá", "Colombia", "South America", 4.7110, -74.0721, ["colombia"]),
    ("santiago", "Santiago", "Chile", "South America", -33.4489, -70.6693, ["chile"]),
    ("manaus", "Manaus", "Brazil", "South America", -3.1190, -60.0217, ["amazon", "amazonia"]),
    ("brisbane", "Brisbane", "Australia", "Oceania", -27.4698, 153.0251, []),
    ("sydney", "Sydney", "Australia", "Oceania", -33.8688, 151.2093, ["australia"]),
    ("auckland", "Auckland", "New Zealand", "Oceania", -36.8485, 174.7633, ["new zealand"]),
    ("perth", "Perth", "Australia", "Oceania", -31.9505, 115.8605, []),
    ("suva", "Suva", "Fiji", "Oceania", -18.1416, 178.4419, ["fiji"]),
    ("mcmurdo", "McMurdo", "Antarctica", "Antarctica", -77.8419, 166.6863, ["antarctica"]),
]

FEATURED = {"nairobi", "london", "delhi", "manaus", "niamey", "tromso", "sydney", "lima", "tokyo", "cairo", "mcmurdo"}
LIVE_IDS = {"nairobi", "london", "delhi", "manaus", "niamey", "sydney"}

STOPWORDS = set(
    "a an the is are was were of to in on for and or with by from what which how does do did has have had "
    "at as it its this that these those be been being".split()
)


def _round(value: float | None, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    return round(float(value), digits)


def _tokens(text: str) -> list[str]:
    return [token for token in re.findall(r"[a-z0-9]+", text.lower()) if token not in STOPWORDS and len(token) > 1]


def build_variables() -> dict[str, Any]:
    return {"variables": VARIABLES}


def build_grid(env: dict[str, str], sources: list[dict[str, Any]]) -> dict[str, Any]:
    print("· GISTEMP global series")
    global_pairs = [(year, value) for year, value in load_gistemp_global() if START <= year <= END]
    global_series = series_array(global_pairs, START, END)
    global_trends = {}
    for window_start, window_end, key in WINDOWS:
        pairs = [(year, value) for year, value in global_pairs if window_start <= year <= window_end]
        global_trends[key] = compute_trend([year for year, _ in pairs], [value for _, value in pairs])

    print("· GISTEMP gridded field")
    years, lats, lons, values = load_gistemp_grid(START, END)
    cells: list[dict[str, Any]] = []
    refs_by_window: dict[str, list[int]] = {key: [] for _, _, key in WINDOWS}

    total = len(lats) * len(lons)
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            series = values[:, i, j]
            finite = np.isfinite(series)
            if int(finite.sum()) < 20:
                continue
            cell = {
                "lat": round(float(lat), 2),
                "lon": round(float(lon), 2),
                "values": [None if not math.isfinite(float(v)) else round(float(v), 3) for v in series],
                "trends": {},
            }
            index = len(cells)
            cells.append(cell)
            for window_start, window_end, key in WINDOWS:
                mask = (years >= window_start) & (years <= window_end)
                trend = compute_trend(years[mask], series[mask])
                if trend is None:
                    cell["trends"][key] = None
                    continue
                cell["trends"][key] = {
                    "slope": _round(trend["slope_per_decade"], 4),
                    "p": _round(trend["p_value"], 6),
                    "n": trend["n"],
                    "ci_low": _round(trend["ci_low_per_decade"], 4),
                    "ci_high": _round(trend["ci_high_per_decade"], 4),
                    "sen": _round(trend["sen_slope_per_decade"], 4),
                    "mk_tau": _round(trend["mk_tau"], 4),
                    "r_squared": _round(trend["r_squared"], 4),
                    "maxlag": trend["maxlag"],
                    "q": None,
                    "significant": False,
                }
                refs_by_window[key].append(index)
            default = cell["trends"].get("1990-2025")
            if default is None:
                continue
            cell["slope"] = default["slope"]
            cell["p"] = default["p"]
            cell["n"] = default["n"]
        if i % 10 == 0:
            print(f"  lat {lat:6.1f} · {len(cells)} cells")

    for _, _, key in WINDOWS:
        refs = [index for index in refs_by_window[key] if cells[index]["trends"].get(key)]
        if not refs:
            continue
        q_values, significant = benjamini_hochberg([cells[index]["trends"][key]["p"] for index in refs], q=0.05)
        for index, q_value, is_significant in zip(refs, q_values, significant):
            cells[index]["trends"][key]["q"] = _round(float(q_value), 6)
            cells[index]["trends"][key]["significant"] = bool(is_significant)

    for cell in cells:
        default = cell["trends"].get("1990-2025")
        if default:
            cell["q"] = default["q"]
            cell["significant"] = default["significant"]

    cells = [cell for cell in cells if cell.get("slope") is not None]
    valid_cells = [cell for cell in cells if cell.get("slope") is not None]
    counts_by_window = {}
    for _, _, key in WINDOWS:
        window_cells = [cell["trends"][key] for cell in valid_cells if cell["trends"].get(key)]
        slopes = [item["slope"] for item in window_cells]
        counts_by_window[key] = {
            "cells": len(window_cells),
            "significant_increasing": sum(1 for item in window_cells if item.get("significant") and item["slope"] > 0),
            "significant_decreasing": sum(1 for item in window_cells if item.get("significant") and item["slope"] < 0),
            "not_significant": sum(1 for item in window_cells if not item.get("significant")),
            "median_slope_per_decade": round(float(np.median(slopes)), 4) if slopes else None,
        }

    sources.append({
        "id": "gistemp",
        "name": "NASA GISTEMP v4",
        "kind": "grid",
        "status": "ok",
        "detail": f"{len(valid_cells):,} cells at 4° · baseline 1951–1980",
    })

    return {
        "meta": {
            "source": "NASA GISTEMP v4 gridded surface temperature anomalies",
            "start_year": START,
            "end_year": END,
            "years": YEARS,
            "windows": [key for _, _, key in WINDOWS],
            "baseline": "1951–1980",
            "resolution": "4° subsample of the 2° GISTEMP grid",
            "bh_q": 0.05,
            "counts": counts_by_window["1990-2025"],
            "counts_by_window": counts_by_window,
            "global": {
                "series": global_series,
                "trends": global_trends,
            },
            "total_grid_cells": total,
        },
        "cells": cells,
    }


def build_points(env: dict[str, str], sources: list[dict[str, Any]]) -> dict[str, Any]:
    username = env.get("METEOMATICS_USERNAME", "")
    password = env.get("METEOMATICS_PASSWORD", "")
    points: list[dict[str, Any]] = []
    live_count = 0

    for slug, name, country, continent, lat, lon, aliases in CITIES:
        print(f"· POWER {name}")
        payload = fetch_power_point(slug, lat, lon, START, END)
        parameters = payload.get("properties", {}).get("parameter", {})
        series: dict[str, list[float | None]] = {}
        trends: dict[str, dict[str, Any]] = {}
        for code in POWER_CODES:
            if code not in parameters:
                continue
            annual = annual_from_power(parameters[code], START, END)
            series[code] = series_array(annual, START, END)
            trends[code] = {}
            for window_start, window_end, key in WINDOWS:
                pairs = [(year, value) for year, value in annual if window_start <= year <= window_end]
                trends[code][key] = compute_trend([year for year, _ in pairs], [value for _, value in pairs])

        live = None
        if slug in LIVE_IDS and username and password:
            try:
                live = fetch_meteomatics(slug, lat, lon, username, password)
                if live:
                    live_count += 1
            except Exception:  # noqa: BLE001 - live conditions are optional
                live = None

        points.append({
            "id": slug,
            "name": name,
            "country": country,
            "continent": continent,
            "lat": lat,
            "lon": lon,
            "aliases": aliases,
            "featured": slug in FEATURED,
            "series": series,
            "trends": trends,
            "live": live,
            "imagery": None,
        })

    sources.append({
        "id": "power",
        "name": "NASA POWER",
        "kind": "point",
        "status": "ok",
        "detail": f"{len(points)} points · {', '.join(POWER_CODES)} · 1990–2025",
    })
    sources.append({
        "id": "meteomatics",
        "name": "Meteomatics",
        "kind": "live",
        "status": "ok" if live_count else "unavailable",
        "detail": f"Current conditions for {live_count} featured point(s)" if live_count else "Credentials not available or request failed",
    })
    return {
        "meta": {
            "source": "NASA POWER monthly point API (MERRA-2 derived) and Meteomatics",
            "start_year": START,
            "end_year": END,
            "years": YEARS,
            "windows": [key for _, _, key in WINDOWS],
            "variables": {variable["code"]: variable for variable in VARIABLES if variable["kind"] == "point"},
        },
        "points": points,
    }


def build_rag(variables_payload: dict[str, Any], points_payload: dict[str, Any]) -> dict[str, Any]:
    docs = variables_payload["variables"]
    tokenized = [
        _tokens(" ".join([doc["label"], doc["short"], doc["description"], doc["keywords"], doc["source"], doc["baseline"]]))
        for doc in docs
    ]
    vocabulary = sorted({token for tokens in tokenized for token in tokens})
    index = {token: position for position, token in enumerate(vocabulary)}
    document_frequency = {token: sum(1 for tokens in tokenized if token in tokens) for token in vocabulary}
    idf = {
        token: math.log((1.0 + len(docs)) / (1.0 + document_frequency[token])) + 1.0
        for token in vocabulary
    }

    vectors = []
    for tokens in tokenized:
        counts: dict[str, int] = {}
        for token in tokens:
            counts[token] = counts.get(token, 0) + 1
        weighted = [(index[token], count * idf[token]) for token, count in counts.items()]
        norm = math.sqrt(sum(weight * weight for _, weight in weighted)) or 1.0
        vectors.append([[position, round(weight / norm, 6)] for position, weight in weighted])

    return {
        "vocab": vocabulary,
        "idf": [round(idf[token], 6) for token in vocabulary],
        "docs": [
            {"id": doc["code"], "label": doc["short"], "vector": vector}
            for doc, vector in zip(docs, vectors)
        ],
        "examples": [
            "Is the Sahel getting drier?",
            "Is Nairobi warming?",
            "Has London's rainfall changed?",
            "Is Delhi getting hotter?",
            "Is the Amazon drying out?",
            "Is the Arctic warming faster?",
            "Which places warmed fastest?",
            "Is soil moisture declining in the Sahel?",
        ],
        "places": [
            {
                "name": point["name"],
                "aliases": [point["name"].lower(), point["id"].replace("-", " "), *point["aliases"]],
                "lat": point["lat"],
                "lon": point["lon"],
                "id": point["id"],
            }
            for point in points_payload["points"]
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=str(ROOT / ".env"))
    args = parser.parse_args()

    env = load_env(Path(args.env_file).expanduser())
    sources: list[dict[str, Any]] = []

    variables_payload = build_variables()
    (PUBLIC / "variables.json").write_text(json.dumps(variables_payload, ensure_ascii=False, indent=1), encoding="utf-8")

    earthdata = check_earthdata(env)
    sources.append({"id": "earthdata", "name": "NASA Earthdata", "kind": "auth", **earthdata})

    planetary = check_planetary()
    sources.append({"id": "planetary", "name": "Planetary Computer", "kind": "stac", **planetary})

    points_payload = build_points(env, sources)
    (PUBLIC / "points.json").write_text(json.dumps(points_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    grid_payload = build_grid(env, sources)
    (PUBLIC / "grid.json").write_text(json.dumps(grid_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    rag_payload = build_rag(variables_payload, points_payload)
    (PUBLIC / "rag_index.json").write_text(json.dumps(rag_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    (PUBLIC / "sources.json").write_text(
        json.dumps(
            {
                "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "sources": sources,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    print("\nwrote:")
    for name in ("variables.json", "points.json", "grid.json", "rag_index.json", "sources.json"):
        path = PUBLIC / name
        print(f"  {name:18s} {path.stat().st_size / 1024:8.1f} KB")
    print(f"  points: {len(points_payload['points'])} · grid cells: {len(grid_payload['cells'])}")

    print("\n· NASA Blue Marble context crops")
    from scripts.render_context import main as render_context  # local import keeps the data path optional

    render_context()

    print("\n· Sentinel-2 L2A mosaics")
    from scripts.fetch_sentinel import main as fetch_sentinel

    sentinel_status = fetch_sentinel()
    if sentinel_status:
        print("  Sentinel-2 mosaics unavailable; Blue Marble fallbacks remain labelled per point")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
