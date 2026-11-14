// Sea ice is a hemisphere-scale record carrying two measures: extent (how far
// the ice reaches) and concentration (100 × area ÷ extent, how much of that area
// is ice). This check recomputes both from the cached source series, proves the
// global sum is the sum of the two hemispheres, and requires the planner to
// reach the record instead of a station — the bug this feature replaced.
import { existsSync, readFileSync } from "node:fs";
import { planCase } from "../src/rag.js";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const J = (name) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), "utf8"));
const bundle = J("seaice.json");
const { points } = J("points.json");
const { variables } = J("variables.json");
const rag = J("rag_index.json");
const { countries } = J("countries.json");
const ocean = J("ocean.json");
const years = bundle.meta.years;
const CODES = ["SEAICE", "SEAICECONC"];

if (years.length !== 36 || years[0] !== 1990 || years.at(-1) !== 2025) {
  fail(`the sea-ice window is ${years[0]}–${years.at(-1)} with ${years.length} years`);
}
if (!bundle.meta.variables?.SEAICE || !bundle.meta.variables?.SEAICECONC) {
  fail("the bundle does not describe both measures");
}

// 1. Recompute annual means from the cached source series.
function monthlyMeans(file) {
  const path = new URL(`../data/cache/seaice/${file}`, import.meta.url);
  // The cache is gitignored; the bundle itself is committed. Recomputing needs
  // the source series, so say how to get it instead of failing on ENOENT.
  if (!existsSync(path)) {
    fail(`${file} is not cached. Run: uv run python scripts/build_seaice.py`);
  }
  const byMonth = new Map();
  for (const line of readFileSync(path, "utf8").split("\n").slice(1)) {
    const cells = line.trim().split(",");
    if (cells.length < 2) continue;
    const date = cells[0];
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const value = Number(cells[1]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(value)) continue;
    if (value <= -9999) continue;
    byMonth.set(`${year}-${month}`, value);
  }
  return years.map((year) => {
    const present = [];
    for (let month = 1; month <= 12; month += 1) {
      const value = byMonth.get(`${year}-${month}`);
      if (typeof value === "number") present.push(value);
    }
    return present.length === 12 ? present.reduce((a, b) => a + b, 0) / 12 : null;
  });
}

const extents = {
  "arctic-sea-ice": monthlyMeans("n_iceextent.mon.csv"),
  "antarctic-sea-ice": monthlyMeans("s_iceextent.mon.csv"),
};
const areas = {
  "arctic-sea-ice": monthlyMeans("n_icearea.mon.csv"),
  "antarctic-sea-ice": monthlyMeans("s_icearea.mon.csv"),
};
const ratio = (area, extent) => (area && extent > 0 ? (100 * area) / extent : null);
const recomputed = {
  SEAICE: extents,
  SEAICECONC: {
    "arctic-sea-ice": extents["arctic-sea-ice"].map((value, i) => ratio(areas["arctic-sea-ice"][i], value)),
    "antarctic-sea-ice": extents["antarctic-sea-ice"].map((value, i) =>
      ratio(areas["antarctic-sea-ice"][i], value)
    ),
  },
};

// 2. Every stored value, both measures, the family contract.
for (const record of bundle.records) {
  for (const code of CODES) {
    const series = record.series?.[code];
    if (!Array.isArray(series) || series.length !== years.length) {
      fail(`${record.name} ${code} does not carry one value per year`);
    }
    if (record.months !== 12) fail(`${record.name} does not declare twelve months`);

    const expected = recomputed[code]?.[record.id];
    if (expected) {
      const tolerance = code === "SEAICECONC" ? 0.006 : 0.001;
      for (let index = 0; index < years.length; index += 1) {
        const got = series[index];
        if (expected[index] === null && got !== null) fail(`${record.name} ${code} ${years[index]}: expected null`);
        if (expected[index] !== null && Math.abs(got - expected[index]) > tolerance) {
          fail(`${record.name} ${code} ${years[index]}: stored ${got}, recomputed ${expected[index].toFixed(4)}`);
        }
      }
    }

    const trend = record.trends?.[code]?.["1990-2025"];
    if (!trend) fail(`${record.name} ${code} has no 1990–2025 trend`);
    if (typeof trend.q_value !== "number") fail(`${record.name} ${code} has no q value`);
    if (trend.q_value < trend.p_value - 1e-9) {
      fail(`${record.name} ${code}: q ${trend.q_value} is below p ${trend.p_value}`);
    }
    if (trend.q_value === 0 && trend.p_value > 0) fail(`${record.name} ${code}: q rounded to zero`);
    if (trend.significant !== trend.q_value < 0.05) {
      fail(`${record.name} ${code}: significance disagrees with q`);
    }
  }

  // Concentration is a ratio of the same record's other series, so it must sit
  // between 0 and 100 every year, for every record including the global sum.
  for (const value of record.series.SEAICECONC) {
    if (value !== null && !(value > 0 && value <= 100)) {
      fail(`${record.name}: concentration ${value}% is outside 0–100`);
    }
  }
}

