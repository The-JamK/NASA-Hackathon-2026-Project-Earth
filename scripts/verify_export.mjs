// A verdict is only worth as much as the numbers behind it, so the export has to
// hand over enough to check it without trusting the chart. This proves the series
// file refits to the stored slope, and that the statistics file copies the bundle
// instead of rounding it.
import { readFileSync } from "node:fs";
import { caseSlug, reportRows, seriesRows, toCsv } from "../src/export.js";
import { loadPoints } from "./bundle.mjs";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const J = (name) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), "utf8"));

// Deliberately a plain RFC 4180 reader: if this cannot parse the file, neither can
// Excel, R or pandas.
function parseCsv(text) {
  if (!text.startsWith("\uFEFF")) fail("CSV has no UTF-8 BOM");
  if (!text.includes("\r\n")) fail("CSV is not CRLF-terminated");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r" && text[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function olsSlope(years, values) {
  const pairs = years
    .map((year, index) => [year, values[index]])
    .filter(([, value]) => Number.isFinite(value));
  if (pairs.length < 3) return null;
  const meanX = pairs.reduce((sum, [year]) => sum + year, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, value]) => sum + value, 0) / pairs.length;
  let numerator = 0;
  let denominator = 0;
  for (const [year, value] of pairs) {
    numerator += (year - meanX) * (value - meanY);
    denominator += (year - meanX) ** 2;
  }
  return denominator ? numerator / denominator : null;
}

const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));

// The annual means in the bundle are rounded when they are written (3 decimals for
// temperature, 4 for sea ice), while the slope was fitted before that rounding, so
// a refit of the stored series cannot match to the last bit. It should agree to four
// significant figures, which is far tighter than any reader needs to trust it.
const SLOPE_TOLERANCE = 1e-4;
let worstSlopeError = 0;

