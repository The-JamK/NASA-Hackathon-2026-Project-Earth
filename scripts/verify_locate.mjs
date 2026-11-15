// Checks the tap recommendation's maths without a browser: given a tapped
// coordinate, which station and which GISTEMP cell are closest, and how far away
// they are. The globe only renders what these functions return.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  compass,
  formatLatLon,
  haversineKm,
  nearestCell,
  nearestRecord,
} from "../src/geo.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${label}${detail ? `, ${detail}` : ""}`);
}

const bundle = JSON.parse(readFileSync(resolve(ROOT, "public/data/points.json"), "utf8"));
const points = bundle.points;
const grid = JSON.parse(readFileSync(resolve(ROOT, "public/data/grid.json"), "utf8"));
// The app labels each cell when it builds the layer; mirror that here.
const cells = grid.cells.map((cell) => ({
  ...cell,
  name: `${Math.abs(cell.lat).toFixed(1)}°${cell.lat >= 0 ? "N" : "S"} ${Math.abs(cell.lon).toFixed(1)}°${
    cell.lon >= 0 ? "E" : "W"
  }`,
}));

const nairobi = points.find((point) => point.id === "nairobi");
const tokyo = points.find((point) => point.id === "tokyo");

/* ------------------------------------------------------------- distances */

const east = haversineKm(0, 0, 0, 10);
check("equatorial 10° is ~1113 km", Math.abs(east - 1113.19) < 2, String(east));
check("a point is zero away from itself", haversineKm(12, 34, 12, 34) === 0);
check("distance is symmetric", Math.abs(haversineKm(10, 20, -30, 40) - haversineKm(-30, 40, 10, 20)) < 1e-9);

check("bearing east is E", compass(90) === "E");
check("bearing south is S", compass(180) === "S");
check("bearing wraps", compass(359) === "N");
check("bearing north-west is NW", compass(315) === "NW");
check("coordinates format", formatLatLon(-1.2921, 36.8219) === "1.29°S 36.82°E", formatLatLon(-1.2921, 36.8219));

/* ------------------------------------------------------- nearest station */

const atNairobi = nearestRecord(nairobi.lat, nairobi.lon, points);
check("nearest station at a station is that station", atNairobi.point.id === "nairobi");
check("its distance is zero", atNairobi.km < 1e-9, String(atNairobi.km));

const between = nearestRecord(0, 0, [nairobi, tokyo]);
check("nearest station picks the closer of two", between.point.id === "nairobi");
check(
  "nearest station distance is the haversine minimum",
  Math.abs(between.km - haversineKm(0, 0, nairobi.lat, nairobi.lon)) < 1e-9
);

function bruteForceNearest(lat, lon, items, read) {
  return items
    .map((item) => ({ item, km: haversineKm(lat, lon, read(item).lat, read(item).lon) }))
    .sort((a, b) => a.km - b.km)[0];
}

for (const [lat, lon, label] of [
  [25, 10, "Sahara"],
  [51.5, -0.12, "London"],
  [-33.9, 151.2, "Sydney"],
  [0, -160, "mid-Pacific"],
]) {
  const nearest = nearestRecord(lat, lon, points);
  const expected = bruteForceNearest(lat, lon, points, (point) => point);
  check(
    `${label} tap: nearest station is the true minimum`,
    nearest.point.id === expected.item.id && Math.abs(nearest.km - expected.km) < 1e-9,
    `${nearest.point.id} vs ${expected.item.id}`
  );
  check(`${label} tap: distance is finite and non-negative`, Number.isFinite(nearest.km) && nearest.km >= 0);
  check(`${label} tap: bearing maps to a compass direction`, compass(nearest.bearing).length >= 1);
}

/* ---------------------------------------------------------- nearest cell */

const cellAtNairobi = nearestCell(nairobi.lat, nairobi.lon, cells);
check("nearest cell at Nairobi is within a cell diagonal", cellAtNairobi.km < 350, String(cellAtNairobi.km));

for (const [lat, lon, label] of [
  [25, 10, "Sahara"],
  [-1.94, 30.06, "Kigali"],
  [64.15, -21.94, "Reykjavik"],
]) {
  const nearest = nearestCell(lat, lon, cells);
  const expected = bruteForceNearest(lat, lon, cells, (cell) => cell);
  check(
    `${label} tap: nearest GISTEMP cell is the true minimum`,
    nearest.cell === expected.item && Math.abs(nearest.km - expected.km) < 1e-9
  );
  check(`${label} tap: cell has a readable name`, typeof nearest.cell.name === "string" && nearest.cell.name.includes("°"));
}

check("empty bundle has no nearest station", nearestRecord(0, 0, []) === null);
check("empty grid has no nearest cell", nearestCell(0, 0, []) === null);

if (failures) {
  console.error(`\n${failures} location check(s) failed`);
  process.exit(1);
}

console.log(`locate: ${points.length} stations, ${grid.cells.length} grid cells`);
console.log("locate: tapped coordinates resolve to the closest station and the closest GISTEMP cell");
console.log("locate verified");
