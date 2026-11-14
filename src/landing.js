import "./style.css";
import { renderSeriesChart } from "./chart.js";

const BASE_URL = import.meta.env.BASE_URL || "/";
const POINT_ID = "nairobi";
const CODE = "T2M";
const WINDOW = "1990-2025";

function assetUrl(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) {
    return path;
  }
  return `${BASE_URL}${path.replace(/^\/+/, "")}`;
}

async function loadJson(path) {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

render();

async function render() {
  const root = document.getElementById("sample-case");
  if (!root) return;
  try {
    const [points, variables] = await Promise.all([
      loadJson("/data/points.json"),
      loadJson("/data/variables.json"),
    ]);

    const point = points.points.find((item) => item.id === POINT_ID);
    const variable = variables.variables.find((item) => item.code === CODE);
    const trend = point?.trends?.[CODE]?.[WINDOW];
    if (!point || !variable || !trend) {
      throw new Error(`the ${POINT_ID} ${CODE} ${WINDOW} case is missing from the bundle`);
    }

    paint(root, point, variable, trend, points.meta);
  } catch (error) {
    console.error(error);
    root.innerHTML = `<p class="warn-note">The sample case did not load from the data bundle. <a class="text-link" href="./app.html">Open the app</a> to run a case live.</p>`;
  }
}

function paint(root, point, variable, trend, meta) {
  const info = verdictInfo(trend);
  const series = point.series?.[CODE] || [];
  const window = seriesWindow(series, meta.years, WINDOW);
  const imagery = point.imagery_meta || {};
  const lat = `${Math.abs(point.lat).toFixed(2)}°${point.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(point.lon).toFixed(2)}°${point.lon >= 0 ? "E" : "W"}`;
  const ci = `95% CI ${signed(trend.ci_low_per_decade, 2)} to ${signed(trend.ci_high_per_decade, 2)}`;

  root.innerHTML = `
    <div class="case-head">
      <div class="case-id">${caseId(`${point.id}:${CODE}:${WINDOW}`)}</div>
      <span class="case-window">${WINDOW.replace("-", "–")} · ${escapeHtml(variable.short)}</span>
    </div>
    <h3 class="place-title">${escapeHtml(point.name)}</h3>
    <p class="place-sub">${escapeHtml(point.country)} · ${escapeHtml(point.continent)} · ${lat} &nbsp;${lon}</p>
    ${
      point.imagery
        ? `<div class="imagery">
      <img src="${escapeHtml(assetUrl(point.imagery))}" alt="${escapeHtml(
        imagery.source || "Satellite"
      )} imagery around ${escapeHtml(point.name)}" width="640" height="360" loading="lazy" />
      <span>${escapeHtml(imagery.label || "Imagery")}</span>
    </div>`
        : ""
    }
    <div class="verdict ${info.tone}">
      <div class="verdict-stamp">${info.stamp}</div>
      <div class="verdict-rate">${signed(trend.slope_per_decade, 2)}<span class="unit">${escapeHtml(
        variable.units
      )} / decade</span></div>
      <div class="verdict-sub"><span class="verdict-word">${info.word}</span> · ${ci} · n = ${
        trend.n
      }</div>
    </div>
    <div class="chart" id="sample-chart"></div>
    <dl class="facts">${factsRows(trend, variable)}</dl>
    <div class="case-sources">
      <b>Variable:</b> ${escapeHtml(variable.source)}<br />
      <b>Imagery:</b> ${escapeHtml(imagery.label || "—")} — ${escapeHtml(
        imagery.attribution || "—"
      )}
    </div>
    <details class="work">
      <summary>Show your work</summary>
      <p>Annual means only. OLS with Newey–West HAC standard errors; verdict at p &lt; 0.05; 95% interval with Student-t on n − 2 df; Sen's slope as a robust check; Mann–Kendall descriptive only. The AI proposed the variable and wrote the narrative; it did not compute a number.</p>
    </details>
  `;

  renderSeriesChart(document.getElementById("sample-chart"), {
    years: window.years,
    values: window.values,
    trend,
    variable,
    xLabel: WINDOW.replace("-", "–"),
    yLabel: variable.units,
  });
}

/* Mirrors the app's case-file formatting so the sample reads identically. */

function verdictInfo(trend) {
  const n = trend.n || 0;
  const p = trend.p_value ?? 1;
  const significant = Boolean(trend.verdict?.startsWith("significant"));
  if (trend.exploratory || n < 20) {
    return { tone: "explore", stamp: "COLD CASE", word: "Exploratory" };
  }
  if (!significant) return { tone: "none", stamp: "NOT PROVEN", word: "Not proven" };
  const increasing = trend.slope_per_decade > 0;
  return {
    tone: increasing ? "warm" : "cool",
    stamp: p < 0.001 ? "OPEN AND SHUT" : "SIGNIFICANT",
    word: increasing ? "Significant warming" : "Significant cooling",
  };
}

function factsRows(trend, variable) {
  const rows = [
    ["Sample size", `${trend.n} annual means`],
    ["HAC lag", trend.maxlag ?? "—"],
    ["HAC p-value", formatP(trend.p_value)],
  ];
  if (Number.isFinite(trend.ci_low_per_decade) && Number.isFinite(trend.ci_high_per_decade)) {
    rows.push([
      "95% interval",
      `${signed(trend.ci_low_per_decade, 2)} to ${signed(trend.ci_high_per_decade, 2)}`,
    ]);
  }
  if (Number.isFinite(trend.sen_slope_per_decade)) {
    rows.push(["Sen's slope", signed(trend.sen_slope_per_decade, 2)]);
  }
  if (Number.isFinite(trend.mk_tau)) rows.push(["Mann–Kendall", `${signed(trend.mk_tau, 2)} τ`]);
  if (Number.isFinite(trend.r_squared)) rows.push(["R²", trend.r_squared.toFixed(2)]);
  rows.push(["Units", variable.units]);
  rows.push(["Baseline", variable.baseline]);
  return rows
    .map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(String(value))}</dd>`)
    .join("");
}

function seriesWindow(values, years, windowKey) {
  const [start, end] = windowKey.split("-").map(Number);
  const outYears = [];
  const outValues = [];
  years.forEach((year, index) => {
    if (year >= start && year <= end) {
      outYears.push(year);
      outValues.push(values[index] ?? null);
    }
  });
  return { years: outYears, values: outValues };
}

function signed(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : "−"}${Math.abs(number).toFixed(digits)}`;
}

function formatP(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (number < 0.001) return "< 0.001";
  return number.toFixed(3);
}

function caseId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `CASE-${hash.toString(16).toUpperCase().padStart(4, "0").slice(-4)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}