function checkCase(label, payload) {
  const { trend, years, values } = payload;
  if (!trend) fail(`${label}: no trend to export`);

  const rows = parseCsv(toCsv(seriesRows(years, values, trend)));
  const header = rows[0].join(",");
  if (header !== "year,value,fit,residual") fail(`${label}: series header is "${header}"`);
  if (rows.length !== years.length + 1) {
    fail(`${label}: ${rows.length - 1} data rows for ${years.length} years`);
  }

  const parsedYears = rows.slice(1).map((row) => Number(row[0]));
  const parsedValues = rows.slice(1).map((row) => (row[1] === "" ? null : Number(row[1])));
  parsedYears.forEach((year, index) => {
    if (year !== Number(years[index])) fail(`${label}: row ${index} is year ${year}`);
    const expected = Number.isFinite(values[index]) ? values[index] : null;
    if (expected === null) {
      if (parsedValues[index] !== null) fail(`${label}: year ${year} invented a value`);
    } else if (parsedValues[index] !== expected) {
      fail(`${label}: year ${year} exported ${parsedValues[index]}, bundle has ${expected}`);
    }
  });

  // The point of the series file: refitting it must reproduce the stored slope.
  const refit = olsSlope(parsedYears, parsedValues);
  if (refit === null) fail(`${label}: too few values to refit`);
  const expectedSlope = trend.slope_per_decade / 10;
  const refitError = Math.abs(refit * 10 - trend.slope_per_decade) / Math.abs(trend.slope_per_decade || 1);
  worstSlopeError = Math.max(worstSlopeError, refitError);
  if (refitError > SLOPE_TOLERANCE) {
    fail(
      `${label}: the exported series refits to ${(refit * 10).toFixed(9)} per decade, ` +
        `but the bundle says ${trend.slope_per_decade}`
    );
  }

  const hasFit = Number.isFinite(trend.intercept) && Number.isFinite(expectedSlope);
  rows.slice(1).forEach((row, index) => {
    if (!Number.isFinite(parsedValues[index])) return;
    if (!hasFit) {
      if (row[2] !== "" || row[3] !== "") fail(`${label}: claimed a fit without an intercept`);
      return;
    }
    const fit = trend.intercept + expectedSlope * parsedYears[index];
    if (!close(Number(row[2]), fit, 1e-9)) fail(`${label}: fit at ${parsedYears[index]} is ${row[2]}, not ${fit}`);
    const residual = parsedValues[index] - fit;
    if (!close(Number(row[3]), residual, 1e-9)) {
      fail(`${label}: residual at ${parsedYears[index]} is ${row[3]}, not ${residual}`);
    }
  });

  const report = parseCsv(toCsv(reportRows(payload)));
  if (report[0].join(",") !== "field,value") fail(`${label}: report header is "${report[0].join(",")}"`);
  const fields = new Map(report.slice(1).map((row) => [row[0], row[1]]));
  for (const key of [
    "case",
    "variable",
    "units",
    "source",
    "window",
    "annual_means_used",
    "slope_per_decade",
    "p_value",
    "method",
    "verdict_rule",
    "claim",
    "exported_at",
  ]) {
    const value = fields.get(key);
    if (value === undefined) fail(`${label}: report has no ${key}`);
    if (value === "" && key !== "case") fail(`${label}: report field ${key} is empty`);
  }

  if (fields.get("slope_per_decade") !== String(trend.slope_per_decade)) {
    fail(`${label}: report slope ${fields.get("slope_per_decade")} is not the bundle's ${trend.slope_per_decade}`);
  }
  if (Number.isFinite(trend.p_value) && fields.get("p_value") !== String(trend.p_value)) {
    fail(`${label}: report p ${fields.get("p_value")} is not the bundle's ${trend.p_value}`);
  }
  if (Number.isFinite(trend.q_value)) {
    if (fields.get("q_value") !== String(trend.q_value)) {
      fail(`${label}: report q ${fields.get("q_value")} is not the bundle's ${trend.q_value}`);
    }
  } else {
    if (fields.get("q_value") !== "") fail(`${label}: report claims a q the bundle does not have`);
    if (!/not in a multiple-comparison family/.test(fields.get("family") || "")) {
      fail(`${label}: report does not say the q is absent`);
    }
  }
  if (!/no causal attribution/.test(fields.get("claim") || "")) fail(`${label}: report claims causality`);
  return { fields, rows: rows.length - 1 };
}

// Stations now live in an index plus detail shards; the export check needs the
// full records, so it reads the merged view.
const points = loadPoints(new URL("../", import.meta.url));
const countries = J("countries.json");
const ocean = J("ocean.json");
const seaice = J("seaice.json");
const variables = J("variables.json").variables;
const grid = J("grid.json");
const windowKey = "1990-2025";
const span = (values, years) => {
  const [start, end] = windowKey.split("-").map(Number);
  const keep = years.map((year, index) => [year, values[index]]).filter(([year]) => year >= start && year <= end);
  return { years: keep.map(([year]) => year), values: keep.map(([, value]) => value) };
};

const byCode = new Map(variables.map((variable) => [variable.code, variable]));
const T2M = byCode.get("T2M");

const station = points.points.find((point) => point.trends?.T2M?.[windowKey]);
const stationWindow = span(station.series.T2M, points.meta.years);
checkCase("station", {
  title: station.name,
  detail: `${station.country} · station ${station.id}`,
  variable: T2M,
  trend: station.trends.T2M[windowKey],
  windowKey,
  ...stationWindow,
});

const country = countries.countries.find((item) => item.trends?.T2M?.[windowKey]);
const countryWindow = span(country.series.T2M, points.meta.years);
checkCase("country", {
  title: country.name,
  detail: `Country average · ${country.stations} stations`,
  variable: T2M,
  trend: country.trends.T2M[windowKey],
  windowKey,
  ...countryWindow,
});

const region = ocean.regions[0];
const regionWindow = span(region.series.GISTEMP, ocean.meta.years);
checkCase("ocean", {
  title: region.name,
  detail: `Ocean region · ${region.cells} GISTEMP cells`,
  variable: byCode.get("GISTEMP"),
  trend: region.trends.GISTEMP[windowKey],
  windowKey,
  ...regionWindow,
});

