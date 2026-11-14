"""Curate the largest cities of every country from Natural Earth.

The app ships a hand-curated CITIES table. This module adds the three largest
cities of every country/territory from Natural Earth's public-domain populated
places layer, so the map covers every country rather than a chosen sample.

Both Natural Earth layers are downloaded once into data/cache/naturalearth and
their DBF attribute tables are parsed with the standard library, so the build
needs no shapefile or geopandas dependency.

    uv run python scripts/build_cities.py            # print the candidate set
"""

from __future__ import annotations

import argparse
import io
import math
import re
import struct
import unicodedata
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "naturalearth"
PLACES_URL = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip"
COUNTRIES_URL = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip"
PLACES_ZIP = CACHE / "ne_10m_populated_places.zip"
COUNTRIES_ZIP = CACHE / "ne_10m_admin_0_countries.zip"

LIMIT = 3
# Two records closer than this are the same conurbation (Giza/Cairo, 6 km;
# Callao/Lima, 10 km), not two cases. Distinct neighbouring cities such as
# Rotterdam (23 km from The Hague) stay in the bundle.
MIN_SEPARATION_KM = 15.0
EARTH_RADIUS_KM = 6371.0088


def _download(url: str, destination: Path, timeout: int = 180) -> Path:
    if destination.exists() and destination.stat().st_size > 0:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "signal-and-noise/0.1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read()
    temporary = destination.with_suffix(destination.suffix + ".part")
    temporary.write_bytes(payload)
    temporary.replace(destination)
    return destination


def _dbf_rows(archive: Path, part: str) -> list[dict[str, str]]:
    """Read one DBF attribute table out of a Natural Earth zip.

    Natural Earth writes UTF-8 bytes into a DBF whose header claims a code page;
    decoding as UTF-8 first keeps names like "Reykjavík" intact and falls back to
    latin-1 for the rare row that is not valid UTF-8.
    """
    with zipfile.ZipFile(archive) as bundle:
        member = next(name for name in bundle.namelist() if name.lower().endswith(".dbf") and part in name)
        data = bundle.read(member)

    record_count = struct.unpack("<I", data[4:8])[0]
    header_length = struct.unpack("<H", data[8:10])[0]
    record_length = struct.unpack("<H", data[10:12])[0]

    fields: list[tuple[str, int]] = []
    offset = 32
    while data[offset] != 0x0D:
        name = data[offset : offset + 11].split(b"\0")[0].decode("latin-1")
        fields.append((name, data[offset + 16]))
        offset += 32

    rows: list[dict[str, str]] = []
    for index in range(record_count):
        start = header_length + index * record_length
        record = data[start : start + record_length]
        if record[:1] == b"*":
            continue
        position = 1
        row: dict[str, str] = {}
        for name, length in fields:
            chunk = record[position : position + length]
            position += length
            try:
                value = chunk.decode("utf-8")
            except UnicodeDecodeError:
                value = chunk.decode("latin-1")
            # DBF fields are fixed width and padded with NULs, not spaces.
            row[name] = value.replace("\x00", "").strip()
        rows.append(row)
    return rows


def _number(value: str | None) -> float | None:
    try:
        number = float(value or "")
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _normalise(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", folded.lower())


def slugify(name: str) -> str:
    folded = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")
    return slug or "place"


def distance_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    phi_a, phi_b = math.radians(lat_a), math.radians(lat_b)
    delta_phi = phi_b - phi_a
    delta_lambda = math.radians(lon_b - lon_a)
    haversine = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(haversine)))


def _name_keys(name: str) -> list[str]:
    keys = [_normalise(name)]
    # Natural Earth abbreviates a few political names ("S. Sudan").
    if "s. " in name.lower():
        keys.append(_normalise(name.replace("S. ", "South ").replace("s. ", "South ")))
    return [key for key in keys if key]


def _continents() -> dict[str, str]:
    """Continent lookup by country name and by ISO3/sovereign code.

    Island states carry "Seven seas (open ocean)" in CONTINENT, so REGION_UN
    (Africa, Asia, Oceania …) is used for those instead.
    """

    rows = _dbf_rows(_download(COUNTRIES_URL, COUNTRIES_ZIP), "admin_0_countries")
    mapping: dict[str, str] = {}
    for row in rows:
        continent = (row.get("CONTINENT") or "").strip()
        region = (row.get("REGION_UN") or "").strip()
        if continent.startswith("Seven seas"):
            continent = region
        if not continent:
            continue
        for field in ("NAME", "ADMIN"):
            for key in _name_keys(row.get(field, "")):
                mapping.setdefault(key, continent)
        for field in ("ADM0_A3", "SOV_A3"):
            code = (row.get(field) or "").strip()
            if code:
                mapping.setdefault(code, continent)
    return mapping


