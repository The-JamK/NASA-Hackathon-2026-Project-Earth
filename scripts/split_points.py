"""Re-split the committed station bundle without rebuilding it.

`scripts/build_data.py` writes both tiers through `scripts/points_bundle.py`, but
that needs NASA POWER credentials. This rewrites the split from whatever is on
disk, so the browser bundle can be regenerated offline and so a re-split is
proven identical to the build's own output.

    uv run python scripts/split_points.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import points_bundle  # noqa: E402

PUBLIC = ROOT / "public" / "data"


def main() -> int:
    merged = points_bundle.load_bundle(PUBLIC)
    report = points_bundle.write_bundle(PUBLIC, merged)

    index = json.loads((PUBLIC / "points.json").read_text(encoding="utf-8"))
    print(f"points: {len(index['points'])} stations · {len(index['points'][0])} index fields")
    print(f"  points.json          {report['index_bytes'] / 1024:8.1f} KB")
    print(
        f"  point-details/       {report['detail_bytes'] / 1024:8.1f} KB "
        f"across {report['details']} shards of {points_bundle.SHARD_COUNT}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
