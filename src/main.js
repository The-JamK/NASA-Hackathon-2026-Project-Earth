import Globe from "globe.gl";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import "./style.css";
import { planCase } from "./rag.js";
import { renderSeriesChart, trendColor } from "./chart.js";

const FEATURED_CASES = [
  { id: "nairobi", code: "T2M", window: "1990-2025", label: "Nairobi warming" },
  { id: "london", code: "PRECTOTCORR", window: "1990-2025", label: "London rainfall" },
  { id: "delhi", code: "T2M", window: "2000-2025", label: "Delhi heat" },
  { id: "manaus", code: "PRECTOTCORR", window: "1990-2025", label: "Amazon drying" },
  { id: "niamey", code: "PRECTOTCORR", window: "1990-2025", label: "Sahel rainfall" },
  { id: "tromso", code: "T2M", window: "1990-2025", label: "Arctic warming" },
  { id: "mcmurdo", code: "T2M", window: "1990-2025", label: "McMurdo red herring" },
];

const state = {
  variables: [],
  points: [],
  meta: null,
  grid: null,
  gridPoints: [],
  rag: null,
  sources: [],
  byCode: new Map(),
  byId: new Map(),
  layer: "cities",
  variable: "T2M",
  windowKey: "1990-2025",
  selected: null,
  selectedKind: null,
  plan: null,
};

const BASE_URL = import.meta.env.BASE_URL || "/";

const SOURCE_LINKS = {
  earthdata: "https://www.earthdata.nasa.gov/",
  planetary: "https://planetarycomputer.microsoft.com/",
  power: "https://power.larc.nasa.gov/",
  meteomatics: "https://www.meteomatics.com/",
  gistemp: "https://data.giss.nasa.gov/gistemp/",
  "blue-marble": "https://visibleearth.nasa.gov/collection/1484/blue-marble",
};

function assetUrl(path) {
  if (!path || /^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) {
    return path;
  }
  return `${BASE_URL}${path.replace(/^\/+/, "")}`;
}

const els = {
  globe: document.getElementById("globe"),
  sourceStrip: document.getElementById("source-strip"),
  askPanel: document.getElementById("ask-panel"),
  askForm: document.getElementById("ask-form"),
  askInput: document.getElementById("ask-input"),
  suggestions: document.getElementById("suggestions"),
  plan: document.getElementById("plan"),
  casePanel: document.getElementById("case-panel"),
  featuredGrid: document.getElementById("featured-grid"),
  loading: document.getElementById("loading"),
  toast: document.getElementById("toast"),
  hint: document.getElementById("hint"),
  methodDialog: document.getElementById("method-dialog"),
  methodBtn: document.getElementById("method-btn"),
  globalBtn: document.getElementById("global-btn"),
  closeMethod: document.getElementById("close-method"),
  methodDone: document.getElementById("method-done"),
};

let globe;
let toastTimer;
let autoRotateTimer;

init();

async function init() {
  bindStaticEvents();
  try {
    const [variables, points, grid, rag, sources] = await Promise.all([
      loadJson(assetUrl("/data/variables.json")),
      loadJson(assetUrl("/data/points.json")),
      loadJson(assetUrl("/data/grid.json")),
      loadJson(assetUrl("/data/rag_index.json")),
      loadJson(assetUrl("/data/sources.json")),
    ]);

    state.variables = variables.variables;
    state.points = points.points;
    state.meta = points.meta;
    state.grid = grid;
    state.rag = rag;
    state.sources = sources.sources;
    state.windowKey = points.meta.windows[0];
    state.byCode = new Map(state.variables.map((variable) => [variable.code, variable]));
    state.byId = new Map(state.points.map((point) => [point.id, point]));
    state.gridPoints = grid.cells.map((cell) => ({
      ...cell,
      isGrid: true,
      id: `grid:${cell.lat}:${cell.lon}`,
      name: `${Math.abs(cell.lat).toFixed(1)}°${cell.lat >= 0 ? "N" : "S"} ${Math.abs(cell.lon).toFixed(
        1
      )}°${cell.lon >= 0 ? "E" : "W"}`,
    }));

    if (import.meta.env.DEV) {
      window.__caseFiles = { state, selectPoint, selectGlobal, refreshLayer, renderCase };
    }

    buildGlobe();
    renderSourceStrip();
    renderSuggestions();
    renderFeatured();
    renderEmptyCase();
    hideLoading();
  } catch (error) {
    showFatal(error);
  }
}

function loadJson(path) {
  return fetch(path).then((response) => {
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return response.json();
  });
}

/* ------------------------------------------------------------------ globe */

