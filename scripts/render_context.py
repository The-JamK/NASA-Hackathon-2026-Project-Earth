"""Render local NASA Blue Marble context crops for featured points.

The 4K Blue Marble texture is already shipped for the globe. Cropping it
locally gives every featured point the same, reliable satellite context
without a second imagery API or a blank tile.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "data"
TEXTURE = ROOT / "public" / "textures" / "earth-blue-marble.jpg"
OUT = PUBLIC / "imagery"
WIDTH, HEIGHT = 640, 360

IMAGERY_IDS = {
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
}


def crop_box(lat: float, lon: float, width: int, height: int) -> tuple[int, int, int, int]:
    lat_span = 14.0
    lon_span = min(
        60.0,
        max(18.0, lat_span * (WIDTH / HEIGHT) / max(0.35, math.cos(math.radians(lat)))),
    )
    center_x = (lon + 180.0) / 360.0 * width
    center_y = (90.0 - lat) / 180.0 * height
    span_x = lon_span / 360.0 * width
    span_y = lat_span / 180.0 * height
    left = max(0, int(round(center_x - span_x / 2)))
    top = max(0, int(round(center_y - span_y / 2)))
    right = min(width, int(round(center_x + span_x / 2)))
    bottom = min(height, int(round(center_y + span_y / 2)))
    return left, top, right, bottom


def main() -> None:
    source = Image.open(TEXTURE).convert("RGB")
    OUT.mkdir(parents=True, exist_ok=True)
    points_path = PUBLIC / "points.json"
    payload = json.loads(points_path.read_text(encoding="utf-8"))

    for point in payload["points"]:
        slug = point["id"]
        if slug not in IMAGERY_IDS:
            continue
        box = crop_box(float(point["lat"]), float(point["lon"]), source.width, source.height)
        crop = source.crop(box)
        if crop.width < 32 or crop.height < 18:
            raise ValueError(f"context crop too small for {slug}: {box}")
        image = crop.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
        image = image.filter(ImageFilter.UnsharpMask(radius=1.1, percent=70, threshold=2))
        draw = ImageDraw.Draw(image)
        cx, cy = WIDTH // 2, HEIGHT // 2
        draw.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), outline=(8, 12, 18), width=4)
        draw.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=(246, 249, 252), outline=(8, 12, 18), width=2)
        destination = OUT / f"{slug}-blue-marble.jpg"
        image.save(destination, "JPEG", quality=84, optimize=True)
        point["imagery"] = f"/data/imagery/{slug}-blue-marble.jpg"
        point["imagery_meta"] = {
            "source": "NASA Blue Marble",
            "source_id": "blue-marble",
            "label": "Blue Marble · NASA",
            "date": None,
            "attribution": "NASA Blue Marble context crop",
            "status": "fallback",
            "reason": "Sentinel-2 L2A scene not selected yet",
        }
        print(f"{slug:8s} {box} -> {destination.stat().st_size // 1024} KB")

    points_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    sources_path = PUBLIC / "sources.json"
    sources = json.loads(sources_path.read_text(encoding="utf-8"))
    sources["sources"] = [s for s in sources["sources"] if s["id"] not in {"gibs", "blue-marble"}]
    sources["sources"].append(
        {
            "id": "blue-marble",
            "name": "NASA Blue Marble",
            "kind": "fallback",
            "status": "ok",
            "detail": f"fallback context crops for {len(IMAGERY_IDS)} featured points",
        }
    )
    sources_path.write_text(json.dumps(sources, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
