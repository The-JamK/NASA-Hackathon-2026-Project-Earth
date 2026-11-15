"""Build the place gazetteer the resolver uses for questions the bundle cannot answer.

The app ships 708 stations. A question about a place outside that network ("Is
Gold Coast getting hotter?") still has a coordinate, so it can still be answered
from the GISTEMP field — but only if the place name can be turned into a latitude
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

from scripts.build_cities import PLACES_ZIP, _dbf_rows, _number  # noqa: E402

PUBLIC = ROOT / "public" / "data"
OUTPUT = PUBLIC / "gazetteer.json"

# A gazetteer entry is only useful if a person would write that name. Tiny
# hamlets make the matcher slower and the file bigger without answering more
# questions, so the floor is a population of 5,000 or a capital city.
MIN_POPULATION = 5_000


def _normalise(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", folded.lower())).strip()


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

    payload = {
        "meta": {
            "source": "Natural Earth 1:10m populated places (public domain)",
            "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "count": len(places),
            "minimum_population": MIN_POPULATION,
            "fields": ["name", "country", "lat", "lon", "population", "alt_names"],
            "note": (
                "Server-side only: the resolver turns a place name into a coordinate, "
                "then the GISTEMP field supplies the numbers."
            ),
        },
        "places": places,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"gazetteer: {len(places)} places · {OUTPUT.stat().st_size / 1024:.1f} KB → {OUTPUT.relative_to(ROOT)}")
    for probe in ("Gold Coast", "Broadbeach", "Reykjavik", "Ulaanbaatar"):
        hit = next((place for place in places if _normalise(str(place[0])) == _normalise(probe)), None)
        print(f"  {probe:14s} {'· ' + str(hit[1]) + ' ' + str(hit[2]) + ',' + str(hit[3]) if hit else 'not found'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
