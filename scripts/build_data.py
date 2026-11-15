"""Build the Signal & Noise data bundles from real cached sources.

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
import unicodedata
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import points_bundle
from scripts.build_cities import candidate_cities, fill_sparse_regions, merge_new_cities
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
    SHIP_DIGITS_GRID,
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
        "short": "Root-zone wetness",
        "units": "fraction",
        "source": "NASA POWER (MERRA-2 derived)",
        "kind": "point",
        "baseline": "absolute wetness — fraction of pore space filled (0 = dry, 1 = saturated)",
        "description": "Annual mean root-zone soil wetness: the share of the soil's pore space holding water, 0 (dry) to 1 (saturated), over roughly the top metre. Use for soil moisture, agricultural drought, and land drying questions.",
        "keywords": "soil moisture wetness saturation drought agriculture land dryness dry drier declining groundwater root zone",
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
    # The poles were the thinnest part of the map: seven stations above the
    # Arctic Circle, one below it. Natural Earth has almost no Antarctic
    # settlements and its Arctic villages are too small for the population
    # rule, so both belts are listed here, roughly 1,000 km apart, at places
    # with a continuous NASA POWER record.
    ("utqiagvik", "Utqiaġvik", "United States", "North America", 71.2906, -156.7886, ["barrow", "alaska"]),
    ("inuvik", "Inuvik", "Canada", "North America", 68.3607, -133.7230, ["northwest territories"]),
    ("cambridge-bay", "Cambridge Bay", "Canada", "North America", 69.1169, -105.0597, ["iqaluktuuttiaq", "nunavut"]),
    ("resolute", "Resolute", "Canada", "North America", 74.6975, -94.8297, ["resolute bay", "qausuittuq"]),
    ("ittoqqortoormiit", "Ittoqqortoormiit", "Greenland", "North America", 70.4853, -21.9667, ["scoresbysund"]),
    ("nord", "Nord", "Greenland", "North America", 81.6000, -16.6700, ["station nord"]),
    ("khatanga", "Khatanga", "Russia", "Asia", 72.0417, 102.4653, []),
    ("tiksi", "Tiksi", "Russia", "Asia", 71.6269, 128.8686, []),
    ("pevek", "Pevek", "Russia", "Asia", 69.7029, 170.2992, []),
    ("srednekolymsk", "Srednekolymsk", "Russia", "Asia", 67.4500, 153.7100, []),
    ("vostok", "Vostok", "Antarctica", "Antarctica", -78.4644, 106.8350, ["vostok station"]),
    ("concordia", "Concordia", "Antarctica", "Antarctica", -75.1000, 123.3900, ["dome c", "concordia station"]),
    ("casey", "Casey", "Antarctica", "Antarctica", -66.2817, 110.5283, ["casey station"]),
    ("dumont-durville", "Dumont d'Urville", "Antarctica", "Antarctica", -66.6667, 140.0017, ["dumont durville"]),
    ("davis", "Davis", "Antarctica", "Antarctica", -68.5764, 77.9686, ["davis station"]),
    ("mawson", "Mawson", "Antarctica", "Antarctica", -67.6028, 62.8731, ["mawson station"]),
    ("syowa", "Syowa", "Antarctica", "Antarctica", -69.0044, 39.5808, ["showa", "syowa station"]),
    ("neumayer", "Neumayer", "Antarctica", "Antarctica", -70.6500, -8.2500, ["neumayer station"]),
    ("halley", "Halley", "Antarctica", "Antarctica", -75.5800, -26.5000, ["halley bay", "halley station"]),
    ("rothera", "Rothera", "Antarctica", "Antarctica", -67.5686, -68.1239, ["rothera station"]),
]

FEATURED = {
    "nairobi",
    "london",
    "delhi",
    "manaus",
    "niamey",
    "tromso",
    "sydney",
    "lima",
    "tokyo",
    "cairo",
    "mcmurdo",
    "shanghai",
    "dhaka",
    "reykjavik",
}
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
    shipped_global = [
        (START + offset, value) for offset, value in enumerate(global_series) if value is not None
    ]
    for window_start, window_end, key in WINDOWS:
        pairs = [(year, value) for year, value in shipped_global if window_start <= year <= window_end]
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
            published = [None if not math.isfinite(float(v)) else round(float(v), SHIP_DIGITS_GRID) for v in series]
            cell = {
                "lat": round(float(lat), 2),
                "lon": round(float(lon), 2),
                "values": published,
                "trends": {},
            }
            index = len(cells)
            cells.append(cell)
            # Fit the 3 dp values that ship, so the published p-value reproduces.
            shipped_series = np.array([np.nan if value is None else value for value in published], dtype=float)
            for window_start, window_end, key in WINDOWS:
                mask = (years >= window_start) & (years <= window_end)
                trend = compute_trend(years[mask], shipped_series[mask])
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
            # 4,050 candidate cells, 4,039 analysed: 11 cells have fewer than 20
            # finite years and are dropped. Report both, under names that say which.
            "total_grid_cells": len(cells),
            "candidate_grid_cells": total,
        },
        "cells": cells,
    }


# Short spellings a country answers to. They are stamped on every station of
# that country so "USA" and "United States" reach the same case.
COUNTRY_SPELLINGS = {
    "United States": ("usa", "us"),
    "United Arab Emirates": ("uae",),
    "United Kingdom": ("uk", "britain"),
}


def curated_rows() -> list[dict[str, Any]]:
    return [
        {
            "slug": slug,
            "name": name,
            "country": country,
            "continent": continent,
            "lat": lat,
            "lon": lon,
            "aliases": aliases,
            "curated": True,
        }
        for slug, name, country, continent, lat, lon, aliases in CITIES
    ]


def _series_and_trends(
    payload: dict[str, Any],
) -> tuple[dict[str, list[float | None]], dict[str, dict[str, Any]]]:
    parameters = payload.get("properties", {}).get("parameter", {})
    series: dict[str, list[float | None]] = {}
    trends: dict[str, dict[str, Any]] = {}
    for code in POWER_CODES:
        if code not in parameters:
            continue
        annual = annual_from_power(parameters[code], START, END)
        series[code] = series_array(annual, START, END)
        trends[code] = {}
        # Fit the values that ship, not the unrounded ones: a reader can only
        # reproduce a p-value from the series that is in the bundle.
        published = [
            (START + offset, value) for offset, value in enumerate(series[code]) if value is not None
        ]
        for window_start, window_end, key in WINDOWS:
            pairs = [(year, value) for year, value in published if window_start <= year <= window_end]
            trends[code][key] = compute_trend([year for year, _ in pairs], [value for _, value in pairs])
    return series, trends


def _coverage(series: dict[str, list[float | None]]) -> int:
    usable = 0
    for values in series.values():
        finite = [value for value in values if isinstance(value, (int, float)) and math.isfinite(value)]
        if len(finite) >= 30:
            usable += 1
    return usable


def _fetch_payloads(rows: list[dict[str, Any]]) -> list[dict[str, Any] | None]:
    """Fetch every POWER payload, three at a time, resuming from the cache."""

    def fetch(row: dict[str, Any]) -> dict[str, Any] | None:
        for attempt in range(3):
            try:
                return fetch_power_point(row["slug"], row["lat"], row["lon"], START, END)
            except Exception as error:  # noqa: BLE001 - one missing point must not stop the build
                if attempt == 2:
                    print(f"  ! POWER {row['name']}: {type(error).__name__}")
                    return None
                time.sleep(1.0 + attempt)
        return None

    with ThreadPoolExecutor(max_workers=3) as pool:
        return list(pool.map(fetch, rows))


def build_points(
    env: dict[str, str],
    sources: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    existing: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    username = env.get("METEOMATICS_USERNAME", "")
    password = env.get("METEOMATICS_PASSWORD", "")
    points: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    live_count = 0
    full_count = 0

    payloads = _fetch_payloads(rows)
    for row, payload in zip(rows, payloads):
        slug = row["slug"]
        if payload is None:
            if row["curated"]:
                raise RuntimeError(f"NASA POWER did not answer for the curated point {slug}")
            skipped.append({"id": slug, "name": row["name"], "reason": "POWER request failed"})
            continue

        series, trends = _series_and_trends(payload)
        coverage = _coverage(series)
        if row["curated"]:
            if coverage < 3:
                raise RuntimeError(f"the curated point {slug} lost its usable variables")
        elif coverage < len(POWER_CODES):
            # A half-covered city would be a thin case file; the curated table
            # keeps its 3-variable points because they are part of the demo.
            skipped.append(
                {"id": slug, "name": row["name"], "coverage": f"{coverage}/{len(POWER_CODES)}"}
            )
            continue
        if coverage == len(POWER_CODES):
            full_count += 1

        print(f"· POWER {row['name']}")
        previous = existing.get(slug, {})
        live = None
        if slug in LIVE_IDS:
            try:
                live = fetch_meteomatics(slug, row["lat"], row["lon"], username, password)
            except Exception:  # noqa: BLE001 - live conditions are optional
                live = None
            if live is None:
                # No credentials and no cache: keep the snapshot the previous
                # bundle shipped, which the app labels Snapshot.
                live = previous.get("live")
            if live:
                live_count += 1

        # Every station answers to its country name, so "Is the United States
        # warming?" reaches the same place as "Is the USA warming?". The
        # population lets the resolver pick the principal station when several
        # share that alias.
        aliases = [alias for alias in row["aliases"] if alias]
        for spelling in [row["country"], *COUNTRY_SPELLINGS.get(row["country"], ())]:
            spelling = spelling.strip().lower()
            if spelling and spelling not in aliases:
                aliases.append(spelling)

        points.append(
            {
                "id": slug,
                "name": row["name"],
                "country": row["country"],
                "continent": row["continent"],
                "lat": row["lat"],
                "lon": row["lon"],
                "aliases": aliases,
                "population": int(row.get("population") or 0),
                "primary": bool(row.get("curated")),
                "featured": slug in FEATURED,
                "series": series,
                "trends": trends,
                "live": live,
                "imagery": previous.get("imagery"),
                "imagery_meta": previous.get("imagery_meta"),
            }
        )

    sources.append({
        "id": "power",
        "name": "NASA POWER",
        "kind": "point",
        "status": "ok",
        "detail": (
            f"{len(points)} points · {full_count} with all four variables · "
            f"{', '.join(POWER_CODES)} · 1990–2025"
        ),
        "skipped_points": skipped,
    })
    carried = not (username and password)
    sources.append({
        "id": "meteomatics",
        "name": "Meteomatics",
        "kind": "live",
        "status": "ok" if live_count else "unavailable",
        "detail": (
            f"Current conditions for {live_count} featured point(s)"
            + (" (snapshot carried from the cache; no credentials in this environment)" if carried else "")
            if live_count
            else "Credentials not available or request failed"
        ),
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
                "weight": point.get("population", 0),
                "primary": bool(point.get("primary")),
            }
            for point in points_payload["points"]
        ],
    }


def _country_slug(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    return f"country-{slug or 'unnamed'}"


def build_countries(points_payload: dict[str, Any]) -> dict[str, Any]:
    """One average record per country: the mean of its stations, year by year.

    A country answer needs a series rather than a slope average: averaging the
    annual values keeps the year-to-year shape, so the same trend code that
    reads a city reads a country. Slopes would otherwise be averaged without
    the years they came from.
    """

    meta = points_payload.get("meta", {})
    years = list(meta.get("years") or range(START, END + 1))
    groups: dict[str, list[dict[str, Any]]] = {}
    for point in points_payload["points"]:
        groups.setdefault(point["country"], []).append(point)

    countries: list[dict[str, Any]] = []
    for name in sorted(groups):
        members = groups[name]
        series: dict[str, list[float | None]] = {}
        for code in POWER_CODES:
            arrays = [
                member["series"][code]
                for member in members
                if code in (member.get("series") or {})
            ]
            if not arrays:
                continue
            mean_values: list[float | None] = []
            for index in range(len(years)):
                values = [
                    array[index]
                    for array in arrays
                    if index < len(array)
                    and isinstance(array[index], (int, float))
                    and math.isfinite(array[index])
                ]
                mean_values.append(round(sum(values) / len(values), 4) if values else None)
            if all(value is None for value in mean_values):
                # Antarctica's McMurdo has no root-zone soil moisture at all, so
                # the country simply has no series for that variable.
                continue
            series[code] = mean_values

        trends: dict[str, dict[str, Any]] = {}
        for code, values in series.items():
            pairs = [
                (years[index], value)
                for index, value in enumerate(values)
                if isinstance(value, (int, float)) and math.isfinite(value)
            ]
            trends[code] = {}
            for window_start, window_end, key in WINDOWS:
                window_pairs = [(year, value) for year, value in pairs if window_start <= year <= window_end]
                trends[code][key] = compute_trend(
                    [year for year, _ in window_pairs], [value for _, value in window_pairs]
                )

        weights = [member.get("population") or 1 for member in members]
        total_weight = sum(weights) or 1
        lat = sum(member["lat"] * weight for member, weight in zip(members, weights)) / total_weight
        lon = sum(member["lon"] * weight for member, weight in zip(members, weights)) / total_weight
        ranked = sorted(members, key=lambda member: member.get("population") or 0, reverse=True)
        continents = [member["continent"] for member in members if member.get("continent")]
        continent = max(set(continents), key=continents.count) if continents else ""
        aliases = [name.lower(), *COUNTRY_SPELLINGS.get(name, ())]

        countries.append(
            {
                "id": _country_slug(name),
                "name": name,
                "continent": continent,
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "stations": len(members),
                "full_coverage": sum(1 for member in members if _coverage(member["series"]) == len(POWER_CODES)),
                "aliases": aliases,
                "series": series,
                "trends": trends,
                "cities": [
                    {
                        "id": member["id"],
                        "name": member["name"],
                        "population": int(member.get("population") or 0),
                    }
                    for member in ranked[:8]
                ],
            }
        )

    # Same false-discovery control the grid uses, applied across country averages
    # so "significant" means the same thing at both scales.
    for code in POWER_CODES:
        for _, _, key in WINDOWS:
            refs = [country for country in countries if country["trends"].get(code, {}).get(key)]
            if not refs:
                continue
            q_values, significant = benjamini_hochberg(
                [country["trends"][code][key]["p_value"] for country in refs], q=0.05
            )
            for country, q_value, is_significant in zip(refs, q_values, significant):
                country["trends"][code][key]["q_value"] = _round(float(q_value), 6)
                country["trends"][code][key]["significant"] = bool(is_significant)

    return {"meta": {"start_year": START, "end_year": END, "years": years}, "countries": countries}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=str(ROOT / ".env"))
    parser.add_argument(
        "--skip-grid",
        action="store_true",
        help="reuse the committed GISTEMP grid instead of rebuilding it",
    )
    parser.add_argument(
        "--skip-imagery",
        action="store_true",
        help="reuse the committed context imagery instead of fetching it again",
    )
    args = parser.parse_args()

    env = load_env(Path(args.env_file).expanduser())
    sources: list[dict[str, Any]] = []

    points_path = PUBLIC / "points.json"
    existing_points: dict[str, dict[str, Any]] = {}
    if points_path.exists():
        # The bundle is split in two tiers; the build needs the merged view so a
        # rebuild can reuse the series it already has instead of refetching.
        existing_payload = points_bundle.load_bundle(PUBLIC)
        existing_points = {point["id"]: point for point in existing_payload.get("points", [])}

    sources_path = PUBLIC / "sources.json"
    existing_sources: dict[str, dict[str, Any]] = {}
    if sources_path.exists():
        existing_payload = json.loads(sources_path.read_text(encoding="utf-8"))
        existing_sources = {source["id"]: source for source in existing_payload.get("sources", [])}

    variables_payload = build_variables()
    (PUBLIC / "variables.json").write_text(json.dumps(variables_payload, ensure_ascii=False, indent=1), encoding="utf-8")

    earthdata = check_earthdata(env)
    if earthdata.get("status") != "ok":
        previous_check = existing_sources.get("earthdata")
        if previous_check and previous_check.get("status") == "ok":
            # The auth probe needs credentials that this environment does not
            # hold; keep the earlier verification instead of erasing it.
            earthdata = {
                **previous_check,
                "detail": (
                    f"{previous_check.get('detail', '')} · verified in an earlier build; "
                    "credentials are not set in this environment"
                ),
            }
    sources.append({"id": "earthdata", "name": "NASA Earthdata", "kind": "auth", **earthdata})

    planetary = check_planetary()
    sources.append({"id": "planetary", "name": "Planetary Computer", "kind": "stac", **planetary})

    curated = curated_rows()
    candidates = candidate_cities()
    # The hand-curated table has no population column; borrow Natural Earth's so
    # a country query resolves to the biggest station rather than an arbitrary one.
    population_by_name = {row["name"].strip().lower(): row["population"] for row in candidates}
    for row in curated:
        row["population"] = population_by_name.get(row["name"].strip().lower(), 0)
    new_rows = [{**row, "curated": False} for row in merge_new_cities(curated, candidates)]
    sparse_rows = [
        {**row, "curated": False}
        for row in fill_sparse_regions(
            [*curated, *new_rows],
            taken_slugs={row["slug"] for row in curated} | {row["slug"] for row in new_rows},
        )
    ]
    print(
        f"· cities: {len(curated)} curated + {len(new_rows)} largest-city candidates "
        f"+ {len(sparse_rows)} sparse-region points"
    )

    points_payload = build_points(env, sources, [*curated, *new_rows, *sparse_rows], existing_points)
    # Two tiers: an index the app loads eagerly and per-shard detail it fetches
    # when a case is opened. See scripts/points_bundle.py.
    point_report = points_bundle.write_bundle(PUBLIC, points_payload)
    print(
        f"  points.json          {point_report['index_bytes'] / 1024:7.1f} KB index · "
        f"{point_report['detail_bytes'] / 1024:7.1f} KB detail in "
        f"{point_report['details']} shards"
    )

    grid_path = PUBLIC / "grid.json"
    if args.skip_grid:
        if not grid_path.exists():
            raise SystemExit("--skip-grid needs an existing public/data/grid.json")
        grid_payload = json.loads(grid_path.read_text(encoding="utf-8"))
        gistemp = existing_sources.get("gistemp")
        if not gistemp:
            counts = grid_payload.get("meta", {}).get("counts", {})
            cells = counts.get("cells") or len(grid_payload.get("cells", []))
            gistemp = {
                "id": "gistemp",
                "name": "NASA GISTEMP v4",
                "kind": "grid",
                "status": "ok",
                "detail": f"{cells:,} cells at 4° · baseline 1951–1980",
            }
        sources.append(gistemp)
        print(f"· GISTEMP grid reused · {len(grid_payload.get('cells', [])):,} cells")
    else:
        grid_payload = build_grid(env, sources)
        grid_path.write_text(json.dumps(grid_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    rag_payload = build_rag(variables_payload, points_payload)
    (PUBLIC / "rag_index.json").write_text(json.dumps(rag_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    countries_payload = build_countries(points_payload)
    (PUBLIC / "countries.json").write_text(
        json.dumps(countries_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"  countries.json       {len(countries_payload['countries']):7d} countries")

    if args.skip_imagery:
        sources.append(
            existing_sources.get("blue-marble")
            or {
                "id": "blue-marble",
                "name": "NASA Blue Marble",
                "kind": "fallback",
                "status": "ok",
                "detail": "globe texture + context imagery carried over from the previous bundle",
            }
        )

    sources_path.write_text(
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
    for name in (
        "variables.json",
        "grid.json",
        "rag_index.json",
        "countries.json",
        "sources.json",
    ):
        path = PUBLIC / name
        print(f"  {name:18s} {path.stat().st_size / 1024:8.1f} KB")
    print(f"  points: {len(points_payload['points'])} · grid cells: {len(grid_payload['cells'])}")

    if args.skip_imagery:
        print("\n· context imagery reused from the previous bundle")
        return 0

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
