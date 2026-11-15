// The station bundle is two tiers: `points.json` carries identity and a summary
// per variable and window (enough to draw and label 708 dots), and the full
// trend records and annual series live in `point-details/<shard>.json`, fetched
// only when a case is opened.
//
// A station's shard is a stable function of its id, so the URL needs no index of
// the index. SHARD_COUNT must match scripts/points_bundle.py and
// scripts/bundle.mjs; scripts/verify_bundle.mjs fails if they drift.

export const DETAIL_SHARD_COUNT = 16;

export function shardFor(id) {
  let total = 0;
  for (const character of String(id)) total += character.codePointAt(0);
  return total % DETAIL_SHARD_COUNT;
}

export function detailShardName(id) {
  return String(shardFor(id)).padStart(2, "0");
}

/** Path of the shard that holds this station, or `""` for a split-less bundle. */
export function detailPath(id, meta) {
  if (!meta?.detail_shards) return "";
  return `/data/point-details/${detailShardName(id)}.json`;
}

/** Merge one shard into the index in place, so every existing reader keeps working. */
export function hydrate(points, block) {
  const fields = block?.meta?.detail_fields || ["series", "trends"];
  const byId = new Map(points.map((point) => [String(point.id), point]));
  const hydrated = [];
  for (const [id, detail] of Object.entries(block?.points || {})) {
    const point = byId.get(id);
    if (!point) continue;
    for (const field of fields) {
      if (field in detail) point[field] = detail[field];
    }
    hydrated.push(point);
  }
  return hydrated;
}

/** Strip a point back to its index form when its shard is evicted. */
export function dehydrate(points) {
  for (const point of points) {
    delete point.series;
    delete point.trends;
  }
}

const VERDICTS = {
  si: "significant increasing",
  sd: "significant decreasing",
  ns: "no significant trend",
  ex: "exploratory",
};

/**
 * A trend-like record from the index summary, for the globe's colour and label.
 * Deliberately carries only what those two need: the full record is in the
 * shard, and a summary must never be mistaken for it.
 */
export function summaryTrend(point, code, windowKey) {
  const summary = point?.summary?.[code]?.[windowKey];
  if (!summary) return null;
  const verdict = VERDICTS[summary.v] || "no significant trend";
  return {
    slope_per_decade: summary.s,
    p_value: summary.p,
    n: summary.n,
    verdict,
    exploratory: summary.v === "ex",
    significant: summary.v === "si" || summary.v === "sd",
    summary: true,
  };
}

/** The full record when a case holds it, otherwise the summary. */
export function trendOf(point, code, windowKey) {
  return point?.trends?.[code]?.[windowKey] || summaryTrend(point, code, windowKey);
}
