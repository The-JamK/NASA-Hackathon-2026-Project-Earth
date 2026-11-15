// Checks `public/data/gazetteer.json` as data: the shape the matcher reads, the
// regions that make "Is Illinois getting hotter?" answerable, and the size the
// page has to download when it resolves a name without a server.

import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FILE = resolve(ROOT, "public/data/gazetteer.json");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
}

const payload = JSON.parse(readFileSync(FILE, "utf8"));
const places = payload.places || [];
const regions = payload.regions || [];

check("the file has a meta block", Boolean(payload.meta));
check("it lists places", Array.isArray(places) && places.length > 5000, String(places.length));
check("it lists regions", Array.isArray(regions) && regions.length > 3000, String(regions.length));
check("meta.count matches the places", payload.meta?.count === places.length, `${payload.meta?.count} vs ${places.length}`);
check(
  "meta.region_count matches the regions",
  payload.meta?.region_count === regions.length,
  `${payload.meta?.region_count} vs ${regions.length}`
);

/* ------------------------------------------------------------------ shape */

let badPlace = null;
for (const row of places) {
  if (!Array.isArray(row) || row.length < 5) {
    badPlace = row;
    break;
  }
  const [, , lat, lon, population] = row;
  if (typeof row[0] !== "string" || !row[0]) {
    badPlace = row;
    break;
  }
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    badPlace = row;
    break;
  }
  if (!Number.isFinite(population)) {
    badPlace = row;
    break;
  }
}
check("every place row is [name, country, lat, lon, population]", !badPlace, JSON.stringify(badPlace));

let badRegion = null;
for (const row of regions) {
  if (!Array.isArray(row) || row.length < 5) {
    badRegion = row;
    break;
  }
  const [, , lat, lon] = row;
  if (typeof row[0] !== "string" || !row[0] || typeof row[1] !== "string" || !row[1]) {
    badRegion = row;
    break;
  }
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    badRegion = row;
    break;
  }
}
check("every region row is [name, country, lat, lon, type]", !badRegion, JSON.stringify(badRegion));

/* ---------------------------------------------------------------- content */

const find = (rows, name) => rows.find((row) => String(row[0]).toLowerCase() === name.toLowerCase());

const illinois = find(regions, "Illinois");
check("Illinois is a region", Boolean(illinois), "missing");
check("Illinois is in the United States", /united states/i.test(illinois?.[1] || ""), illinois?.[1]);
check("its type is a state", /state/i.test(illinois?.[4] || ""), illinois?.[4]);
check(
  "its label point is inside Illinois",
  illinois && illinois[2] > 36.9 && illinois[2] < 42.6 && illinois[3] > -91.6 && illinois[3] < -87.4,
  illinois && `${illinois[2]},${illinois[3]}`
);
check("Queensland is a region", Boolean(find(regions, "Queensland")));
check("Ontario is a region", Boolean(find(regions, "Ontario")));
check("Gold Coast is still a place", Boolean(find(places, "Gold Coast")));
check(
  "a suburb the gazetteer never carried is still absent",
  !find(places, "Broadbeach"),
  "Broadbeach must stay out so the geocoder path keeps its test case"
);

/* ------------------------------------------------------------------ dupes */

const dupe = (rows) => {
  const seen = new Set();
  for (const row of rows) {
    const key = `${String(row[0]).toLowerCase()}|${String(row[1]).toLowerCase()}`;
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
};
check("places are unique by name and country", dupe(places) === null, dupe(places));
check("regions are unique by name and country", dupe(regions) === null, dupe(regions));

/* ------------------------------------------------------------------- size */

const kb = statSync(FILE).size / 1024;
check("the file stays under 800 KB, because the page downloads it", kb < 800, `${kb.toFixed(1)} KB`);

if (failures) {
  console.error(`\ngazetteer: ${failures} check(s) failed`);
  process.exit(1);
}
console.log(
  `gazetteer verified: ${places.length} places · ${regions.length} states and provinces · ` +
    `Illinois ${illinois[2]},${illinois[3]} · ${kb.toFixed(0)} KB`
);
