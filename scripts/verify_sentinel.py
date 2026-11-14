"""Verify the per-point imagery contract and the recorded Sentinel-2 proof."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "data"
REPORT = ROOT / "data" / "sentinel_report.json"
FAILURES = 0


def fail(message: str) -> None:
    global FAILURES
    print(f"FAIL: {message}")
    FAILURES += 1


def load(path: Path) -> dict:
    if not path.exists():
        fail(f"missing {path.relative_to(ROOT)}")
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    points = load(PUBLIC / "points.json")
    sources = load(PUBLIC / "sources.json")
    report = load(REPORT)
    if not points or not sources or not report:
        return _finish()

    featured = [point for point in points.get("points", []) if point.get("featured")]
    if len(featured) < 10:
        fail(f"expected at least 10 featured points, found {len(featured)}")

    sentinel = 0
    fallback = 0
    reports = {entry.get("slug"): entry for entry in report.get("points", [])}
    for point in featured:
        slug = point.get("id")
        meta = point.get("imagery_meta") or {}
        path = ROOT / "public" / str(point.get("imagery", "")).lstrip("/")
        if not point.get("imagery") or not path.exists():
            fail(f"{slug}: imagery path is missing")
            continue
        if path.stat().st_size < 10_000:
            fail(f"{slug}: imagery is smaller than 10 KB")
        if not meta.get("source_id") or not meta.get("label") or not meta.get("attribution"):
            fail(f"{slug}: imagery_meta is incomplete")
            continue
        entry = reports.get(slug)
        if entry is None:
            fail(f"{slug}: no Sentinel report entry")
            continue
        if meta["source_id"] == "sentinel-2":
            sentinel += 1
            if entry.get("fallback"):
                fail(f"{slug}: bundle says Sentinel but report says fallback")
            if meta.get("status") != "ok":
                fail(f"{slug}: Sentinel imagery status is not ok")
            selected = entry.get("selected") or {}
            if not selected.get("item_id") or not selected.get("datetime"):
                fail(f"{slug}: report is missing the selected STAC item")
            mosaic = entry.get("mosaic") or {}
            statuses = mosaic.get("tile_statuses") or []
            if mosaic.get("tiles_ok") != 9 or len(statuses) != 9:
                fail(f"{slug}: expected 9 successful mosaic tiles")
            if any(tile.get("status") != 200 for tile in statuses):
                fail(f"{slug}: one or more mosaic tiles did not return 200")
            if any(
                not str(tile.get("url", "")).startswith("https://planetarycomputer.microsoft.com/")
                for tile in statuses
            ):
                fail(f"{slug}: mosaic tile request URL is missing")
            if not mosaic.get("tile_url_template"):
                fail(f"{slug}: mosaic tile URL template is missing")
            params = mosaic.get("params") or {}
            if params.get("assets") != "visual" or params.get("asset_bidx") != "visual|1,2,3":
                fail(f"{slug}: mosaic does not request TCI RGB band order")
            extrema = mosaic.get("extrema") or []
            if not extrema or max(pair[1] for pair in extrema) < 30:
                fail(f"{slug}: mosaic crop is black or empty")
            if float(mosaic.get("transparent_fraction", 1)) > 0.5:
                fail(f"{slug}: mosaic crop is mostly transparent")
            if "sentinel" not in str(point.get("imagery")):
                fail(f"{slug}: Sentinel point does not use a -sentinel image")
            if "Copernicus" not in meta["attribution"]:
                fail(f"{slug}: Sentinel attribution is missing Copernicus")
        elif meta["source_id"] == "blue-marble":
            fallback += 1
            if not entry.get("fallback") or not entry.get("error"):
                fail(f"{slug}: fallback is not backed by a recorded failure")
            if meta.get("status") != "fallback" or not meta.get("reason"):
                fail(f"{slug}: fallback metadata is incomplete")
            if "blue-marble" not in str(point.get("imagery")):
                fail(f"{slug}: fallback does not use the Blue Marble file")
        else:
            fail(f"{slug}: unknown imagery source {meta['source_id']}")

    if sentinel < 10:
        fail(f"expected at least 10 Sentinel-2 points, found {sentinel}")
    if sentinel + fallback != len(featured):
        fail("not every featured point has a source-labelled image")

    proof = report.get("asset_proof") or {}
    if proof.get("unsigned_status") not in (401, 403, 409):
        fail("unsigned COG probe did not record a private-access response")
    if proof.get("sign_status") != 200:
        fail("SAS signing probe did not return 200")
    if proof.get("signed_status") != 206:
        fail("signed COG range probe did not return 206")
    cog = proof.get("cog") or {}
    if cog.get("count") != 3:
        fail("visual COG is not three-band")
    if [dtype.lower() for dtype in cog.get("dtypes", [])] != ["uint8", "uint8", "uint8"]:
        fail("visual COG is not uint8 RGB")
    if [band.lower() for band in cog.get("colorinterp", [])] != ["red", "green", "blue"]:
        fail("visual COG color interpretation is not RGB")
    if any(not math.isclose(float(value), 1.0) for value in cog.get("scales", [])):
        fail("visual COG scale is not 1.0")

    source_map = {source.get("id"): source for source in sources.get("sources", [])}
    planetary = source_map.get("planetary") or {}
    if planetary.get("kind") != "imagery":
        fail("Planetary Computer source is not marked as imagery")
    if str(sentinel) not in str(planetary.get("detail", "")):
        fail("Planetary Computer detail does not report the Sentinel point count")
    if re.search(r"[?&](sig|se|sv|spr)=", json.dumps(report)):
        fail("report contains a SAS token")

    print(
        f"imagery: {sentinel} Sentinel-2 L2A · {fallback} Blue Marble fallback · "
        f"{len(featured)} featured points"
    )
    print(
        f"proof: unsigned COG HTTP {proof.get('unsigned_status')} · "
        f"SAS {proof.get('sign_status')} · signed range {proof.get('signed_status')} · "
        f"{cog.get('count')} bands {','.join(cog.get('dtypes', []))}"
    )
    print("sentinel verified")
    return _finish()


def _finish() -> int:
    if FAILURES:
        print(f"\n{FAILURES} sentinel check(s) failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