function buildGlobe() {
  const countries = feature(world, world.objects.countries).features;

  globe = new Globe(els.globe)
    .globeImageUrl(assetUrl("/textures/earth-blue-marble.jpg"))
    .bumpImageUrl(assetUrl("/textures/earth-topology.png"))
    .backgroundImageUrl(assetUrl("/textures/night-sky.png"))
    .atmosphereColor("#5fd3e0")
    .atmosphereAltitude(0.18)
    .showAtmosphere(true)
    .showGraticules(false)
    .polygonsData(countries)
    .polygonCapColor(() => "rgba(0,0,0,0)")
    .polygonSideColor(() => "rgba(0,0,0,0)")
    .polygonStrokeColor(() => "rgba(174, 216, 255, 0.2)")
    .polygonAltitude(0.001)
    .polygonsTransitionDuration(0)
    .pointLat("lat")
    .pointLng("lon")
    .pointAltitude(pointAltitude)
    .pointRadius(pointRadius)
    .pointColor(pointColor)
    .pointLabel(pointLabel)
    .pointResolution(5)
    .pointsTransitionDuration(0)
    .pointsMerge(false)
    .onPointClick((point) => selectPoint(point))
    .onGlobeClick(({ lat, lng }) => {
      const found = state.layer === "field" ? nearestGrid(lat, lng) : nearestCity(lat, lng);
      if (found) selectPoint(found);
      else showToast("No point nearby. Turn on Trend field for the gridded view.");
    })
    .ringColor(() => ["rgba(95, 211, 224, 0.65)", "rgba(95, 211, 224, 0)"])
    .ringMaxRadius(2.8)
    .ringPropagationSpeed(1.5)
    .ringRepeatPeriod(1200)
    .ringAltitude(0.004);

  globe.width(window.innerWidth).height(window.innerHeight);
  globe.pointOfView({ lat: 12, lng: 8, altitude: 3.0 }, 0);
  globe.controls().autoRotate = true;
  globe.controls().autoRotateSpeed = 0.3;
  globe.controls().enableDamping = true;
  globe.controls().dampingFactor = 0.08;
  globe.controls().minPolarAngle = 0.08;
  globe.controls().maxPolarAngle = Math.PI - 0.08;

  window.addEventListener("resize", () => {
    globe.width(window.innerWidth).height(window.innerHeight);
  });

  refreshLayer();
}

function pointAltitude(point) {
  if (isSelected(point)) return 0.045;
  return point.isGrid ? 0.004 : 0.014;
}

function pointRadius(point) {
  if (isSelected(point)) return point.isGrid ? 0.22 : 0.46;
  return point.isGrid ? 0.12 : 0.27;
}

function pointColor(point) {
  if (isSelected(point)) return "#ffffff";
  if (point.isGrid) {
    const trend = point.trends?.[state.windowKey];
    if (!trend) return "rgba(255, 255, 255, 0.04)";
    if (trend.significant && trend.slope > 0) return "rgba(255, 107, 74, 0.9)";
    if (trend.significant && trend.slope < 0) return "rgba(79, 147, 214, 0.92)";
    return "rgba(107, 122, 136, 0.42)";
  }
  const trend = point.trends?.[state.variable]?.[state.windowKey];
  return trendColor(trend);
}

function pointLabel(point) {
  if (point.isGrid) {
    const trend = point.trends?.[state.windowKey];
    const slope = trend ? `${signed(trend.slope, 2)} °C/decade` : "no fit";
    return `${point.name} · ${slope}`;
  }
  const trend = point.trends?.[state.variable]?.[state.windowKey];
  const word = trend ? verdictInfo(trend, state.byCode.get(state.variable)).word : "no data";
  return `${point.name} · ${word}`;
}

function isSelected(item) {
  if (!state.selected || !item) return false;
  if (state.selected.global) return false;
  return state.selected.id === item.id;
}

function refreshLayer() {
  if (!globe) return;
  const data = state.layer === "field" ? state.gridPoints : state.points;
  globe.pointsData(data);
  globe.ringsData(
    state.selected && !state.selected.global
      ? [{ lat: state.selected.lat, lng: state.selected.lon }]
      : []
  );
  document.querySelectorAll(".layer-switch button").forEach((button) => {
    button.classList.toggle("on", button.dataset.layer === state.layer);
  });
}

