"""Refresh the live conditions in the published bundle, and nothing else.

`build_data.py --refresh-live` does the same thing as part of a full rebuild, but
a rebuild needs the POWER cache under `data/cache/`, which is not tracked: on a
clean checkout it would fetch 708 stations from NASA POWER before it touched a
single live reading. This script touches only the stored live records, so it is
seconds of work and six API calls, which is what a scheduled deploy needs.

Nothing is fitted here and no trend is touched, so the bundle's statistics are
untouched: `scripts/refit_bundle.py --check` still passes afterwards.

Safety, because this runs unattended on a deploy:

* a reading is only accepted when the timestamp parses and all three values are
  finite numbers, so a half-empty upstream answer never replaces a good record;
* every reading is collected before anything is written, so one failure cannot
  leave the bundle part-refreshed;
* each file is written to a temporary name and moved into place, so a crash
  cannot leave truncated JSON where the build will read it;
* both files are re-read before success is reported;
* with no credentials, no usable reading, or a missing bundle, it prints a
  notice and exits 0, leaving the committed snapshot alone — the deploy then
  ships exactly what it shipped before.

    uv run python scripts/refresh_live.py                 # uses ./.env
    uv run python scripts/refresh_live.py --env-file "$RUNNER_TEMP/x.env"
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.envfile import load_env  # noqa: E402
from scripts.fetch_sources import fetch_meteomatics  # noqa: E402

MEASURES = ("t_2m", "precip_1h", "wind_speed_10m")


def usable(live: object) -> bool:
    """A reading worth replacing a working one: a real stamp and three numbers."""
    if not isinstance(live, dict):
        return False
    stamp = live.get("valid_time")
    if not isinstance(stamp, str):
        return False
    try:
        datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return False
    for key in MEASURES:
        value = live.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        if not math.isfinite(float(value)):
            return False
    return True


def write_atomic(path: Path, text: str) -> None:
    temporary = path.with_name("." + path.name + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=str(ROOT / ".env"))
    parser.add_argument("--data-dir", default=str(ROOT / "public" / "data"))
    args = parser.parse_args()

    env = load_env(Path(args.env_file).expanduser())
    username = env.get("METEOMATICS_USERNAME", "")
    password = env.get("METEOMATICS_PASSWORD", "")
    if not (username and password):
        print("notice: no Meteomatics credentials, so the committed snapshot ships unchanged")
        return 0

    data_dir = Path(args.data_dir)
    points_path = data_dir / "points.json"
    sources_path = data_dir / "sources.json"
    if not points_path.exists() or not sources_path.exists():
        print(f"notice: no bundle in {data_dir}, nothing to refresh")
        return 0

    try:
        payload = json.loads(points_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"notice: {points_path} is not valid JSON, leaving it alone")
        return 0

    points = payload.get("points") or []
    targets = [point for point in points if point.get("live")]
    if not targets:
        print("notice: no live records in the bundle, nothing to refresh")
        return 0

    # Collect first, write later: a failure halfway through fetching must not
    # leave the bundle with some points refreshed and others not.
    fresh: dict[str, dict] = {}
    for point in targets:
        live = fetch_meteomatics(
            point["id"], float(point["lat"]), float(point["lon"]), username, password, refresh=True
        )
        if not live:
            print(f"  {point['id']}: upstream did not answer, keeping the stored snapshot")
        elif not usable(live):
            print(f"  {point['id']}: incomplete reading, keeping the stored snapshot")
        else:
            fresh[point["id"]] = live
            print(f"  {point['id']}: {live['valid_time']} · {live['t_2m']} °C")

    if not fresh:
        print("notice: no usable reading, the bundle is unchanged")
        return 0

    for point in targets:
        if point["id"] in fresh:
            point["live"] = fresh[point["id"]]

    # Same shape the build writes: compact, no ASCII escaping, so a refresh shows
    # up as a one-line diff in points.json rather than a reformat of the bundle.
    write_atomic(points_path, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

    try:
        sources = json.loads(sources_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print("notice: sources.json is not valid JSON, refreshed points.json only")
        sources = None
    if sources is not None:
        sources["generated_utc"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        for item in sources.get("sources", []):
            if item.get("id") == "meteomatics":
                item["status"] = "ok"
                item["detail"] = f"Current conditions for {len(fresh)} featured point(s)"
                break
        write_atomic(sources_path, json.dumps(sources, ensure_ascii=False, indent=1))

    # Read both back, so a broken write fails here instead of in the build.
    json.loads(points_path.read_text(encoding="utf-8"))
    if sources is not None:
        json.loads(sources_path.read_text(encoding="utf-8"))

    print(f"refreshed {len(fresh)} of {len(targets)} live records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
