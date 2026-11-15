"""Split the station bundle into an index and per-case detail shards.

`points.json` used to be 6.1 MB: every station carried 4 variables x 3 windows of
full trend records plus a 36-year series, and the app loaded all of it before the
globe drew. Only 171 kB of that is identity, the name, the country, the
coordinate, and only 774 kB is the series. The 5.1 MB of trend diagnostics is
read one station at a time, when a case is opened.

So the bundle is written in two tiers:

  points.json                  identity + a four-number summary per variable and
                               window, which is all the globe needs to colour a
                               dot and label it
  point-details/<shard>.json   the full trend records and annual series for the
                               stations in that shard

A station's shard is a stable function of its id, so the app can build the URL
without an index of the index. `SHARD_COUNT` is duplicated in `src/bundle.js`
(the app) and `scripts/bundle.mjs` (the Node checks); `verify_bundle.mjs` fails
if the three disagree.

Everything that needs the whole record, the build, the Python verifiers, the
Node verifiers, goes through `load_bundle`, so no consumer has to know the
layout.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SHARD_COUNT = 16
DETAIL_FIELDS = ("series", "trends")

# The verdict strings are long and appear 12 times per station; one letter pair
# carries the same meaning to the globe's colour and label.
VERDICT_CODES = {
    "significant increasing": "si",
    "significant decreasing": "sd",
    "no significant trend": "ns",
    "exploratory": "ex",
}


def shard_for(point_id: str) -> int:
    """The shard a station belongs to. Must match `shardFor` in src/bundle.js."""
    return sum(ord(character) for character in str(point_id)) % SHARD_COUNT


def shard_name(index: int) -> str:
    return f"{index:02d}"


def summarise(trends: dict[str, Any] | None) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for code, by_window in (trends or {}).items():
        per_window: dict[str, Any] = {}
        for window, trend in (by_window or {}).items():
            if not trend:
                continue
            per_window[window] = {
                "s": trend.get("slope_per_decade"),
                "p": trend.get("p_value"),
                "n": trend.get("n"),
                "v": VERDICT_CODES.get(str(trend.get("verdict")), "ns"),
            }
        if per_window:
            summary[code] = per_window
    return summary


def split(payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Full payload -> (index payload, one detail map per shard)."""
    index_points: list[dict[str, Any]] = []
    shards: list[dict[str, Any]] = [{} for _ in range(SHARD_COUNT)]
    for point in payload.get("points", []):
        entry = {key: value for key, value in point.items() if key not in DETAIL_FIELDS}
        entry["summary"] = summarise(point.get("trends"))
        index_points.append(entry)
        detail = {field: point[field] for field in DETAIL_FIELDS if field in point}
        shards[shard_for(point.get("id"))][str(point.get("id"))] = detail

    meta = {
        **payload.get("meta", {}),
        "detail_shards": SHARD_COUNT,
        "detail_fields": list(DETAIL_FIELDS),
        "detail_pattern": "data/point-details/{shard}.json",
    }
    return {"meta": meta, "points": index_points}, shards


def write_bundle(public: Path, payload: dict[str, Any]) -> dict[str, Any]:
    """Write both tiers. Returns the size report the build prints."""
    index_payload, shards = split(payload)

    index_path = public / "points.json"
    index_path.write_text(
        json.dumps(index_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    detail_dir = public / "point-details"
    detail_dir.mkdir(parents=True, exist_ok=True)
    # Stale shards from a larger previous bundle would still be served, so the
    # directory is rewritten from scratch rather than only overwritten.
    for stale in detail_dir.glob("*.json"):
        stale.unlink()

    detail_bytes = 0
    for index, entries in enumerate(shards):
        if not entries:
            continue
        path = detail_dir / f"{shard_name(index)}.json"
        body = {
            "meta": {"shard": shard_name(index), "points": len(entries)},
            "points": entries,
        }
        path.write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        detail_bytes += path.stat().st_size

    return {
        "index_bytes": index_path.stat().st_size,
        "detail_bytes": detail_bytes,
        "details": sum(1 for entries in shards if entries),
    }


def load_bundle(public: Path) -> dict[str, Any]:
    """The merged payload, exactly the shape `points.json` used to have.

    A bundle that has not been split (only `points.json` on disk) is returned as
    it is, so an older tree and a newer one both work.
    """
    index_path = public / "points.json"
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    meta = payload.get("meta", {})
    shard_count = meta.get("detail_shards")
    if not shard_count:
        return payload

    details: dict[str, Any] = {}
    detail_dir = public / "point-details"
    for shard in sorted(detail_dir.glob("*.json")):
        block = json.loads(shard.read_text(encoding="utf-8"))
        for point_id, detail in (block.get("points") or {}).items():
            details[point_id] = detail

    points: list[dict[str, Any]] = []
    for entry in payload.get("points", []):
        point = dict(entry)
        detail = details.get(str(point.get("id"))) or {}
        for field in meta.get("detail_fields", DETAIL_FIELDS):
            if field in detail:
                point[field] = detail[field]
        points.append(point)

    return {"meta": meta, "points": points}