function nearestCity(lat, lng) {
  let best = null;
  let bestDistance = Infinity;
  for (const point of state.points) {
    const distance = haversine(lat, lng, point.lat, point.lon);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  if (bestDistance > 13) {
    showToast(`Nearest city is ${Math.round(bestDistance * 111)} km away — showing ${best.name}.`);
  }
  return best;
}

function nearestGrid(lat, lng) {
  let best = null;
  let bestDistance = Infinity;
  for (const cell of state.gridPoints) {
    const distance = haversine(lat, lng, cell.lat, cell.lon);
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}

function haversine(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / rad;
}

/* --------------------------------------------------------------- selection */

function selectPoint(point) {
  if (!point) return;
  state.selected = point;
  state.selectedKind = point.isGrid ? "grid" : "city";
  state.layer = point.isGrid ? "field" : "cities";
  if (point.isGrid) {
    state.variable = "GISTEMP";
    if (!point.trends?.[state.windowKey]) state.windowKey = state.meta.windows[0];
  } else {
    if (!point.trends?.[state.variable]?.[state.windowKey]) {
      state.variable = point.trends?.T2M ? "T2M" : Object.keys(point.trends || {})[0] || "T2M";
    }
  }
  document.body.classList.add("has-case");
  renderCase();
  refreshLayer();
  globe.pointOfView(
    { lat: point.lat, lng: point.lon, altitude: point.isGrid ? 1.45 : 1.75 },
    900
  );
  globe.controls().autoRotate = false;
  clearTimeout(autoRotateTimer);
  els.hint.textContent = point.isGrid
    ? "GISTEMP cell · click another cell"
    : `${point.name} · ${state.byCode.get(state.variable)?.short || "trend"}`;
}

function selectGlobal(windowKey = state.windowKey) {
  state.selected = { global: true, name: "Global", lat: 12, lon: 0 };
  state.selectedKind = "global";
  state.variable = "GISTEMP";
  state.windowKey = windowKey;
  state.layer = "field";
  document.body.classList.add("has-case");
  renderCase();
  refreshLayer();
  globe.pointOfView({ lat: 12, lng: 8, altitude: 3.0 }, 900);
  globe.controls().autoRotate = true;
  els.hint.textContent = "Global field · click a cell or a city";
}

function clearCase() {
  state.selected = null;
  state.selectedKind = null;
  document.body.classList.remove("has-case");
  renderEmptyCase();
  refreshLayer();
  globe.controls().autoRotate = true;
  els.hint.textContent = "Drag to rotate · scroll to zoom · click a point";
}

function openFeatured(id, code, windowKey) {
  const point = state.byId.get(id);
  if (!point) return;
  state.variable = code;
  state.windowKey = windowKey || state.meta.windows[0];
  selectPoint(point);
}

/* ------------------------------------------------------------------- cases */

function renderCase() {
  if (state.selectedKind === "global") return renderGlobalCase();
  if (state.selectedKind === "grid") return renderGridCase();
  if (state.selectedKind === "city") return renderCityCase();
  renderEmptyCase();
}

function renderCityCase() {
  const point = state.selected;
  const code = state.variable;
  const variable = state.byCode.get(code) || state.variables[0];
  const trend = point.trends?.[code]?.[state.windowKey] || null;
  const series = point.series?.[code] || [];
  const window = seriesWindow(series, state.meta.years, state.windowKey);
  const info = verdictInfo(trend, variable);
  const id = caseId(`${point.id}:${code}:${state.windowKey}`);
  const lat = `${Math.abs(point.lat).toFixed(2)}°${point.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(point.lon).toFixed(2)}°${point.lon >= 0 ? "E" : "W"}`;

  els.casePanel.innerHTML = `
    <div class="case-head">
      <div class="case-id">${id}</div>
      <button class="case-close" data-action="close-case" type="button">Close</button>
    </div>
    <h2 class="place-title">${escapeHtml(point.name)}</h2>
    <p class="place-sub">${escapeHtml(
      point.country === point.continent ? point.country : `${point.country} · ${point.continent}`
    )} · ${lat} &nbsp;${lon}</p>
    ${liveChip(point)}
    ${imagery(point)}
    ${variableChips(variable, false)}
    ${windowChips()}
    ${verdictBlock(trend, variable, info)}
    ${caveatBlock(trend, variable, false)}
    <div class="chart" id="case-chart"></div>
    <dl class="facts">${facts(trend, variable, false)}</dl>
    <p class="narrative">${cityNarrative(point, variable, trend, state.windowKey)}</p>
    ${caseSources(point, variable)}
    ${workBlock("point")}
  `;
  renderSeriesChart(document.getElementById("case-chart"), {
    years: window.years,
    values: window.values,
    trend,
    variable,
    xLabel: state.windowKey.replace("-", "–"),
    yLabel: variable.units,
  });
  els.casePanel.scrollTop = 0;
}

function renderGridCase() {
  const cell = state.selected;
  const raw = cell.trends?.[state.windowKey] || null;
  const trend = normalizeGridTrend(raw);
  const variable = state.byCode.get("GISTEMP");
  const window = seriesWindow(cell.values, state.grid.meta.years, state.windowKey);
  const info = verdictInfo(trend, variable);
  const id = caseId(`grid:${cell.lat}:${cell.lon}:${state.windowKey}`);
  const lat = `${Math.abs(cell.lat).toFixed(1)}°${cell.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(cell.lon).toFixed(1)}°${cell.lon >= 0 ? "E" : "W"}`;

  els.casePanel.innerHTML = `
    <div class="case-head">
      <div class="case-id">${id}</div>
      <button class="case-close" data-action="close-case" type="button">Close</button>
    </div>
    <h2 class="place-title">Grid cell</h2>
    <p class="place-sub">${lat} &nbsp;${lon} · GISTEMP v4 · baseline 1951–1980</p>
    ${variableChips(variable, true)}
    ${windowChips()}
    ${verdictBlock(trend, variable, info)}
    ${caveatBlock(trend, variable, true)}
    <div class="chart" id="case-chart"></div>
    <dl class="facts">${facts(trend, variable, true)}</dl>
    <p class="narrative">${gridNarrative(cell, trend, variable, state.windowKey)}</p>
    ${caseSources(null, variable)}
    ${workBlock("grid")}
  `;
  renderSeriesChart(document.getElementById("case-chart"), {
    years: window.years,
    values: window.values,
    trend,
    variable,
    xLabel: state.windowKey.replace("-", "–"),
    yLabel: "°C anomaly",
  });
  els.casePanel.scrollTop = 0;
}

function renderGlobalCase() {
  const meta = state.grid.meta;
  const raw = meta.global.trends?.[state.windowKey] || null;
  const trend = raw;
  const variable = state.byCode.get("GISTEMP");
  const window = seriesWindow(meta.global.series, meta.years, state.windowKey);
  const counts = meta.counts_by_window?.[state.windowKey] || meta.counts;
  const info = verdictInfo(trend, variable);
  const id = caseId(`global:${state.windowKey}`);

  els.casePanel.innerHTML = `
    <div class="case-head">
      <div class="case-id">${id}</div>
      <button class="case-close" data-action="close-case" type="button">Close</button>
    </div>
    <h2 class="place-title">The whole field</h2>
    <p class="place-sub">GISTEMP v4 · 4° grid · ${counts.cells.toLocaleString()} cells · baseline 1951–1980</p>
    ${variableChips(variable, true)}
    ${windowChips()}
    ${verdictBlock(trend, variable, info)}
    <div class="caveat">
      The global series is an anomaly relative to 1951–1980. The cell counts use
      Benjamini–Hochberg q = 0.05 across the grid; they are not a second opinion on the
      global slope.
    </div>
    <div class="chart" id="case-chart"></div>
    <dl class="facts">${facts(trend, variable, false, counts)}</dl>
    <p class="narrative">${globalNarrative(trend, variable, state.windowKey, counts)}</p>
    ${caseSources(null, variable)}
    ${workBlock("global")}
  `;
  renderSeriesChart(document.getElementById("case-chart"), {
    years: window.years,
    values: window.values,
    trend,
    variable,
    xLabel: state.windowKey.replace("-", "–"),
    yLabel: "°C anomaly",
  });
  els.casePanel.scrollTop = 0;
}

/* -------------------------------------------------------------- case parts */

function variableChips(active, locked) {
  const variables = state.variables.filter((variable) => variable.kind === "point");
  if (locked) {
    return `<div class="var-chips"><button class="var-chip on" type="button" disabled>${escapeHtml(
      active.short
    )}</button></div>`;
  }
  return `<div class="var-chips">${variables
    .map(
      (variable) =>
        `<button class="var-chip ${variable.code === active.code ? "on" : ""}" data-action="select-variable" data-code="${variable.code}" type="button">${escapeHtml(
          variable.short
        )}</button>`
    )
    .join("")}</div>`;
}

function windowChips() {
  return `<div class="window-row"><span class="chip-label">Window</span><div class="var-chips">${state.meta.windows
    .map(
      (windowKey) =>
        `<button class="var-chip ${windowKey === state.windowKey ? "on" : ""}" data-action="select-window" data-window="${windowKey}" type="button">${windowKey.replace(
          "-",
          "–"
        )}</button>`
    )
    .join("")}</div></div>`;
}

function verdictBlock(trend, variable, info) {
  if (!trend) {
    return `<div class="verdict none">
      <div class="verdict-stamp">No evidence</div>
      <div class="verdict-rate">—<span class="unit">${escapeHtml(variable.units)} / decade</span></div>
      <div class="verdict-sub">No complete annual series for this window.</div>
    </div>`;
  }
  const ci =
    Number.isFinite(trend.ci_low_per_decade) && Number.isFinite(trend.ci_high_per_decade)
      ? `95% CI ${signed(trend.ci_low_per_decade, 2)} to ${signed(trend.ci_high_per_decade, 2)}`
      : "95% CI not available";
  return `<div class="verdict ${info.tone}">
    <div class="verdict-stamp">${info.stamp}</div>
    <div class="verdict-rate">${signed(trend.slope_per_decade, 2)}<span class="unit">${escapeHtml(
      variable.units
    )} / decade</span></div>
    <div class="verdict-sub"><span class="verdict-word">${info.word}</span> · ${ci} · n = ${
      trend.n
    }</div>
  </div>`;
}

function caveatBlock(trend, variable, isGrid) {
  if (!trend) return "";
  if (trend.exploratory || (trend.n && trend.n < 20)) {
    return `<div class="caveat">Only ${trend.n} annual means. Below 20 the app refuses a significance claim and labels the result exploratory.</div>`;
  }
  if (isGrid && trend.q_value != null && trend.q_value > 0.05 && trend.p_value != null && trend.p_value < 0.05) {
    return `<div class="caveat">This cell is locally significant (p ${pText(
      trend.p_value
    )}) but does not survive the grid-wide Benjamini–Hochberg correction (q = ${formatP(
      trend.q_value
    )}).</div>`;
  }
  if (trend.verdict === "no significant trend") {
    return `<div class="caveat">A non-significant result is not proof of no trend — only that this record cannot separate one from noise.</div>`;
  }
  return "";
}

function facts(trend, variable, isGrid, counts = null) {
  if (!trend) {
    return `<dt>Series</dt><dd>unavailable</dd><dt>Units</dt><dd>${escapeHtml(
      variable.units
    )}</dd><dt>Source</dt><dd>${escapeHtml(variable.source)}</dd>`;
  }
  const rows = [
    ["Sample size", `${trend.n} annual means`],
    ["HAC lag", trend.maxlag ?? "—"],
    ["HAC p-value", formatP(trend.p_value)],
  ];
  if (isGrid) rows.push(["BH q-value", formatP(trend.q_value)]);
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
  if (counts) {
    rows.push(["Significant ↑", counts.significant_increasing.toLocaleString()]);
    rows.push(["Significant ↓", counts.significant_decreasing.toLocaleString()]);
    rows.push(["Not significant", counts.not_significant.toLocaleString()]);
  }
  return rows.map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(String(value))}</dd>`).join("");
}

function liveChip(point) {
  if (!point.live) return "";
  const values = [];
  if (Number.isFinite(point.live.t_2m)) values.push(`${point.live.t_2m.toFixed(1)} °C now`);
  if (Number.isFinite(point.live.precip_1h)) values.push(`${point.live.precip_1h.toFixed(2)} mm/h`);
  if (Number.isFinite(point.live.wind_speed_10m)) values.push(`${point.live.wind_speed_10m.toFixed(1)} m/s`);
  if (!values.length) return "";
  return `<div class="live-chip"><i></i> Live · ${escapeHtml(values.join(" · "))} · Meteomatics</div>`;
}

function imagery(point) {
  if (!point.imagery) return "";
  const meta = point.imagery_meta || {};
  const label = meta.label || "Imagery";
  const source = meta.source || "NASA Blue Marble";
  const attribution = meta.attribution || "NASA Blue Marble context crop";
  return `<div class="imagery" data-source="${escapeHtml(meta.source_id || "blue-marble")}">
    <img src="${escapeHtml(assetUrl(point.imagery))}" alt="${escapeHtml(source)} imagery around ${escapeHtml(
      point.name
    )}" title="${escapeHtml(attribution)}" loading="lazy" />
    <span>${escapeHtml(label)}</span>
  </div>`;
}

function caseSources(point, variable) {
  const bits = [`<b>Variable:</b> ${escapeHtml(variable.source)}`];
  if (point?.live) bits.push("<b>Live:</b> Meteomatics");
  if (point?.imagery) {
    const meta = point.imagery_meta || {};
    const label = meta.label || "NASA Blue Marble context crop";
    const attribution = meta.attribution ? ` — ${escapeHtml(meta.attribution)}` : "";
    bits.push(`<b>Imagery:</b> ${escapeHtml(label)}${attribution}`);
  }
  if (variable.kind === "grid") bits.push("<b>Grid:</b> GISTEMP v4, 4° subsample, BH q = 0.05");
  return `<div class="case-sources">${bits.join("<br>")}</div>`;
}

function workBlock(kind) {
  const text =
    kind === "grid"
      ? "Annual GISTEMP anomalies are fitted with OLS and Newey–West HAC standard errors. The map uses a 4° subsample and Benjamini–Hochberg q = 0.05. The baseline is the published 1951–1980 anomaly. No attribution is claimed."
      : kind === "global"
        ? "The global series is the published GISTEMP annual anomaly. The cell counts come from the same 4° subsample and HAC contract, corrected with Benjamini–Hochberg q = 0.05. The global slope is not an area-weighted average of the cells."
        : "Annual means only. OLS with Newey–West HAC standard errors; verdict at p < 0.05; 95% interval with Student-t on n − 2 df; Sen's slope as a robust check; Mann–Kendall descriptive only. The AI proposed the variable and wrote the narrative; it did not compute a number.";
  return `<details class="work"><summary>Show your work</summary><p>${escapeHtml(text)}</p></details>`;
}

function cityNarrative(point, variable, trend, windowKey) {
  if (!trend) {
    return `No complete annual series is available for ${escapeHtml(variable.short)} at ${escapeHtml(
      point.name
    )} in this window.`;
  }
  const direction =
    variable.code === "PRECTOTCORR" || variable.code === "GWETROOT"
      ? trend.slope_per_decade >= 0
        ? "increased"
        : "decreased"
      : trend.slope_per_decade >= 0
        ? "rose"
        : "fell";
  const sentence = trend.exploratory
    ? `Only ${trend.n} annual means are available, so the result is labelled exploratory and no significance claim is made.`
    : trend.verdict === "significant increasing" || trend.verdict === "significant decreasing"
      ? `The slope survives the HAC significance test at the 5% level (p ${pText(trend.p_value)}).`
      : `The fitted slope does not survive the HAC significance test at the 5% level (p ${pText(
          trend.p_value
        )}), so the app does not call it a trend.`;
  return `${escapeHtml(point.name)}'s annual ${escapeHtml(
    variable.short.toLowerCase()
  )} ${direction} by <strong>${signed(trend.slope_per_decade)} ${escapeHtml(
    variable.units
  )} per decade</strong> over ${windowKey.replace("-", "–")} (95% CI ${signed(
    trend.ci_low_per_decade
  )} to ${signed(trend.ci_high_per_decade)}; n = ${trend.n}; HAC p ${pText(
    trend.p_value
  )}). ${sentence} Sen's slope is ${signed(
    trend.sen_slope_per_decade
  )} ${escapeHtml(variable.units)}/decade. Mann–Kendall is a descriptive cross-check only. This is a trend detection, not an attribution.`;
}

function gridNarrative(cell, trend, variable, windowKey) {
  if (!trend) {
    return `No complete annual series is available for this GISTEMP cell in the ${windowKey.replace(
      "-",
      "–"
    )} window.`;
  }
  const direction = trend.slope_per_decade >= 0 ? "rose" : "fell";
  const local = `The GISTEMP cell at ${Math.abs(cell.lat).toFixed(1)}°${
    cell.lat >= 0 ? "N" : "S"
  } ${Math.abs(cell.lon).toFixed(1)}°${cell.lon >= 0 ? "E" : "W"} ${direction} by <strong>${signed(
    trend.slope_per_decade
  )} °C per decade</strong> relative to the 1951–1980 baseline over ${windowKey.replace(
    "-",
    "–"
  )} (95% CI ${signed(trend.ci_low_per_decade)} to ${signed(
    trend.ci_high_per_decade
  )}; n = ${trend.n}; HAC p ${pText(trend.p_value)}).`;
  const correction = trend.significant
    ? ` It remains significant after the grid-wide Benjamini–Hochberg correction (q = ${formatP(
        trend.q_value
      )}).`
    : trend.p_value < 0.05
      ? ` It is locally significant but does not survive the grid-wide correction (q = ${formatP(
          trend.q_value
        )}).`
      : ` It does not survive the HAC test at the 5% level (q = ${formatP(trend.q_value)}).`;
  return `${local}${correction} This is a trend detection, not an attribution.`;
}

function globalNarrative(trend, variable, windowKey, counts) {
  if (!trend) {
    return `No global GISTEMP trend is available for the ${windowKey.replace("-", "–")} window.`;
  }
  const direction = trend.slope_per_decade >= 0 ? "rose" : "fell";
  return `The global annual temperature anomaly ${direction} by <strong>${signed(
    trend.slope_per_decade
  )} °C per decade</strong> over ${windowKey.replace(
    "-",
    "–"
  )} (95% CI ${signed(trend.ci_low_per_decade)} to ${signed(
    trend.ci_high_per_decade
  )}; n = ${trend.n}; HAC p ${pText(trend.p_value)}). Across the 4° grid, ${counts.significant_increasing.toLocaleString()} cells show a significant increase after Benjamini–Hochberg correction, ${counts.significant_decreasing.toLocaleString()} a significant decrease, and ${counts.not_significant.toLocaleString()} are not significant. This is a trend detection, not an attribution.`;
}

/* --------------------------------------------------------------- intake UI */

function renderSuggestions() {
  els.suggestions.innerHTML = state.rag.examples
    .slice(0, 5)
    .map(
      (question) =>
        `<button class="chip" type="button" data-question="${escapeHtml(question)}">${escapeHtml(
          question
        )}</button>`
    )
    .join("");
}

function renderFeatured() {
  const grid = document.getElementById("featured-grid");
  if (!grid) return;
  grid.innerHTML = FEATURED_CASES.map((item) => {
    const point = state.byId.get(item.id);
    if (!point) return "";
    const trend = point.trends?.[item.code]?.[item.window];
    const color = trendColor(trend);
    const variable = state.byCode.get(item.code);
    return `<button class="case-card" data-action="featured" data-id="${item.id}" data-code="${
      item.code
    }" data-window="${item.window}" type="button">
      <span class="flag" style="background:${color};box-shadow:0 0 8px ${color}55"></span>
      <span class="name">${escapeHtml(item.label)}</span>
      <span class="var">${escapeHtml(variable?.short || item.code)}</span>
    </button>`;
  }).join("");
}

function renderPlan(plan) {
  if (!plan) {
    els.plan.innerHTML = "";
    return;
  }
  const confidence = Math.round(plan.confidence * 100);
  els.plan.innerHTML = `<div class="plan">
    <div class="plan-top">
      <span class="panel-kicker">Case plan</span>
      <span class="plan-confidence">${confidence}% match</span>
    </div>
    <div class="plan-title">${escapeHtml(plan.variable.label)}</div>
    <div class="plan-meta">${escapeHtml(plan.place.name)} · ${plan.windowKey.replace(
      "-",
      "–"
    )} · ${escapeHtml(plan.variable.units)}</div>
    <p class="plan-why">${escapeHtml(plan.explanation)}</p>
    <div class="plan-sources">${escapeHtml(plan.sources)}${
      plan.note ? `<br>${escapeHtml(plan.note)}` : ""
    }</div>
    <div class="plan-actions">
      <button class="primary-btn" type="button" data-action="run-plan">Run this case</button>
      <button class="ghost-btn" type="button" data-action="clear-plan">Clear</button>
    </div>
    ${
      plan.alternatives.length
        ? `<div class="plan-alt">Also possible: ${plan.alternatives
            .map((alternative) => escapeHtml(alternative.short))
            .join(" · ")}</div>`
        : ""
    }
  </div>`;
}

function handleAsk(question) {
  const plan = planCase(question, {
    rag: state.rag,
    points: state.points,
    variables: state.variables,
  });
  state.plan = plan;
  renderPlan(plan);
}

function runPlan() {
  const plan = state.plan;
  if (!plan) return;
  state.windowKey = plan.windowKey;
  if (plan.place.global) {
    selectGlobal(plan.windowKey);
  } else {
    const point = state.byId.get(plan.place.id);
    if (!point) return;
    state.variable = plan.variable.code === "GISTEMP" ? "T2M" : plan.variable.code;
    selectPoint(point);
  }
  showToast(`Case opened: ${plan.variable.short} · ${plan.place.name}`);
}

/* -------------------------------------------------------------- chrome UI */

function renderSourceStrip() {
  els.sourceStrip.innerHTML = state.sources
    .map((source) => {
      const cls = `source-pill ${source.status === "ok" ? "" : "offline"}`;
      const title = escapeHtml(source.detail || "");
      const label = `${escapeHtml(source.name.replace("NASA ", ""))}`;
      const href = SOURCE_LINKS[source.id];
      if (!href) return `<span class="${cls}" title="${title}"><i></i>${label}</span>`;
      return `<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${title}"><i></i>${label}</a>`;
    })
    .join("");
}

