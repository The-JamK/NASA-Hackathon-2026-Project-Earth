"""Build the place gazetteer the resolver uses for questions the bundle cannot answer.

The app ships 708 stations. A question about a place outside that network ("Is
Gold Coast getting hotter?") still has a coordinate, so it can still be answered
from the GISTEMP field, but only if the place name can be turned into a latitude
and longitude first.

This writes `public/data/gazetteer.json`: a compact, public-domain list of
populated places from Natural Earth's `ne_10m_populated_places` layer, already
cached by `scripts/build_cities.py` in `data/cache/naturalearth`. The file is read
by the resolver (`worker/resolve.js`) on the server, never by the app, so it costs
the browser nothing.

    uv run python scripts/build_gazetteer.py
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    # Running the file directly puts `scripts/` on the path, not the project root.
    sys.path.insert(0, str(ROOT))

from scripts.build_cities import CACHE, PLACES_ZIP, _dbf_rows, _download, _number  # noqa: E402

PUBLIC = ROOT / "public" / "data"
OUTPUT = PUBLIC / "gazetteer.json"

# First-level divisions answer a question the city list cannot: "Is Illinois
# getting hotter?" names a state, not a city, and no populated place is called
# Illinois. The layer ships a label point per division (latitude/longitude), so
# the DBF alone gives a coordinate without parsing a single polygon.
ADMIN1_URL = (
    "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip"
)
ADMIN1_ZIP = CACHE / "ne_10m_admin_1_states_provinces.zip"

# A gazetteer entry is only useful if a person would write that name. Tiny
# hamlets make the matcher slower and the file bigger without answering more
# questions, so the floor is a population of 5,000 or a capital city.
MIN_POPULATION = 5_000


def _normalise(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", folded.lower())).strip()


def regions() -> list[list[object]]:
    """States, provinces and their peers: name, country, label point, type."""
    rows = _dbf_rows(_download(ADMIN1_URL, ADMIN1_ZIP), "admin_1_states_provinces")
    out: list[list[object]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        # This layer's DBF names its columns in lower case (`name`, `admin`),
        # unlike the populated-places layer's upper-case ones.
        name = (row.get("name") or row.get("NAME") or row.get("name_en") or "").strip()
        country = (row.get("admin") or row.get("ADMIN") or row.get("adm0name") or "").strip()
        kind = (row.get("type_en") or row.get("TYPE_EN") or row.get("type") or "").strip()
        lat = _number(row.get("latitude") or row.get("LATITUDE"))
        lon = _number(row.get("longitude") or row.get("LONGITUDE"))
        if not name or not country or lat is None or lon is None:
            continue
        key = (_normalise(name), _normalise(country))
        if key in seen or not key[0]:
            continue
        seen.add(key)
        # "Bavaria" for a layer that calls the state "Bayern": the English name
        # is worth matching, and so is the local one.
        alt = [value.strip() for value in (row.get("name_en"), row.get("name_local")) if value and value.strip()]
        alt = [value for value in alt if _normalise(value) != key[0]]
        out.append([name, country, round(lat, 4), round(lon, 4), kind, ",".join(dict.fromkeys(alt))])
    out.sort(key=lambda item: (str(item[1]), str(item[0])))
    return out


def main() -> int:
    rows = _dbf_rows(PLACES_ZIP, "places")

    seen: set[tuple[str, str]] = set()
    places: list[list[object]] = []
    for row in rows:
        name = (row.get("NAME") or row.get("NAME_EN") or "").strip()
        country = (row.get("ADM0NAME") or "").strip()
        lat = _number(row.get("LATITUDE"))
        lon = _number(row.get("LONGITUDE"))
        population = _number(row.get("POP_MAX")) or 0
        capital = (row.get("ISCAPITAL") or "0") not in {"0", "", "N"}
        if not name or not country or lat is None or lon is None:
            continue
        if population < MIN_POPULATION and not capital:
            continue

        key = (_normalise(name), _normalise(country))
        if key in seen or not key[0]:
            continue
        seen.add(key)

        # The ASCII spelling is what people without a keyboard for "Reykjavík"
        # type, so it is carried alongside the display name.
        alt = (row.get("NAMEASCII") or "").strip()
        alt_keys = [alt] if alt and _normalise(alt) != key[0] else []
        places.append(
            [
                name,
                country,
                round(lat, 4),
                round(lon, 4),
                int(population),
                ",".join(alt_keys),
            ]
        )

    places.sort(key=lambda item: (-int(item[4]), str(item[0])))
    regions_rows = regions()

    payload = {
        "meta": {
            "source": "Natural Earth 1:10m populated places and admin-1 states/provinces (public domain)",
            "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "count": len(places),
            "region_count": len(regions_rows),
            "minimum_population": MIN_POPULATION,
            "fields": ["name", "country", "lat", "lon", "population", "alt_names"],
            "region_fields": ["name", "country", "lat", "lon", "type", "alt_names"],
            "note": (
                "Server-side only: the resolver turns a place name into a coordinate, "
                "then the GISTEMP field supplies the numbers."
            ),
        },
        "places": places,
        "regions": regions_rows,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"gazetteer: {len(places)} places · {len(regions_rows)} regions · "
        f"{OUTPUT.stat().st_size / 1024:.1f} KB → {OUTPUT.relative_to(ROOT)}"
    )
    for probe in ("Gold Coast", "Broadbeach", "Reykjavik", "Ulaanbaatar"):
        hit = next((place for place in places if _normalise(str(place[0])) == _normalise(probe)), None)
        print(f"  {probe:14s} {'· ' + str(hit[1]) + ' ' + str(hit[2]) + ',' + str(hit[3]) if hit else 'not found'}")
    for probe in ("Illinois", "Queensland", "Bavaria"):
        hit = next((row for row in regions_rows if _normalise(str(row[0])) == _normalise(probe)), None)
        print(
            f"  {probe:14s} "
            f"{'· ' + str(hit[1]) + ' ' + str(hit[2]) + ',' + str(hit[3]) + ' (' + str(hit[4]) + ')' if hit else 'not found'}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
