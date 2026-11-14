// Checks the map panel's location maths without a browser: coordinate parsing,
// place resolution against the cached bundle, and the nearest-record search.
// The map itself is only a renderer over these functions.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  compass,
  formatLatLon,
  haversineKm,
  nearestCell,
  nearestRecord,
  parseCoordinates,
  resolveLocation,
} from "../src/geo.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
}

const bundle = JSON.parse(readFileSync(resolve(ROOT, "public/data/points.json"), "utf8"));
const points = bundle.points;
const grid = JSON.parse(readFileSync(resolve(ROOT, "public/data/grid.json"), "utf8"));

const nairobi = points.find((point) => point.id === "nairobi");
const tokyo = points.find((point) => point.id === "tokyo");

/* ------------------------------------------------------------ coordinates */

const decimal = parseCoordinates("-1.2921, 36.8219");
check("decimal pair parses", decimal && Math.abs(decimal.lat + 1.2921) < 1e-6 && Math.abs(decimal.lon - 36.8219) < 1e-6, JSON.stringify(decimal));

const hemisphere = parseCoordinates("36.8219E 1.2921S");
check("hemisphere pair parses", hemisphere && Math.abs(hemisphere.lat + 1.2921) < 0.001 && Math.abs(hemisphere.lon - 36.8219) < 0.001, JSON.stringify(hemisphere));

const dms = parseCoordinates("1°17′S 36°49′E");
check("degree/minute pair parses", dms && Math.abs(dms.lat + 1.2833) < 0.02 && Math.abs(dms.lon - 36.8167) < 0.02, JSON.stringify(dms));

const ordered = parseCoordinates("36.82, -1.29");
check("plain pair is read as latitude, longitude", ordered && Math.abs(ordered.lat - 36.82) < 1e-6 && Math.abs(ordered.lon + 1.29) < 1e-6, JSON.stringify(ordered));

const swapped = parseCoordinates("120, 30");
check("impossible latitude falls back to longitude-first", swapped && Math.abs(swapped.lat - 30) < 1e-6 && Math.abs(swapped.lon - 120) < 1e-6, JSON.stringify(swapped));

check("place name is not a coordinate", parseCoordinates("Nairobi") === null);
check("out-of-range pair is rejected", parseCoordinates("20, 200") === null);
check("out-of-range longitudes are rejected", parseCoordinates("200, 30") === null);
check("single number is rejected", parseCoordinates("36.82") === null);
check("empty input is rejected", parseCoordinates("   ") === null);

/* ------------------------------------------------------------- resolution */

function locate(text, options = {}) {
  return resolveLocation(text, { points, ...options });
}

const byName = locate("Nairobi");
check("station name resolves", byName.ok && byName.nearest.point.id === "nairobi" && byName.nearest.km < 1, JSON.stringify(byName.target));

const byNameAndCountry = locate("Nairobi, Kenya");
check("station with country resolves", byNameAndCountry.ok && byNameAndCountry.nearest.point.id === "nairobi");

const byCountry = locate("Kenya");
check("country resolves to its nearest station", byCountry.ok && byCountry.nearest.point.id === "nairobi" && byCountry.nearest.km < 400, JSON.stringify(byCountry.nearest?.point?.name));

const byDiacritic = locate("Tromso");
check("diacritic-free name resolves", byDiacritic.ok && byDiacritic.nearest.point.id === "tromso");

const byAlias = locate("Sahel");
check("point alias resolves", byAlias.ok && byAlias.nearest.point.id === "niamey", JSON.stringify(byAlias.nearest?.point?.id));

const byGazetteer = locate("Kigali");
check("gazetteer place resolves", byGazetteer.ok && byGazetteer.nearest.point && byGazetteer.nearest.km > 300, JSON.stringify(byGazetteer.nearest?.point?.name));
check("gazetteer nearest is the geodesic minimum", byGazetteer.ok && byGazetteer.nearest.km === nearestRecord(byGazetteer.target.lat, byGazetteer.target.lon, points).km);

const byCoordinate = locate("36.8219E, 1.2921S");
check("coordinates resolve to the nearest station", byCoordinate.ok && byCoordinate.nearest.point.id === "nairobi" && byCoordinate.nearest.km < 2, `${byCoordinate.nearest?.point?.name} ${byCoordinate.nearest?.km}`);

const ocean = locate("0, 0");
check("ocean coordinates still find a record", ocean.ok && ocean.nearest.point && ocean.nearest.km < 2000, `${ocean.nearest?.point?.name} ${ocean.nearest?.km}`);

const byCountryCentroid = locate("Zembla", {
  countryCentroid: (name) => (name === "zembla" ? { lat: 62, lon: -110, label: "Zembla" } : null),
});
check("country centroid hook is used", byCountryCentroid.ok && byCountryCentroid.target.kind === "country" && byCountryCentroid.nearest.point);

const missing = locate("Atlantis");
check("unknown place is reported", missing.ok === false && typeof missing.reason === "string");

const empty = locate("");
check("empty lookup is reported", empty.ok === false);

/* ------------------------------------------------------------ distances */

const recorded = nearestRecord(0, 0, [nairobi, tokyo]);
check("nearest record picks the closer point", recorded.point.id === "nairobi");
check(
  "nearest record distance is the haversine minimum",
  Math.abs(recorded.km - haversineKm(0, 0, nairobi.lat, nairobi.lon)) < 1e-9
);

const cell = nearestCell(10, 10, grid.cells.map((entry) => ({ ...entry })));
check("nearest grid cell is found", cell && cell.km >= 0 && Number.isFinite(cell.km));

const east = haversineKm(0, 0, 0, 10);
check("equatorial 10° is ~1113 km", Math.abs(east - 1113.19) < 2, String(east));
check("bearing east is E", compass(90) === "E");
check("bearing south is S", compass(180) === "S");
check("bearing wraps", compass(359) === "N");
check("coordinates format", formatLatLon(-1.2921, 36.8219) === "1.29°S 36.82°E", formatLatLon(-1.2921, 36.8219));

if (failures) {
  console.error(`\n${failures} location check(s) failed`);
  process.exit(1);
}

console.log(`locate: ${points.length} stations, ${grid.cells.length} grid cells, offline gazetteer`);
console.log("locate: decimal, DMS, hemisphere, name, alias, country and gazetteer lookups resolve");
console.log("locate verified");