function renderEmptyCase() {
  els.casePanel.innerHTML = `<div class="empty-state">
    <div class="panel-kicker">Case board</div>
    <h2>No case open.</h2>
    <p class="panel-lede">Pick a featured case, ask a question, or click a point on the globe.</p>
    <div class="featured-grid" id="featured-grid"></div>
    <div class="how">
      <div class="panel-kicker">How a case works</div>
      <ol>
        <li>Ask a question or choose a place.</li>
        <li>The intake assistant proposes a variable and a record.</li>
        <li>The stats engine fits the trend and tests it.</li>
        <li>You get a verdict, a rate, an interval and the limits.</li>
      </ol>
    </div>
  </div>`;
  renderFeatured();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function hideLoading() {
  els.loading.classList.add("hidden");
  els.loading.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    if (els.loading.isConnected) els.loading.remove();
  }, 520);
}

function showFatal(error) {
  console.error(error);
  els.loading.innerHTML = `<div style="max-width:420px;padding:24px">
    <div class="panel-kicker">Data missing</div>
    <div class="loading-text" style="color:#e6edf3;margin-bottom:8px">The evidence locker did not load.</div>
    <div style="font-size:12px;line-height:1.6;color:#8b98a3">${escapeHtml(
      error.message || String(error)
    )}. Run the data build, then reload.</div>
  </div>`;
}

