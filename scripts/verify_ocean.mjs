// The ocean is presented as places, not as a cloud of dots. This check holds the
// data to that: the coastline mask is right at known anchors, every region mean
// is the area-weighted mean of the cells it claims, the basins share no cell, the
// family correction is applied across basins only, and every basin name plans an
// ocean case instead of falling through to a land station.
import { readFileSync } from "node:fs";
import { oceanRegionAt, planCase } from "../src/rag.js";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const J = (name) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), "utf8"));
const grid = J("grid.json");
const ocean = J("ocean.json");
const { points } = J("points.json");
const { variables } = J("variables.json");
const rag = J("rag_index.json");
const { countries } = J("countries.json");

const cells = grid.cells;
const years = grid.meta.years;
const byKey = new Map(cells.map((cell) => [`${cell.lat},${cell.lon}`, cell]));

// 1. The mask is right where we can name the answer. Cell centres are the odd
// offsets of a 4° subsample of a 2° grid (lat ≡ 3, lon ≡ 1 mod 4), so the
// anchors are grid points rather than round coordinates.
for (const [name, lat, lon, water] of [
  ["mid-Pacific", -17, -167, true],
  ["N Atlantic", 39, -39, true],
  ["Southern Ocean", -61, 1, true],
  ["Arctic", 87, 1, true],
  ["Sahara", 19, 9, false],
  ["Amazon", -5, -63, false],
  ["Antarctica", -81, 1, false],
  ["Siberia", 63, 101, false],
]) {
  const cell = byKey.get(`${lat},${lon}`);
  if (!cell) fail(`no grid cell at ${lat},${lon} (${name})`);
  if (typeof cell.is_ocean !== "boolean") fail(`${name} carries no is_ocean flag`);
  if (cell.is_ocean !== water) fail(`${name} is classified ${cell.is_ocean ? "ocean" : "land"}`);
}

const oceanCells = cells.filter((cell) => cell.is_ocean);
if (!oceanCells.length) fail("no ocean cells");
if (oceanCells.length + cells.filter((cell) => !cell.is_ocean).length !== cells.length) {
  fail("the mask does not classify every cell");
}

// 2. Every region mean is the cos(lat)-weighted mean of its own cells.
const weight = (lat) => Math.cos((lat * Math.PI) / 180);
function membersOf(region) {
  const [low, high] = region.lat_bounds;
  const [start, span] = region.lon_bounds;
  return oceanCells.filter(
    (cell) =>
      cell.lat >= low &&
      cell.lat <= high &&
      ((cell.lon - start) % 360 + 360) % 360 <= span
  );
}

const seen = new Map();
for (const region of ocean.regions) {
  const members = membersOf(region);
  if (members.length !== region.cells) {
    fail(`${region.name}: ${members.length} cells match its box, but it reports ${region.cells}`);
  }
  if (!region.series?.GISTEMP?.length) fail(`${region.name} has no series`);
  if (!region.trends?.GISTEMP?.["1990-2025"]) fail(`${region.name} has no 1990–2025 trend`);

  for (let index = 0; index < years.length; index += 1) {
    let total = 0;
    let weightSum = 0;
    for (const cell of members) {
      const value = cell.values?.[index];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const cellWeight = weight(cell.lat);
      total += value * cellWeight;
      weightSum += cellWeight;
    }
    const expected = weightSum ? total / weightSum : null;
    const got = region.series.GISTEMP[index];
    if (expected === null) {
      if (got !== null) fail(`${region.name} ${years[index]}: expected null, got ${got}`);
      continue;
    }
    if (typeof got !== "number" || Math.abs(got - expected) > 0.002) {
      fail(`${region.name} ${years[index]}: stored ${got}, recomputed ${expected.toFixed(4)}`);
    }
  }

  if (region.family === "basins") {
    for (const cell of members) {
      const key = `${cell.lat},${cell.lon}`;
      if (seen.has(key)) fail(`cell ${key} is in both ${seen.get(key)} and ${region.name}`);
      seen.set(key, region.name);
    }
  }
}

// 3. The family correction covers basins only; the aggregate says so.
for (const region of ocean.regions) {
  for (const key of ocean.meta.windows) {
    const trend = region.trends.GISTEMP[key];
    if (!trend) continue;
    if (region.family === "basins") {
      if (typeof trend.q_value !== "number") fail(`${region.name} ${key} has no q value`);
      if (trend.q_value < trend.p_value - 1e-9) {
        fail(`${region.name} ${key}: q ${trend.q_value} is below p ${trend.p_value}`);
      }
      if (trend.significant !== trend.q_value < 0.05) {
        fail(`${region.name} ${key}: significance and q disagree`);
      }
    } else if (trend.q_value !== null) {
      fail(`${region.name} ${key} borrows a basin q value`);
    }
  }
}

