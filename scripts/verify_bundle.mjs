// The station bundle ships in two tiers: `points.json` (identity + a verdict
// summary, loaded with the app) and `point-details/<shard>.json` (full trend
// records and annual series, fetched when a case opens). This check holds the
// split together: the shard function must agree across the app, Node and Python,
// the index must carry no series, every summary must match the record it
// summarises, and the win must actually exist.
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { loadPoints, shardFor, SHARD_COUNT } from "./bundle.mjs";

let failures = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const json = (path) => JSON.parse(read(path));

const index = json("public/data/points.json");
const merged = loadPoints(root);
const meta = index.meta || {};

// 1. One shard function, three runtimes.
{
  const app = read("src/bundle.js").match(/DETAIL_SHARD_COUNT\s*=\s*(\d+)/)?.[1];
  const node = read("scripts/bundle.mjs").match(/SHARD_COUNT\s*=\s*(\d+)/)?.[1];
  const python = read("scripts/points_bundle.py").match(/SHARD_COUNT\s*=\s*(\d+)/)?.[1];
  const shipped = String(meta.detail_shards ?? "");
  if (!app || !node || !python) fail("a shard count constant is missing");
  if (!(app === node && node === python)) {
    fail(`shard counts disagree: src/bundle.js ${app}, scripts/bundle.mjs ${node}, points_bundle.py ${python}`);
  }
  if (app !== shipped) fail(`the bundle is split into ${shipped} shards, the code expects ${app}`);
  if (SHARD_COUNT !== Number(app)) fail("this check imports a different shard count than the app uses");
  if (!(meta.detail_fields || []).includes("series")) fail("the index does not name series as a detail field");
  if (!(meta.detail_fields || []).includes("trends")) fail("the index does not name trends as a detail field");
}

// 2. The index is an index: no series, no trend records, every station summarised.
{
  if (!index.points?.length) fail("the station index is empty");
  const withSeries = index.points.filter((point) => point.series);
  const withTrends = index.points.filter((point) => point.trends);
  if (withSeries.length) fail(`${withSeries.length} index stations still carry a series`);
  if (withTrends.length) fail(`${withTrends.length} index stations still carry trend records`);
  const missingSummary = index.points.filter(
    (point) => !point.summary || !Object.keys(point.summary).length
  );
  if (missingSummary.length) fail(`${missingSummary.length} index stations have no summary`);
  for (const field of ["id", "name", "country", "lat", "lon", "featured"]) {
    if (index.points.some((point) => point[field] === undefined)) fail(`an index station has no ${field}`);
  }
}

// 3. Every station's detail is reachable through the shipped shard function, and
//    no shard file holds a station that belongs in another one.
{
  const dir = "public/data/point-details";
  const files = readdirSync(new URL(`${dir}/`, root)).filter((name) => name.endsWith(".json"));
  if (files.length !== SHARD_COUNT) fail(`${files.length} shard files for ${SHARD_COUNT} shards`);
  const seen = new Set();
  for (const file of files) {
    const block = json(`${dir}/${file}`);
    const shard = Number(file.replace(".json", ""));
    if (Number(block.meta?.shard) !== shard) fail(`${file} says it is shard ${block.meta?.shard}`);
    for (const [id, detail] of Object.entries(block.points || {})) {
      if (shardFor(id) !== shard) fail(`${id} sits in shard ${file}, shardFor says ${shardFor(id)}`);
      if (seen.has(id)) fail(`${id} appears in more than one shard`);
      seen.add(id);
      if (!detail.series) fail(`${id} has no series in its shard`);
      if (!detail.trends) fail(`${id} has no trend records in its shard`);
    }
  }
  const ids = new Set(index.points.map((point) => point.id));
  if (seen.size !== ids.size) fail(`${seen.size} shard stations for ${ids.size} index stations`);
  for (const id of ids) if (!seen.has(id)) fail(`${id} has no detail shard`);
  for (const id of seen) if (!ids.has(id)) fail(`shard station ${id} is not in the index`);
}

// 4. The merged view is what a case shows: full records for every station.
{
  if (merged.points.length !== index.points.length) fail("the merged bundle loses stations");
  const incomplete = merged.points.filter(
    (point) => !point.series?.T2M || !point.trends?.T2M?.[meta.windows?.[0]]
  );
  if (incomplete.length) fail(`${incomplete.length} merged stations have no T2M record`);
}

// 5. Every four-number summary is the record it summarises, a stale index that
//    disagrees with its shard would colour the globe by a trend it does not have.
{
  const CODES = { si: "significant increasing", sd: "significant decreasing", ns: "no significant trend", ex: "exploratory" };
  let compared = 0;
  for (const point of merged.points) {
    const summary = point.summary || {};
    for (const [code, byWindow] of Object.entries(point.trends || {})) {
      for (const [windowKey, trend] of Object.entries(byWindow || {})) {
        // A masked variable stores an explicit null for the window (MERRA-2 has
        // no root-zone soil wetness over ice), and no summary is claimed for it.
        if (!trend) continue;
        const entry = summary[code]?.[windowKey];
        if (!entry) {
          fail(`${point.id} ${code} ${windowKey} is in the record but not the summary`);
          continue;
        }
        if (entry.v !== (Object.entries(CODES).find(([, name]) => name === trend.verdict)?.[0] || "ns")) {
          fail(`${point.id} ${code} ${windowKey} summary verdict ${entry.v} vs ${trend.verdict}`);
        }
        if (Math.abs(Number(entry.s) - Number(trend.slope_per_decade)) > 1e-9) {
          fail(`${point.id} ${code} ${windowKey} summary slope differs from the record`);
        }
        if (Math.abs(Number(entry.p) - Number(trend.p_value)) > 1e-12) {
          fail(`${point.id} ${code} ${windowKey} summary p differs from the record`);
        }
        if (Number(entry.n) !== Number(trend.n)) {
          fail(`${point.id} ${code} ${windowKey} summary n differs from the record`);
        }
        compared += 1;
      }
    }
  }
  if (compared < merged.points.length * 10) fail(`only ${compared} summaries were compared`);
  console.log(`summaries: ${compared} checked against their stored slope, p, n and verdict`);
}

// 6. The point of the exercise: the first load is smaller.
{
  const indexGzip = gzipSync(Buffer.from(read("public/data/points.json"))).length;
  const mergedRaw = Buffer.from(JSON.stringify({ meta, points: merged.points }));
  const mergedGzip = gzipSync(mergedRaw).length;
  const share = indexGzip / mergedGzip;
  if (share > 0.32) {
    fail(`the index is ${(share * 100).toFixed(0)}% of the whole station bundle; the split bought nothing`);
  }
  console.log(
    `bundle: ${index.points.length} stations · index ${(indexGzip / 1024).toFixed(0)} kB gzip vs ` +
      `${(mergedGzip / 1024).toFixed(0)} kB whole (${(share * 100).toFixed(0)}%) · ` +
      `${SHARD_COUNT} shards`
  );
}

if (failures) {
  console.error(`\n${failures} bundle check(s) failed`);
  process.exit(1);
}
console.log("bundle verified: index and detail shards agree, summary matches the record");