def candidate_cities(limit: int = LIMIT) -> list[dict[str, Any]]:
    """The `limit` largest populated places of every country, by POP_MAX."""
    places = _dbf_rows(_download(PLACES_URL, PLACES_ZIP), "populated_places")
    continents = _continents()

    by_country: dict[str, list[dict[str, str]]] = {}
    for place in places:
        country = (place.get("ADM0NAME") or "").strip()
        if country:
            by_country.setdefault(country, []).append(place)

    candidates: list[dict[str, Any]] = []
    for country, rows in by_country.items():
        rows.sort(key=lambda row: _number(row.get("POP_MAX")) or 0.0, reverse=True)
        for rank, row in enumerate(rows[:limit]):
            lat = _number(row.get("LATITUDE"))
            lon = _number(row.get("LONGITUDE"))
            if lat is None or lon is None:
                continue
            name = (row.get("NAME_EN") or row.get("NAME") or "").strip()
            if not name:
                continue
            continent = (
                continents.get(_normalise(country))
                or continents.get(row.get("ADM0_A3", ""))
                or continents.get(row.get("SOV_A3", ""))
                or ("Antarctica" if lat < -45 else "")
                or country
            )
            iso2 = (row.get("ISO_A2") or "").strip()
            iso3 = (row.get("ADM0_A3") or "").strip()
            aliases: list[str] = []
            # Only the largest city carries the country name, the way the
            # hand-curated table does ("Is Brazil warming?" -> São Paulo).
            if rank == 0 and _normalise(country) != _normalise(name):
                aliases.append(country.lower())
            candidates.append(
                {
                    "name": name,
                    "country": country,
                    "continent": continent,
                    "lat": round(lat, 4),
                    "lon": round(lon, 4),
                    "population": int(_number(row.get("POP_MAX")) or 0),
                    "rank": rank,
                    "iso2": iso2 if len(iso2) == 2 else "",
                    "iso3": iso3,
                    "aliases": aliases,
                }
            )
    return candidates


def merge_new_cities(
    curated: Iterable[dict[str, Any]],
    candidates: Iterable[dict[str, Any]],
    min_km: float = MIN_SEPARATION_KM,
) -> list[dict[str, Any]]:
    """Candidates that are not already a curated case or a duplicate conurbation."""
    curated_rows = list(curated)
    curated_names = {_normalise(row["name"]) for row in curated_rows}
    used_slugs = {row["slug"] for row in curated_rows}
    accepted: list[dict[str, Any]] = []

    for candidate in candidates:
        name_key = _normalise(candidate["name"])
        if name_key in curated_names:
            continue
        if any(
            distance_km(candidate["lat"], candidate["lon"], row["lat"], row["lon"]) <= min_km
            for row in curated_rows
        ):
            continue
        if any(
            row["country"] == candidate["country"]
            and distance_km(candidate["lat"], candidate["lon"], row["lat"], row["lon"]) <= min_km
            for row in accepted
        ):
            continue

        slug = slugify(candidate["name"])
        if slug in used_slugs:
            suffix = (candidate.get("iso2") or candidate.get("iso3") or "").lower()
            slug = f"{slug}-{suffix}" if suffix else f"{slug}-2"
        base = slug
        counter = 2
        while slug in used_slugs:
            slug = f"{base}-{counter}"
            counter += 1
        used_slugs.add(slug)

        accepted.append({**candidate, "slug": slug})

    accepted.sort(key=lambda row: row["population"], reverse=True)
    return accepted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=LIMIT, help="cities per country (default 3)")
    parser.add_argument("--json", action="store_true", help="print the candidate rows as JSON")
    args = parser.parse_args()

    candidates = candidate_cities(limit=args.limit)
    by_country: dict[str, int] = {}
    for candidate in candidates:
        by_country[candidate["country"]] = by_country.get(candidate["country"], 0) + 1

    if args.json:
        import json

        print(json.dumps(candidates, ensure_ascii=False, indent=1))
    else:
        print(f"{len(candidates)} candidates across {len(by_country)} countries and territories")
        short = sum(1 for country, count in by_country.items() if count < args.limit)
        print(f"{short} countries offer fewer than {args.limit} populated places in Natural Earth")
        for candidate in candidates[:15]:
            print(
                f"  {candidate['country']:28s} {candidate['name']:20s} "
                f"{candidate['population']:>10,}  {candidate['lat']:7.3f} {candidate['lon']:8.3f}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
