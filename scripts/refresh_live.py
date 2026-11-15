"""Refresh the live conditions in the published bundle, and nothing else.

`build_data.py --refresh-live` does the same thing as part of a full rebuild, but
a rebuild needs the POWER cache under `data/cache/`, which is not tracked: on a
clean checkout it would fetch 708 stations from NASA POWER before it touched a
single live reading. This script touches only the stored live records, so it is
seconds of work and six API calls, which is what a scheduled deploy needs.

Nothing is fitted here and no trend is touched, so the bundle's statistics are
untouched: `scripts/refit_bundle.py --check` still passes afterwards.

    uv run python scripts/refresh_live.py                 # uses ./.env
    uv run python scripts/refresh_live.py --env-file "$RUNNER_TEMP/x.env"

Exits 0 with a notice when there are no credentials or no live records, so it is
safe to run from a fork or a keyless clone: the committed snapshot then ships.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.envfile import load_env  # noqa: E402
from scripts.fetch_sources import fetch_meteomatics  # noqa: E402


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
    payload = json.loads(points_path.read_text(encoding="utf-8"))
    points = payload.get("points") or []
    targets = [point for point in points if point.get("live")]
    if not targets:
        print("notice: no live records in the bundle, nothing to refresh")
        return 0

    refreshed = 0
    for point in targets:
        live = fetch_meteomatics(
            point["id"], float(point["lat"]), float(point["lon"]), username, password, refresh=True
        )
        if not live:
            print(f"  {point['id']}: upstream did not answer, keeping the stored snapshot")
            continue
        point["live"] = live
        refreshed += 1
        print(f"  {point['id']}: {live.get('valid_time')} · {live.get('t_2m')} °C")

    if not refreshed:
        print("notice: nothing refreshed, the bundle is unchanged")
        return 0

    # Same shape the build writes: compact, no ASCII escaping, so a refresh shows
    # up as a one-line diff in points.json rather than a reformat of the bundle.
    points_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    sources_path = data_dir / "sources.json"
    sources = json.loads(sources_path.read_text(encoding="utf-8"))
    sources["generated_utc"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for item in sources.get("sources", []):
        if item.get("id") == "meteomatics":
            item["status"] = "ok"
            item["detail"] = f"Current conditions for {refreshed} featured point(s)"
            break
    sources_path.write_text(
        json.dumps(sources, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    print(f"refreshed {refreshed} of {len(targets)} live records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
