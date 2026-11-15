// Node-side view of the station bundle: index + detail shards, merged back into
// the shape `points.json` used to have. The Python build writes the split
// (scripts/points_bundle.py); this reads it without teaching every check the
// layout.
//
// SHARD_COUNT must match scripts/points_bundle.py and src/bundle.js;
// scripts/verify_bundle.mjs fails if they drift.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const SHARD_COUNT = 16;

export function shardFor(id) {
  let total = 0;
  for (const character of String(id)) total += character.codePointAt(0);
  return total % SHARD_COUNT;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The merged `{meta, points}` payload for a project root. */
export function loadPoints(root = new URL("../", import.meta.url)) {
  const base = typeof root === "string" ? root : root.pathname;
  const data = resolve(base, "public/data");
  const index = readJson(resolve(data, "points.json"));
  const shardCount = index.meta?.detail_shards;
  if (!shardCount) return index;

  const details = new Map();
  for (let shard = 0; shard < shardCount; shard += 1) {
    const name = String(shard).padStart(2, "0");
    let block;
    try {
      block = readJson(resolve(data, "point-details", `${name}.json`));
    } catch {
      continue;
    }
    for (const [id, detail] of Object.entries(block.points || {})) details.set(id, detail);
  }

  const fields = index.meta?.detail_fields || ["series", "trends"];
  const points = (index.points || []).map((entry) => {
    const point = { ...entry };
    const detail = details.get(String(point.id)) || {};
    for (const field of fields) if (field in detail) point[field] = detail[field];
    return point;
  });

  return { meta: index.meta, points };
}
