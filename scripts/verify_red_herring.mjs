// The demo's twist has to stay true after a data rebuild. The case is derived
// from the bundle, so this check asserts the derivation exists, that it picks a
// case the app will stamp NOT PROVEN, and that the station can still be asked
// for by name now that its chip is gone.
import { readFileSync } from "node:fs";
import { deriveSteepUnproven } from "../src/herring.js";
import { loadPoints } from "./bundle.mjs";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const points = loadPoints(new URL("../", import.meta.url));
const windowKey = points.meta.windows[0];
const featured = points.points.filter((point) => point.featured);

const seed = deriveSteepUnproven(points.points, windowKey);
if (!seed) fail(`no featured case in ${windowKey} is steep but unproven`);

// The app derives it from the index alone, before any station record is
// fetched: the summary has to pick the same case as the full trend records.
const index = JSON.parse(readFileSync(new URL("../public/data/points.json", import.meta.url), "utf8"));
const fromIndex = deriveSteepUnproven(index.points, windowKey);
if (!fromIndex) fail("the shipped index cannot derive the red herring on its own");
if (fromIndex.point.id !== seed.point.id) {
  fail(`the index picks ${fromIndex.point.id}, the full bundle picks ${seed.point.id}`);
}

const trend = seed.trend;
if (!seed.point.featured) fail("the seed is not a featured case");
if (trend.exploratory) fail("the seed is an exploratory record, not a tested one");
if (!(Number(trend.n) >= 20)) fail(`the seed has only ${trend.n} annual means`);
if (!(Number(trend.p_value) >= 0.05)) fail(`the seed's HAC p is ${trend.p_value}`);
if (trend.verdict !== "no significant trend") fail(`the seed verdict is "${trend.verdict}"`);

// Steep is the point of the twist: the seed must sit in the steeper half of the
// featured cases, not merely be any record that failed its test. It currently
// lands just below five cases that are significant, which is the story: the same
// rate as London or Nairobi, and still not proven.
const ranked = featured
  .map((point) => ({
    id: point.id,
    slope: Math.abs(Number(point.trends?.T2M?.[windowKey]?.slope_per_decade)),
  }))
  .filter((entry) => Number.isFinite(entry.slope))
  .sort((a, b) => b.slope - a.slope);
const rank = ranked.findIndex((entry) => entry.id === seed.point.id) + 1;
const median = ranked[Math.floor(ranked.length / 2)].slope;
if (rank < 1 || rank > Math.ceil(ranked.length / 2)) {
  fail(`the seed is ranked ${rank} of ${ranked.length} by steepness, outside the steeper half`);
}
if (seed.slope < median) {
  fail(`the seed's ${seed.slope.toFixed(3)} is below the featured median ${median.toFixed(3)}`);
}

// The chip is gone from the ask strip, so the case is reached by asking for the
// station by name. That only works if the shipped index carries it, and the
// strip must not quietly bring the chip back.
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
if (main.includes("chip-herring") || main.includes("Steep, but not proven")) {
  fail("main.js still renders the red-herring chip");
}
if (!main.includes("renderSuggestions")) fail("main.js does not render the ask chips");
if (!index.points.some((point) => point.id === seed.point.id && point.name)) {
  fail("the seed station is missing from the shipped index, so it cannot be asked by name");
}

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
if (!html.includes('id="suggestions"')) fail("app.html has no suggestion strip");

console.log(
  `red herring verified: ${seed.point.name} ${trend.slope_per_decade.toFixed(3)} °C/decade, ` +
    `p ${trend.p_value.toFixed(3)}, n ${trend.n}, ranked ${rank}/${ranked.length} by steepness`
);