/* -------------------------------------------------------------- helpers */

function seriesWindow(values, years, windowKey) {
  const [start, end] = windowKey.split("-").map(Number);
  const outYears = [];
  const outValues = [];
  years.forEach((year, index) => {
    if (year >= start && year <= end) {
      outYears.push(year);
      outValues.push(values?.[index] ?? null);
    }
  });
  return { years: outYears, values: outValues };
}

function normalizeGridTrend(trend) {
  if (!trend) return null;
  const significant = Boolean(trend.significant);
  return {
    ...trend,
    slope_per_decade: trend.slope,
    p_value: trend.p,
    q_value: trend.q,
    ci_low_per_decade: trend.ci_low,
    ci_high_per_decade: trend.ci_high,
    sen_slope_per_decade: trend.sen,
    mk_tau: trend.mk_tau,
    r_squared: trend.r_squared,
    verdict: significant
      ? trend.slope > 0
        ? "significant increasing"
        : "significant decreasing"
      : "no significant trend",
    exploratory: false,
  };
}

function verdictInfo(trend, variable) {
  if (!trend) {
    return { tone: "none", stamp: "NO EVIDENCE", word: "No data" };
  }
  const n = trend.n || 0;
  const p = trend.p_value ?? trend.p ?? 1;
  const significant = trend.significant ?? (trend.verdict?.startsWith("significant") || false);
  if (trend.exploratory || n < 20) {
    return { tone: "explore", stamp: "COLD CASE", word: "Exploratory" };
  }
  if (!significant) {
    return { tone: "none", stamp: "NOT PROVEN", word: "Not proven" };
  }
  const increasing = trend.slope_per_decade > 0 || trend.slope > 0;
  const word = changeWord(variable, increasing);
  return {
    tone: increasing ? "warm" : "cool",
    stamp: p < 0.001 ? "OPEN AND SHUT" : "SIGNIFICANT",
    word,
  };
}

