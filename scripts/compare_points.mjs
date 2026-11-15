// The deployed points.json is compared with the built one field by field, because
// a build refreshes the live conditions it ships: the `live` blocks carry the
// hour's readings and the byte hashes in verify_live.sh cannot be used for this
// file, as they differ by exactly that. Everything else, the series, the trends
// and the metadata, must agree, and the first difference found is printed.
//
//   node scripts/compare_points.mjs https://example.test
import { readFileSync } from "node:fs";

const base = (process.argv[2] || "").replace(/\/+$/, "");
const local = JSON.parse(readFileSync(new URL("../dist/data/points.json", import.meta.url), "utf8"));

const response = await fetch(`${base}/data/points.json`, { signal: AbortSignal.timeout(30000) });
if (!response.ok) {
  console.error(`FAIL: ${base}/data/points.json answers ${response.status}`);
  process.exit(1);
}
const live = await response.json();

// The values a build is allowed to move: the current-conditions block each point
// carries, and the stamps on the bundle itself.
const refreshed = (key) => key === "live" || /^(valid_time|fetched_at|observed_at|updated|generated_at)$/.test(key);
let refreshedBlocks = 0;

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === "live") {
        refreshedBlocks += 1;
        continue;
      }
      if (!refreshed(key)) out[key] = strip(inner);
    }
    return out;
  }
  return value;
}

function firstDifference(a, b, path) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path} is an array on one side only`;
    if (a.length !== b.length) return `${path} holds ${a.length} on one side and ${b.length} on the other`;
    for (let index = 0; index < a.length; index += 1) {
      const found = firstDifference(a[index], b[index], `${path}[${index}]`);
      if (found) return found;
    }
    return "";
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = Object.keys(a);
    const right = Object.keys(b);
    const missing = left.filter((key) => !right.includes(key));
    const extra = right.filter((key) => !left.includes(key));
    if (missing.length || extra.length) {
      return `${path} has different keys (missing ${missing.join(", ") || "none"}; unexpected ${extra.join(", ") || "none"})`;
    }
    for (const key of left) {
      const found = firstDifference(a[key], b[key], `${path}.${key}`);
      if (found) return found;
    }
    return "";
  }
  if (a !== b) return `${path} is ${JSON.stringify(a)?.slice(0, 80)} here and ${JSON.stringify(b)?.slice(0, 80)} live`;
  return "";
}

const difference = firstDifference(strip(local), strip(live), "points");
if (difference) {
  console.error(`FAIL: points.json ${difference}`);
  process.exit(1);
}

// Say how much was set aside, so the line means something rather than "ok".
console.log(`  points.json matches dist apart from ${refreshedBlocks} refreshed live blocks`);