for (const [code, label] of [
  ["SEAICE", "sea-ice extent"],
  ["SEAICECONC", "sea-ice concentration"],
]) {
  const record = seaice.records[0];
  const variable =
    code === "SEAICE"
      ? { code, label: "Sea ice extent", short: "Sea ice", units: "million km²", source: "NSIDC / NOAA Sea Ice Index" }
      : {
          code,
          label: "Sea ice concentration",
          short: "Concentration",
          units: "%",
          slope_units: "percentage points",
          source: "NSIDC / NOAA Sea Ice Index",
        };
  const iceWindow = span(record.series[code], seaice.meta.years);
  checkCase(label, {
    title: record.name,
    detail: `${variable.label} · annual mean of 12 monthly values`,
    variable,
    trend: record.trends[code][windowKey],
    windowKey,
    ...iceWindow,
  });
}

const cell = grid.cells.find((item) => item.trends?.[windowKey]);
const cellTrend = cell.trends[windowKey];
const cellWindow = span(cell.values, grid.meta.years);
const gridCase = checkCase("grid cell", {
  title: "Grid cell 87.00°N 1.00°E",
  detail: "GISTEMP v4 · ocean · baseline 1951–1980",
  variable: byCode.get("GISTEMP"),
  trend: {
    ...cellTrend,
    slope_per_decade: cellTrend.slope,
    p_value: cellTrend.p,
    q_value: cellTrend.q,
    ci_low_per_decade: cellTrend.ci_low,
    ci_high_per_decade: cellTrend.ci_high,
    sen_slope_per_decade: cellTrend.sen,
    exploratory: false,
  },
  windowKey,
  ...cellWindow,
});
if (gridCase.fields.get("q_value") !== String(cellTrend.q)) fail("grid cell: BH q was dropped");
if (gridCase.fields.get("intercept") !== "") fail("grid cell: invented an intercept the bundle lacks");

checkCase("global", {
  title: "Global mean",
  detail: "GISTEMP v4 · 4° grid · baseline 1951–1980",
  variable: byCode.get("GISTEMP"),
  trend: grid.meta.global.trends[windowKey],
  windowKey,
  ...span(grid.meta.global.series, grid.meta.years),
});

// Escaping: a title with a comma and a quote must survive the round trip, because
// "Washington, D.C., the "dry" side" is a real kind of case name.
const escaped = parseCsv(
  toCsv([["field", "value"], ["case", 'Washington, D.C., the "dry" side']])
);
if (escaped[1][1] !== 'Washington, D.C., the "dry" side') {
  fail(`CSV escaping broke: got ${JSON.stringify(escaped[1][1])}`);
}
const slug = caseSlug({ title: "Arctic sea ice", variable: T2M, windowKey });
if (!/^[a-z0-9-]+$/.test(slug)) fail(`slug is not filename safe: ${slug}`);

// The panel has to be wired to it as well: the logic above is worthless if no case
// offers the buttons or the renderers never hand over their numbers.
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
for (const marker of [
  'data-action="export-series"',
  'data-action="export-report"',
  "mountExport",
  "downloadCsv(",
]) {
  if (!main.includes(marker)) fail(`main.js is missing ${marker}`);
}
// City, country, ocean, sea ice, grid cell, global field and the derived case.
const RENDERERS = 7;
const wired = (main.match(/setExport\(\{/g) || []).length;
if (wired !== RENDERERS) {
  fail(`only ${wired} of the ${RENDERERS} case renderers hand their numbers to the export`);
}

console.log(
  `export verified: station, country, ocean, both sea-ice measures, grid cell, global and the derived field case refit to their ` +
    `stored slopes (worst ${worstSlopeError.toExponential(1)} relative) · statistics copied unrounded · ` +
    `${slug} naming · CSV escaping and BOM`
);