// 3. Global sea ice is exactly the two hemispheres summed: extent by addition,
// concentration from the summed areas (never the mean of two percentages).
const arctic = bundle.records.find((record) => record.id === "arctic-sea-ice");
const antarctic = bundle.records.find((record) => record.id === "antarctic-sea-ice");
const global = bundle.records.find((record) => record.id === "global-sea-ice");
if (!arctic || !antarctic || !global) fail("the three sea-ice records are not all present");
for (let index = 0; index < years.length; index += 1) {
  const expected = arctic.series.SEAICE[index] + antarctic.series.SEAICE[index];
  if (Math.abs(global.series.SEAICE[index] - expected) > 0.002) {
    fail(`global extent ${years[index]}: ${global.series.SEAICE[index]} is not ${expected.toFixed(3)}`);
  }
  const area = arctic.series.SEAICECONC[index] * arctic.series.SEAICE[index] +
    antarctic.series.SEAICECONC[index] * antarctic.series.SEAICE[index];
  const expectedConc = (100 * area) / (100 * expected);
  if (Math.abs(global.series.SEAICECONC[index] - expectedConc) > 0.02) {
    fail(`global concentration ${years[index]}: ${global.series.SEAICECONC[index]} is not ${expectedConc.toFixed(3)}`);
  }
}

// 4. The two measures must tell different stories, and the app must say so.
const arcticExtent = arctic.trends.SEAICE["1990-2025"];
const antarcticExtent = antarctic.trends.SEAICE["1990-2025"];
const arcticConc = arctic.trends.SEAICECONC["1990-2025"];
if (!(arcticExtent.slope_per_decade < 0) || !arcticExtent.significant) {
  fail(`the Arctic extent record is ${arcticExtent.verdict} at ${arcticExtent.slope_per_decade}`);
}
if (!(antarcticExtent.ci_low_per_decade < 0 && antarcticExtent.ci_high_per_decade > 0)) {
  fail("the Antarctic extent interval no longer crosses zero; the honest pair is gone");
}
if (antarcticExtent.significant) fail("the Antarctic extent record is now significant; the demo text needs updating");
if (!(arcticConc.slope_per_decade > 0)) {
  fail(`Arctic concentration is ${arcticConc.slope_per_decade}; the extent/concentration contrast is gone`);
}
if (arcticConc.verdict !== "no significant trend") {
  fail("the Arctic concentration verdict changed; the side-by-side copy needs updating");
}

// 5. The planner reaches each measure from the question, and never a station.
for (const record of bundle.records) {
  for (const alias of record.aliases) {
    const plan = planCase(`Is ${alias} shrinking?`, {
      rag,
      points,
      variables,
      countries,
      ocean: ocean.regions,
      seaIce: bundle.records,
    });
    if (!plan) fail(`"${alias}" produced no plan`);
    if (plan.kind !== "seaice") fail(`"${alias}" planned ${plan.kind} at ${plan.place.name}`);
    if (plan.variable.code !== "SEAICE") fail(`"${alias}" planned ${plan.variable.code}`);
    if (!/sea ice/i.test(plan.variable.label)) fail(`"${alias}" is not labelled sea ice extent`);
    if (plan.variable.units !== "10⁶ km²") fail(`"${alias}" carries units ${plan.variable.units}`);
  }
}

const arcticPlan = planCase("Is the Arctic sea ice shrinking?", {
  rag,
  points,
  variables,
  countries,
  ocean: ocean.regions,
  seaIce: bundle.records,
});
if (arcticPlan.place.id !== "arctic-sea-ice") fail(`"Arctic sea ice" planned ${arcticPlan.place.name}`);
if (!/concentration|extent/i.test(arcticPlan.note)) fail("the plan does not say what the measures are");

const concPlan = planCase("What is the Arctic sea ice concentration?", {
  rag,
  points,
  variables,
  countries,
  ocean: ocean.regions,
  seaIce: bundle.records,
});
if (concPlan.variable.code !== "SEAICECONC") {
  fail(`a concentration question planned ${concPlan.variable.code}`);
}
if (concPlan.variable.units !== "%") fail(`concentration carries units ${concPlan.variable.units}`);
if (concPlan.place.id !== "arctic-sea-ice") fail(`concentration question planned ${concPlan.place.name}`);

// 6. The UI carries both measures and never plots ice as a point.
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
for (const marker of [
  "selectSeaIce",
  "ensureSeaIce",
  "renderSeaIceCase",
  'data-action="open-seaice"',
  'data-action="select-ice-code"',
  "ice-measure",
  // Both measures share one indexed chart, drawn from the same window.
  "renderCompareChart",
  "concWindow",
]) {
  if (!main.includes(marker)) fail(`main.js is missing ${marker}`);
}
if ((main.split("/data/seaice.json").length - 1) !== 1) {
  fail("seaice.json should be fetched from exactly one place");
}
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
if (!html.includes("Sea Ice Index")) fail("app.html does not name the sea-ice source");

console.log(
  `sea ice verified: extent arctic ${arcticExtent.slope_per_decade.toFixed(3)} (proven), ` +
    `antarctic ${antarcticExtent.slope_per_decade.toFixed(3)} (CI ${antarcticExtent.ci_low_per_decade.toFixed(
      2
    )}..${antarcticExtent.ci_high_per_decade.toFixed(2)}, not proven) · ` +
    `concentration arctic ${arcticConc.slope_per_decade.toFixed(3)} pp/decade (not proven) · 3 records, 2 measures, 36 years`
);