// 4. Every basin alias plans an ocean case, labelled sea surface temperature.
for (const region of ocean.regions) {
  if (!region.aliases.length) fail(`${region.name} has no aliases`);
  for (const alias of region.aliases) {
    const plan = planCase(`Is ${alias} warming?`, {
      rag,
      points,
      variables,
      countries,
      ocean: ocean.regions,
    });
    if (!plan) fail(`"${alias}" produced no plan`);
    if (plan.kind !== "ocean") fail(`"${alias}" planned ${plan.kind} at ${plan.place.name}`);
    if (plan.variable.code !== "GISTEMP") fail(`"${alias}" planned ${plan.variable.code}`);
    if (!/sea surface/i.test(plan.variable.label)) fail(`"${alias}" is not labelled sea surface temperature`);
  }
}

// 5. Specific questions land where they should, and ice never lands on a city.
const pacific = planCase("Is the Pacific warming?", { rag, points, variables, countries, ocean: ocean.regions });
if (pacific.kind !== "ocean" || pacific.place.id !== "tropical-pacific") {
  fail(`"the Pacific" planned ${pacific.kind} at ${pacific.place.name}`);
}
// A sea-ice question belongs to the sea-ice record (verify_seaice.mjs owns that
// contract); here it must at least not land on a city, which is what it did
// before either record existed.
const ice = planCase("Is the Arctic sea ice shrinking?", {
  rag,
  points,
  variables,
  countries,
  ocean: ocean.regions,
});
if (ice.kind === "city") fail(`a sea-ice question planned a station at ${ice.place.name}`);

// 6. A tap on water opens the basin that contains the cell. The tap path uses
// oceanRegionAt, which repeats the build's wrapped box test in JS; this proves the
// two agree, so a click and a rebuild cannot disagree about where a cell belongs.
for (const region of ocean.regions.filter((item) => item.family === "basins")) {
  for (const cell of membersOf(region).slice(0, 12)) {
    const hit = oceanRegionAt(cell.lat, cell.lon, ocean.regions);
    if (!hit) fail(`a ${region.name} cell at ${cell.lat},${cell.lon} maps to no basin`);
    if (hit.id !== region.id) fail(`a ${region.name} cell at ${cell.lat},${cell.lon} maps to ${hit.name}`);
  }
}
for (const [name, lat, lon, id] of [
  ["mid-Pacific", -17, -167, "tropical-pacific"],
  ["N Atlantic", 39, -39, "north-atlantic"],
  ["Southern Ocean", -61, 1, "southern-ocean"],
  ["Arctic", 87, 1, "arctic-ocean"],
]) {
  const hit = oceanRegionAt(lat, lon, ocean.regions);
  if (hit?.id !== id) fail(`a tap at ${name} maps to ${hit?.name ?? "no basin"}`);
}
if (oceanRegionAt(19, 9, ocean.regions)) fail("a tap on the Sahara maps to an ocean basin");

// Some water is in no named basin (the tropical Atlantic, for one). That is water,
// not land: the tap path sends it to the global ocean, so the check pins both the
// null result and that fallback.
const unassigned = oceanCells.filter((cell) => !oceanRegionAt(cell.lat, cell.lon, ocean.regions));
if (!unassigned.length) fail("every ocean cell now belongs to a basin; the fallback is dead code");
if (unassigned.length + seen.size !== oceanCells.length) {
  fail(`${unassigned.length} unassigned + ${seen.size} basin cells is not ${oceanCells.length} ocean cells`);
}
if (oceanRegionAt(-1, -31, ocean.regions)) fail("tropical Atlantic water resolves to a basin");

// 7. The UI wires the ocean as a place and a layer, never as points, and a tap in
// that layer goes to the basin rather than to a station or a single cell.
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
for (const marker of [
  "selectOcean",
  "ensureOcean",
  "renderOceanCase",
  'data-action="open-ocean"',
  "nearestOceanCell",
  "oceanRegionAt",
  "state.layer === \"ocean\"",
  'item.id === "global-ocean"',
]) {
  if (!main.includes(marker)) fail(`main.js is missing ${marker}`);
}
if (!main.includes("cell.is_ocean")) fail("the ocean layer does not filter the field by is_ocean");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
if (!html.includes('data-layer="ocean"')) fail("app.html has no ocean layer button");
if (!html.includes('id="ocean-legend"')) fail("app.html has no ocean legend");

console.log(
  `ocean verified: ${oceanCells.length.toLocaleString()} ocean cells · ${ocean.regions.length} regions · ` +
    `${seen.size.toLocaleString()} cells partitioned across basins · aliases, tap routing and ice routing checked`
);
