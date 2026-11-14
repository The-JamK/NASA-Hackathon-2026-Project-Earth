// The first case must not wait for bundles it does not need. This check reads
// the app's own init path: only the four small bundles belong on it, while the
// 3.3 MB trend field and the 2.0 MB country averages load on first use.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const root = new URL("../", import.meta.url);
const main = readFileSync(new URL("src/main.js", root), "utf8");

// The init Promise.all is the critical path.
const init = main.match(/const \[[^\]]+\] = await Promise\.all\(\[([\s\S]*?)\]\)/);
if (!init) fail("could not find the init Promise.all");

const critical = [
  "/data/variables.json",
  "/data/points.json",
  "/data/rag_index.json",
  "/data/sources.json",
];
for (const path of critical) {
  if (!init[1].includes(path)) fail(`${path} is no longer loaded at init`);
}
for (const deferred of ["/data/grid.json", "/data/countries.json", "/data/ocean.json", "/data/seaice.json"]) {
  if (init[1].includes(deferred)) fail(`${deferred} is back on the critical path`);
}

// Each deferred bundle has exactly one loader, so it cannot quietly reappear at
// init as a second copy of the same fetch.
for (const [path, loader] of [
  ["/data/grid.json", "ensureGrid"],
  ["/data/countries.json", "ensureCountries"],
  ["/data/ocean.json", "ensureOcean"],
  ["/data/seaice.json", "ensureSeaIce"],
]) {
  const hits = main.split(path).length - 1;
  if (hits !== 1) fail(`${path} is fetched from ${hits} places; expected one (${loader})`);
  if (!main.includes(`function ${loader}(`)) fail(`${loader} is missing`);
}

// Report the bytes the first case actually pays, and fail if they creep back up.
const files = [
  "public/data/variables.json",
  "public/data/points.json",
  "public/data/rag_index.json",
  "public/data/sources.json",
  "dist/assets/app.js",
];
const BUDGET = 2_400_000; // gzip bytes for the first case's code and bundles
let total = 0;
const rows = [];
for (const file of files) {
  let buffer;
  try {
    buffer = readFileSync(new URL(file, root));
  } catch {
    fail(`${file} is missing; run npm run build first`);
  }
  const gz = gzipSync(buffer).length;
  total += gz;
  rows.push(`  ${file.padEnd(30)} ${(gz / 1024).toFixed(0).padStart(6)} kB gzip`);
}

if (total > BUDGET) fail(`the first case costs ${(total / 1024).toFixed(0)} kB gzip (budget 2344)`);

console.log("first load verified: grid and country bundles are lazy");
for (const row of rows) console.log(row);
console.log(`  ${"critical path".padEnd(30)} ${(total / 1024).toFixed(0).padStart(6)} kB gzip`);