function changeWord(variable, increasing) {
  if (variable.code === "T2M" || variable.code === "GISTEMP") {
    return increasing ? "Significant warming" : "Significant cooling";
  }
  if (variable.code === "PRECTOTCORR") {
    return increasing ? "Significant wetting" : "Significant drying";
  }
  if (variable.code === "GWETROOT") {
    return increasing ? "Significant wetting" : "Significant drying";
  }
  if (variable.code === "ALLSKY_SFC_SW_DWN") {
    return increasing ? "Significant brightening" : "Significant dimming";
  }
  return increasing ? "Significant increase" : "Significant decrease";
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

function pText(value) {
  const formatted = formatP(value);
  return formatted.startsWith("<") ? formatted : `= ${formatted}`;
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

/* --------------------------------------------------------------- events */

function bindStaticEvents() {
  els.askForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleAsk(els.askInput.value);
  });

  els.suggestions.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-question]");
    if (!chip) return;
    els.askInput.value = chip.dataset.question;
    handleAsk(chip.dataset.question);
  });

  els.plan.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "run-plan") runPlan();
    if (action.dataset.action === "clear-plan") {
      state.plan = null;
      renderPlan(null);
    }
  });

  els.casePanel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const name = action.dataset.action;
    if (name === "close-case") {
      clearCase();
      return;
    }
    if (name === "select-variable") {
      state.variable = action.dataset.code;
      renderCase();
      refreshLayer();
      return;
    }
    if (name === "select-window") {
      state.windowKey = action.dataset.window;
      if (state.selectedKind === "grid" && !state.selected.trends?.[state.windowKey]) {
        state.windowKey = state.meta.windows[0];
        showToast("That window has no complete series for this cell.");
      }
      renderCase();
      refreshLayer();
      return;
    }
    if (name === "featured") {
      openFeatured(action.dataset.id, action.dataset.code, action.dataset.window);
    }
  });

  document.querySelectorAll(".layer-switch button").forEach((button) => {
    button.addEventListener("click", () => {
      state.layer = button.dataset.layer;
      refreshLayer();
      showToast(state.layer === "field" ? "Trend field: 4,039 GISTEMP cells" : "City points: 45 stations");
    });
  });

  els.globalBtn.addEventListener("click", () => selectGlobal(state.windowKey));

  const openMethod = () => els.methodDialog.showModal();
  els.methodBtn.addEventListener("click", openMethod);
  els.closeMethod.addEventListener("click", () => els.methodDialog.close());
  els.methodDone.addEventListener("click", () => els.methodDialog.close());
  els.methodDialog.addEventListener("click", (event) => {
    if (event.target === els.methodDialog) els.methodDialog.close();
  });
}
