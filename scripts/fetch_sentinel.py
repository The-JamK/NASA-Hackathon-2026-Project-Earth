"""Fetch real Sentinel-2 L2A imagery for featured points.

Planetary Computer publishes Sentinel-2 L2A STAC metadata openly, but the
underlying COGs are private Azure blobs: an unsigned GET returns HTTP 409
``PublicAccessNotPermitted``.  The Data API's mosaic service signs those reads
server-side, so the app fetches real Sentinel-2 pixels without a browser key.

For each point we register a low-cloud STAC search, fetch a 3x3 Web Mercator
tile mosaic from the item's ``visual`` asset (TCI, RGB band order 1,2,3), crop
a point-centred 640x360 context image, and record every request status.  A
small raw-asset probe proves the unsigned/signed COG behaviour and the TCI
band metadata; its short-lived SAS token is never written to disk.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
import rasterio
from PIL import Image, ImageDraw, ImageEnhance, ImageStat

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "data"
OUT = PUBLIC / "imagery"
REPORT = ROOT / "data" / "sentinel_report.json"
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
MOSAIC_URL = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic"
SIGN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
COLLECTION = "sentinel-2-l2a"
ASSET = "visual"
WIDTH, HEIGHT = 640, 360
TILE_SIZE = 512  # @2x WebMercatorQuad tiles
TILE_GRID = 3
CLOUD_FILTER = 35

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": "case-files-sentinel/1.0",
        "Accept": "application/json,image/png,*/*;q=0.8",
    }
)

# Preferred low-cloud seasons.  The search still sorts by scene cloud cover.
TARGETS: dict[str, tuple[str, str]] = {
    "nairobi": ("2024-12-01", "2025-03-31"),
    "london": ("2024-06-01", "2024-09-30"),
    "delhi": ("2024-10-01", "2024-12-31"),
    "manaus": ("2024-07-01", "2024-10-31"),
    "niamey": ("2024-10-01", "2024-12-31"),
    "tromso": ("2024-06-01", "2024-08-31"),
    "sydney": ("2024-12-01", "2025-02-28"),
    "lima": ("2025-01-01", "2025-03-31"),
    "tokyo": ("2025-01-01", "2025-02-28"),
    "cairo": ("2024-06-01", "2024-09-30"),
    "mcmurdo": ("2024-11-01", "2025-02-28"),
    "shanghai": ("2024-10-01", "2024-12-31"),
    "dhaka": ("2024-11-01", "2025-01-31"),
    "reykjavik": ("2024-06-01", "2024-08-31"),
}


def _stac_search(lat: float, lon: float, start: str, end: str) -> tuple[dict[str, Any], requests.Response]:
    body = {
        "collections": [COLLECTION],
        "bbox": [lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05],
        "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
        "query": {"eo:cloud_cover": {"lt": CLOUD_FILTER}},
        "sortby": [{"field": "eo:cloud_cover", "direction": "asc"}],
        "limit": 8,
    }
    response = SESSION.post(f"{STAC_URL}/search", json=body, timeout=90)
    return body, response


def _register_mosaic(lat: float, lon: float, start: str, end: str) -> tuple[dict[str, Any], requests.Response]:
    body = {
        "collections": [COLLECTION],
        "bbox": [lon - 0.35, lat - 0.35, lon + 0.35, lat + 0.35],
        "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
        "filter-lang": "cql2-json",
        "filter": {"op": "<=", "args": [{"property": "eo:cloud_cover"}, CLOUD_FILTER]},
        "sortby": [{"field": "eo:cloud_cover", "direction": "asc"}],
    }
    response = SESSION.post(f"{MOSAIC_URL}/register", json=body, timeout=90)
    return body, response


def _bbox_contains(feature: dict[str, Any], lat: float, lon: float) -> bool:
    bbox = feature.get("bbox") or []
    if len(bbox) != 4:
        return False
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def _tile_xy(lat: float, lon: float, zoom: int) -> tuple[float, float]:
    count = 2**zoom
    x = (lon + 180.0) / 360.0 * count
    y = (
        1.0
        - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi
    ) / 2.0 * count
    return x, y


def _zoom_for(lat: float) -> int:
    absolute = abs(lat)
    if 55 <= absolute < 70:
        return 11
    return 12


def _tile_url(search_id: str, zoom: int, x: int, y: int) -> str:
    return f"{MOSAIC_URL}/{search_id}/tiles/WebMercatorQuad/{zoom}/{x}/{y}@2x.png"


def _fetch_mosaic_crop(lat: float, lon: float, search_id: str, zoom: int) -> dict[str, Any]:
    x, y = _tile_xy(lat, lon, zoom)
    tile_x, tile_y = int(x), int(y)
    canvas = Image.new("RGBA", (TILE_GRID * TILE_SIZE, TILE_GRID * TILE_SIZE), (0, 0, 0, 0))
    statuses: list[dict[str, Any]] = []
    params = {
        "assets": ASSET,
        "asset_bidx": f"{ASSET}|1,2,3",
        "nodata": "0",
        "collection": COLLECTION,
        "pixel_selection": "first",
    }
    tiles_ok = 0
    last_url = None
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            url = _tile_url(search_id, zoom, tile_x + dx, tile_y + dy)
            last_url = url
            response = SESSION.get(url, params=params, timeout=90)
            statuses.append(
                {
                    "tile": [tile_x + dx, tile_y + dy],
                    "url": url,
                    "status": response.status_code,
                }
            )
            if response.status_code != 200:
                continue
            try:
                tile = Image.open(BytesIO(response.content)).convert("RGBA")
            except Exception:  # noqa: BLE001 - try the remaining tiles
                statuses[-1]["decode"] = "failed"
                continue
            if tile.size != (TILE_SIZE, TILE_SIZE):
                tile = tile.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS)
            canvas.alpha_composite(tile, ((dx + 1) * TILE_SIZE, (dy + 1) * TILE_SIZE))
            tiles_ok += 1
            time.sleep(0.03)

    point_x = TILE_SIZE + (x - tile_x) * TILE_SIZE
    point_y = TILE_SIZE + (y - tile_y) * TILE_SIZE
    left = int(round(point_x - WIDTH / 2))
    top = int(round(point_y - HEIGHT / 2))
    crop = canvas.crop((left, top, left + WIDTH, top + HEIGHT))
    alpha = crop.getchannel("A")
    transparent = sum(alpha.histogram()[:8]) / float(WIDTH * HEIGHT)
    rgb = crop.convert("RGB")
    extrema = rgb.getextrema()
    stddev = ImageStat.Stat(rgb).stddev
    return {
        "zoom": zoom,
        "tile_center": [tile_x, tile_y],
        "tile_url_template": last_url.rsplit("/", 2)[0] + "/{x}/{y}@2x.png" if last_url else None,
        "params": params,
        "tile_statuses": statuses,
        "tiles_ok": tiles_ok,
        "transparent_fraction": round(transparent, 4),
        "extrema": [list(pair) for pair in extrema],
        "stddev": [round(value, 2) for value in stddev],
        "rgb": rgb,
    }


def _raw_asset_proof(feature: dict[str, Any]) -> dict[str, Any]:
    """Prove the COG is private unsigned, signed with SAS, and TCI RGB uint8."""
    assets = feature.get("assets", {})
    visual = assets.get(ASSET) or {}
    href = visual.get("href")
    proof: dict[str, Any] = {
        "asset": ASSET,
        "asset_type": visual.get("type"),
        "unsigned_url": href,
        "unsigned_status": None,
        "unsigned_body": None,
        "sign_status": None,
        "signed_status": None,
        "signed_content_type": None,
        "signed_content_range": None,
        "sas_required": None,
    }
    if not href:
        proof["error"] = "selected item has no visual asset"
        return proof
    unsigned = SESSION.get(href, headers={"Range": "bytes=0-1023"}, timeout=60)
    proof["unsigned_status"] = unsigned.status_code
    proof["unsigned_body"] = unsigned.text[:200] if unsigned.status_code != 200 else None
    proof["sas_required"] = unsigned.status_code in (401, 403, 409)
    signed_response = SESSION.get(SIGN_URL, params={"href": href}, timeout=60)
    proof["sign_request"] = f"{SIGN_URL}?href=<selected visual href>"
    proof["sign_status"] = signed_response.status_code
    if signed_response.status_code != 200:
        proof["sign_body"] = signed_response.text[:200]
        return proof
    signed = signed_response.json().get("href")
    if not signed:
        proof["error"] = "SAS response did not contain href"
        return proof
    probe = SESSION.get(signed, headers={"Range": "bytes=0-1023"}, timeout=60)
    proof["signed_status"] = probe.status_code
    proof["signed_content_type"] = probe.headers.get("content-type")
    proof["signed_content_range"] = probe.headers.get("content-range")
    try:
        with rasterio.open(signed) as dataset:
            proof["cog"] = {
                "count": dataset.count,
                "dtypes": list(dataset.dtypes),
                "colorinterp": [band.name for band in dataset.colorinterp],
                "scales": list(dataset.scales),
                "offsets": list(dataset.offsets),
                "crs": str(dataset.crs),
                "size": [dataset.width, dataset.height],
                "overviews": dataset.overviews(1)[:6],
            }
    except Exception as error:  # noqa: BLE001 - the mosaic is the primary path
        proof["cog_error"] = f"{type(error).__name__}: {error}"
    return proof


def _render(crop: dict[str, Any], destination: Path) -> None:
    image = crop["rgb"]
    image = ImageEnhance.Contrast(image).enhance(1.08)
    image = ImageEnhance.Color(image).enhance(1.06)
    draw = ImageDraw.Draw(image)
    cx, cy = WIDTH // 2, HEIGHT // 2
    draw.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), outline=(8, 12, 18), width=4)
    draw.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=(246, 249, 252), outline=(8, 12, 18), width=2)
    image.save(destination, "JPEG", quality=88, optimize=True)


def fetch_point(point: dict[str, Any], proof_slot: dict[str, Any]) -> dict[str, Any]:
    slug = point["id"]
    lat, lon = float(point["lat"]), float(point["lon"])
    start, end = TARGETS[slug]
    zoom = _zoom_for(lat)
    report: dict[str, Any] = {
        "slug": slug,
        "name": point["name"],
        "search": {"datetime": f"{start}/{end}", "bbox": [lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05]},
        "mosaic": {},
        "selected": None,
        "fallback": True,
    }

    try:
        _, search_response = _stac_search(lat, lon, start, end)
        report["search"]["url"] = f"{STAC_URL}/search"
        report["search"]["status"] = search_response.status_code
        if search_response.status_code != 200:
            report["error"] = f"STAC search HTTP {search_response.status_code}: {search_response.text[:240]}"
            return report
        features = search_response.json().get("features", [])
        report["search"]["features"] = len(features)
        selected = next((feature for feature in features if _bbox_contains(feature, lat, lon)), None)
        if selected is None:
            report["error"] = "No STAC item bbox contains the point"
            return report
        report["selected"] = {
            "item_id": selected.get("id"),
            "datetime": selected.get("properties", {}).get("datetime"),
            "cloud_cover": selected.get("properties", {}).get("eo:cloud_cover"),
            "bbox": selected.get("bbox"),
        }
        if proof_slot.get("proof") is None:
            proof_slot["proof"] = _raw_asset_proof(selected)
    except Exception as error:  # noqa: BLE001 - fallback must not break the build
        report["error"] = f"STAC search failed: {type(error).__name__}: {error}"
        return report

    try:
        register_body, mosaic_response = _register_mosaic(lat, lon, start, end)
        report["mosaic"]["register_url"] = f"{MOSAIC_URL}/register"
        report["mosaic"]["register_body"] = register_body
        report["mosaic"]["register_status"] = mosaic_response.status_code
        if mosaic_response.status_code != 200:
            report["error"] = f"Mosaic register HTTP {mosaic_response.status_code}: {mosaic_response.text[:240]}"
            return report
        search_id = mosaic_response.json().get("searchid") or mosaic_response.json().get("id")
        report["mosaic"]["search_id"] = search_id
        if not search_id:
            report["error"] = "Mosaic register response did not contain a search id"
            return report
        crop = _fetch_mosaic_crop(lat, lon, search_id, zoom)
        report["mosaic"].update({key: value for key, value in crop.items() if key != "rgb"})
        if crop["tiles_ok"] < 7:
            report["error"] = f"Only {crop['tiles_ok']} of 9 mosaic tiles returned 200"
            return report
        if crop["transparent_fraction"] > 0.5:
            report["error"] = "Mosaic crop is more than half transparent"
            return report
        if max(pair[1] for pair in crop["extrema"]) < 30:
            report["error"] = "Mosaic crop is black or empty"
            return report
        destination = OUT / f"{slug}-sentinel.jpg"
        _render(crop, destination)
    except Exception as error:  # noqa: BLE001 - fallback must not break the build
        report["error"] = f"Mosaic fetch failed: {type(error).__name__}: {error}"
        return report

    selected_meta = report["selected"] or {}
    date = str(selected_meta.get("datetime") or "")[:10]
    years = sorted({date[:4]}) if date else []
    report.update(
        {
            "fallback": False,
            "output": f"/data/imagery/{slug}-sentinel.jpg",
            "bytes": destination.stat().st_size,
            "label": "Sentinel-2 L2A · mosaic",
        }
    )
    point["imagery"] = f"/data/imagery/{slug}-sentinel.jpg"
    point["imagery_meta"] = {
        "source": "Sentinel-2 L2A",
        "source_id": "sentinel-2",
        "label": "Sentinel-2 L2A · mosaic",
        "date": date or None,
        "dates": [date] if date else [],
        "item_ids": [selected_meta.get("item_id")] if selected_meta.get("item_id") else [],
        "cloud_cover": selected_meta.get("cloud_cover"),
        "attribution": (
            f"Contains modified Copernicus Sentinel data {', '.join(years)}, "
            "processed by Microsoft Planetary Computer. "
            f"Low-cloud L2A mosaic; primary scene {date or 'unknown date'}."
        ),
        "collection": COLLECTION,
        "asset": ASSET,
        "bands": "R,G,B (TCI)",
        "scaling": "uint8 0–255",
        "tile_zoom": zoom,
        "mosaic": True,
        "status": "ok",
    }
    report["attribution"] = point["imagery_meta"]["attribution"]
    return report


def main(only: str | None = None) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    points_path = PUBLIC / "points.json"
    payload = json.loads(points_path.read_text(encoding="utf-8"))
    sources_path = PUBLIC / "sources.json"
    sources = json.loads(sources_path.read_text(encoding="utf-8"))
    existing_report: dict[str, Any] = {}
    if only and REPORT.exists():
        try:
            existing_report = json.loads(REPORT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing_report = {}
    report_by_slug = {entry.get("slug"): entry for entry in existing_report.get("points", [])}
    proof_slot: dict[str, Any] = {"proof": existing_report.get("asset_proof")}

    targets = [point for point in payload["points"] if point["id"] in TARGETS]
    if only:
        targets = [point for point in targets if point["id"] == only]

    for point in targets:
        print(f"· Sentinel-2 {point['name']}")
        report = fetch_point(point, proof_slot)
        report_by_slug[point["id"]] = report
        if report["fallback"]:
            existing = point.get("imagery_meta") or {}
            point["imagery_meta"] = {
                **(existing if existing.get("source_id") == "blue-marble" else {}),
                "source": "NASA Blue Marble",
                "source_id": "blue-marble",
                "label": "Blue Marble · NASA",
                "date": None,
                "attribution": "NASA Blue Marble context crop",
                "status": "fallback",
                "reason": report.get("error", "No Sentinel-2 mosaic selected"),
            }
            point["imagery"] = f"/data/imagery/{point['id']}-blue-marble.jpg"
        print(f"  {'fallback: ' + report.get('error', '') if report['fallback'] else report.get('label')}")

    reports = [report_by_slug[point["id"]] for point in payload["points"] if point["id"] in report_by_slug]
    featured = [point for point in payload["points"] if point.get("featured")]
    sentinel_count = sum(
        1 for point in featured if (point.get("imagery_meta") or {}).get("source_id") == "sentinel-2"
    )
    fallback_count = sum(
        1 for point in featured if (point.get("imagery_meta") or {}).get("source_id") == "blue-marble"
    )

    points_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    for source in sources["sources"]:
        if source["id"] == "planetary":
            source["kind"] = "imagery"
            source["detail"] = f"STAC API + Sentinel-2 L2A mosaics for {sentinel_count} featured point(s)"
        if source["id"] == "blue-marble":
            source["detail"] = (
                f"globe texture + fallback context for {fallback_count} featured point(s)"
                if fallback_count
                else "globe texture; all featured points use Sentinel-2"
            )
    sources["generated_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    sources_path.write_text(json.dumps(sources, ensure_ascii=False, indent=1), encoding="utf-8")

    REPORT.write_text(
        json.dumps(
            {
                "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "collection": COLLECTION,
                "asset": ASSET,
                "sign_endpoint": SIGN_URL,
                "mosaic_endpoint": MOSAIC_URL,
                "asset_proof": proof_slot.get("proof"),
                "sentinel_points": sentinel_count,
                "fallback_points": fallback_count,
                "points": reports,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"Sentinel-2: {sentinel_count} points · fallback: {fallback_count} points")
    return 0 if sentinel_count else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="fetch a single featured point slug")
    args = parser.parse_args()
    raise SystemExit(main(only=args.only))
