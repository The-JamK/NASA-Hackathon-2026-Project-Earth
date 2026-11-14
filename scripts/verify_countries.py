"""Verify the country averages against the stations they are built from.

The countries file is derived data, so every number in it can be recomputed
from `points.json`. This checks that the aggregation is the plain arithmetic
mean it claims to be, that no station is lost or double counted, and that each
country ships the trend records the interface reads.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "data"
CODES = ("T2M", "PRECTOTCORR", "GWETROOT", "ALLSKY_SFC_SW_DWN")


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def load(name: str) -> dict:
    path = PUBLIC / name
    if not path.exists():
        fail(f"{name} is missing; run scripts/build_data.py")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    points = load("points.json")
    countries = load("countries.json")
    years = points["meta"]["years"]

    groups: dict[str, list[dict]] = defaultdict(list)
    for point in points["points"]:
        groups[point["country"]].append(point)

    if len(countries["countries"]) != len(groups):
        fail(f"{len(countries['countries'])} country records for {len(groups)} countries in the bundle")
    if sum(country["stations"] for country in countries["countries"]) != len(points["points"]):
        fail("the country station counts do not add up to the number of stations")
    if countries["meta"]["years"] != years:
        fail("the country records use a different year axis from the stations")

    for country in countries["countries"]:
        name = country["name"]
        members = groups.get(name)
        if not members:
            fail(f"{name} has a country record but no stations")
        if country["stations"] != len(members):
            fail(f"{name} claims {country['stations']} stations, bundle has {len(members)}")
        if country["id"].startswith("country-") is False:
            fail(f"{name} has an unexpected id {country['id']}")
        if name.lower() not in country["aliases"]:
            fail(f"{name} does not answer to its own name")

        cities = country["cities"]
        if not 1 <= len(cities) <= 8:
            fail(f"{name} lists {len(cities)} cities")
        if [city["population"] for city in cities] != sorted(
            (city["population"] for city in cities), reverse=True
        ):
            fail(f"{name} lists its cities out of population order")
        member_ids = {member["id"] for member in members}
        for city in cities:
            if city["id"] not in member_ids:
                fail(f"{name} suggests {city['id']}, which is not one of its stations")

        # A country carries exactly the variables its stations carry: Antarctica
        # has no root-zone soil moisture because McMurdo has none either.
        codes = sorted(
            code
            for code in CODES
            if any(
                code in member["series"]
                and any(
                    isinstance(value, (int, float)) and math.isfinite(value)
                    for value in member["series"][code]
                )
                for member in members
            )
        )
        if set(country["series"]) != set(codes):
            fail(f"{name} serves {sorted(country['series'])}, its stations cover {codes}")

        for code in codes:
            arrays = [member["series"][code] for member in members if code in member["series"]]
            values = country["series"].get(code)
            if values is None:
                fail(f"{name} is missing its {code} mean series")
            if len(values) != len(years):
                fail(f"{name} {code} mean has {len(values)} values for {len(years)} years")
            for index, value in enumerate(values):
                column = [
                    array[index]
                    for array in arrays
                    if index < len(array)
                    and isinstance(array[index], (int, float))
                    and math.isfinite(array[index])
                ]
                if not column:
                    if value is not None:
                        fail(f"{name} {code} {years[index]} has a mean but no station value")
                    continue
                expected = sum(column) / len(column)
                if value is None or abs(value - expected) > 1e-3:
                    fail(
                        f"{name} {code} {years[index]} mean is {value}, "
                        f"recomputed {round(expected, 4)} from {len(column)} stations"
                    )
                if not (min(column) - 1e-9 <= value <= max(column) + 1e-9):
                    fail(f"{name} {code} {years[index]} mean sits outside its stations")

        for code in codes:
            trends = country["trends"].get(code)
            if not trends:
                fail(f"{name} has no {code} trend record")
            for key in ("1990-2025", "2000-2025", "2010-2025"):
                trend = trends.get(key)
                if not trend:
                    fail(f"{name} {code} {key} trend is missing")
                if not isinstance(trend.get("slope_per_decade"), (int, float)):
                    fail(f"{name} {code} {key} slope is not a number")
                if trend.get("verdict") not in (
                    "significant increasing",
                    "significant decreasing",
                    "no significant trend",
                    # A 16-year window is below the estimator's minimum, and the
                    # statistics module labels those exploratory on purpose.
                    "exploratory",
                ):
                    fail(f"{name} {code} {key} has verdict {trend.get('verdict')!r}")
                if not isinstance(trend.get("q_value"), (int, float)):
                    fail(f"{name} {code} {key} has no corrected q value")

    print(
        f"countries: {len(countries['countries'])} · stations: {len(points['points'])} · "
        f"{sum(1 for country in countries['countries'] if country['stations'] > 1)} averaged over several stations"
    )
    print("countries verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
