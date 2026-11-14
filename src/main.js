import Globe from "globe.gl";
import { CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from "three";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import "./style.css";
import { planCase } from "./rag.js";
import { renderSeriesChart, trendColor } from "./chart.js";
import { SOURCE_LINKS } from "./sources.js";
import { formatLatLon, haversineKm, nearestCell, nearestRecord } from "./geo.js";

const state = {
  variables: [],
  points: [],
  countries: [],
  countriesById: new Map(),
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
  recommendation: null,
  hovered: null,
};

const BASE_URL = import.meta.env.BASE_URL || "/";
const LIVE_REFRESH_MS = 10 * 60 * 1000;

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
  loading: document.getElementById("loading"),
  toast: document.getElementById("toast"),
  hint: document.getElementById("hint"),
  methodDialog: document.getElementById("method-dialog"),
  methodBtn: document.getElementById("method-btn"),
  globalBtn: document.getElementById("global-btn"),
  closeMethod: document.getElementById("close-method"),
  methodDone: document.getElementById("method-done"),
  recommendation: document.getElementById("recommendation"),
};

let globe;
let toastTimer;
let autoRotateTimer;
let hoveredMesh = null;
let hoveredScale = null;
let hoveredHalo = null;
let hoveredHaloPoint = null;
let countryFeatures = null;
let countryShapes = null;
let hoverFrame = 0;
let pendingPointer = null;

init();

async function init() {
  bindStaticEvents();
  try {
    const [variables, points, grid, rag, countries, sources] = await Promise.all([
      loadJson(assetUrl("/data/variables.json")),
      loadJson(assetUrl("/data/points.json")),
      loadJson(assetUrl("/data/grid.json")),
      loadJson(assetUrl("/data/rag_index.json")),
      loadJson(assetUrl("/data/countries.json")),
      loadJson(assetUrl("/data/sources.json")),
    ]);

    state.variables = variables.variables;
    state.points = points.points;
    state.meta = points.meta;
    state.grid = grid;
    state.rag = rag;
    state.countries = countries.countries;
    state.countriesById = new Map(state.countries.map((country) => [country.id, country]));
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
      window.__caseFiles = {
        state,
        selectPoint,
        selectGlobal,
        refreshLayer,
        renderCase,
        recommendAt,
        clearRecommendation,
      };
    }

    buildGlobe();
    renderSourceStrip();
    renderSuggestions();
    renderEmptyCase();
    hideLoading();
    startLiveRefresh();
    if (window.location.hash === "#method") els.methodDialog.showModal();
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
  countryFeatures = feature(world, world.objects.countries).features;
  const countries = countryFeatures;

  globe = new Globe(els.globe)
    .globeImageUrl(assetUrl("/textures/earth-blue-marble.jpg"))
    .bumpImageUrl(assetUrl("/textures/earth-topology.jpg"))
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
    .pointResolution(6)
    .pointsTransitionDuration(0)
    .pointsMerge(false)
    .customLayerData([])
    .customThreeObject(customLayerObject)
    .customThreeObjectUpdate(customLayerUpdate)
    .arcsData([])
    .arcStartLat("startLat")
    .arcStartLng("startLng")
    .arcEndLat("endLat")
    .arcEndLng("endLng")
    .arcColor(() => ["rgba(255, 209, 102, 0.2)", RECOMMENDATION_COLOR])
    .arcStroke(RECOMMENDATION_STROKE)
    .arcDashLength(0.35)
    .arcDashGap(0.2)
    .arcDashAnimateTime(2600)
    .arcAltitudeAutoScale(0.35)
    .arcsTransitionDuration(0)
    .arcLabel((arc) => arc.distance)
    .labelsData([])
    .labelLat("lat")
    .labelLng("lng")
    .labelText("text")
    .labelColor(() => RECOMMENDATION_COLOR)
    .labelSize("size")
    .labelDotRadius(0.4)
    .labelAltitude(0.016)
    .labelResolution(3)
    .labelsTransitionDuration(0)
    .onPointHover((point) => setHoveredPoint(point))
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

  // globe.gl only reports hits on a station's mesh. Projecting the pointer onto
  // the globe extends hover and clicks to the halo around each station.
  const canvas = globe.renderer().domElement;
  canvas.addEventListener("pointermove", handleCanvasPointerMove);
  canvas.addEventListener("pointerleave", () => setHoveredPoint(null));
  canvas.addEventListener("pointerdown", startGlobeTap);
  canvas.addEventListener("pointerup", finishGlobeTap);
  canvas.addEventListener("pointercancel", () => {
    tapOrigin = null;
  });

  refreshLayer();
}

function pointAltitude(point) {
  if (isSelected(point)) return 0.05;
  return point.isGrid ? 0.004 : 0.014;
}

function pointRadius(point) {
  if (isSelected(point)) return point.isGrid ? 0.25 : 0.5;
  // The station layer now holds a case for every country, so the dots stay
  // small enough to keep neighbouring cities apart on the globe.
  return point.isGrid ? 0.17 : 0.2;
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

/* Each station keeps a faint halo: the "imaginary" area around the dot. When
   the cursor is anywhere inside that area the dot grows and the halo lights up,
   and a click there opens the case. three-globe keeps each point's mesh on its
   datum as __threeObjPoint, so one mesh is scaled instead of re-digesting the
   whole layer (4,039 points in the trend field). */
const HOVER_GROWTH = 1.85;
const HOVER_AREA_DEG = 1.6;
const HALO_INNER = 1.15;
const HALO_OUTER = 2.2;
const HALO_HOVER_SCALE = 1.8;
const HALO_ALTITUDE = 0.006;
const RECOMMENDATION_COLOR = "#ffd166";
const RECOMMENDATION_STROKE = 0.35;
const TAP_MARKER_INNER = 0.85;
const TAP_MARKER_OUTER = 1.45;

function haloObject(point) {
  const material = new MeshBasicMaterial({
    color: pointColor(point),
    transparent: true,
    opacity: haloOpacity(point),
    side: DoubleSide,
    depthWrite: false,
  });
  const mesh = new Mesh(new RingGeometry(HALO_INNER, HALO_OUTER, 44), material);
  mesh.renderOrder = 2;
  point.__halo = mesh;
  return mesh;
}

// The same custom layer carries the station halos and the yellow marker on the
// tapped point, so both follow the globe's surface with one digest.
function customLayerObject(datum) {
  return datum.kind === "tap" ? tapMarkerObject() : haloObject(datum);
}

function customLayerUpdate(object, datum) {
  const coords = globe.getCoords(datum.lat, datum.lon, HALO_ALTITUDE);
  object.position.set(coords.x, coords.y, coords.z);
  object.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), object.position.clone().normalize());
}

function tapMarkerObject() {
  const material = (opacity) =>
    new MeshBasicMaterial({
      color: RECOMMENDATION_COLOR,
      transparent: true,
      opacity,
      side: DoubleSide,
      depthWrite: false,
    });
  const group = new Group();
  group.add(new Mesh(new CircleGeometry(TAP_MARKER_INNER, 32), material(0.32)));
  group.add(new Mesh(new RingGeometry(TAP_MARKER_INNER * 1.3, TAP_MARKER_OUTER, 44), material(0.95)));
  group.renderOrder = 3;
  return group;
}

function haloOpacity(point) {
  return isSelected(point) ? 0.4 : 0.18;
}

function refreshHalos() {
  for (const point of state.points) {
    const halo = point.__halo;
    if (!halo) continue;
    halo.material.color.set(pointColor(point));
    halo.material.opacity = haloOpacity(point);
    halo.scale.setScalar(state.hovered === point ? HALO_HOVER_SCALE : 1);
  }
}

function setHoveredPoint(point) {
  if (state.hovered === point) return;
  restoreHoveredPoint();
  state.hovered = point || null;
  if (els.globe) els.globe.style.cursor = point ? "pointer" : "";
  if (!point) return;
  const mesh = point.__threeObjPoint;
  if (mesh?.scale) {
    hoveredMesh = mesh;
    hoveredScale = { x: mesh.scale.x, y: mesh.scale.y };
    mesh.scale.x = hoveredScale.x * HOVER_GROWTH;
    mesh.scale.y = hoveredScale.y * HOVER_GROWTH;
  }
  const halo = point.__halo;
  if (halo) {
    hoveredHalo = halo;
    hoveredHaloPoint = point;
    halo.scale.setScalar(HALO_HOVER_SCALE);
    halo.material.opacity = 0.55;
  }
}

function restoreHoveredPoint() {
  if (hoveredMesh && hoveredScale) {
    hoveredMesh.scale.x = hoveredScale.x;
    hoveredMesh.scale.y = hoveredScale.y;
  }
  if (hoveredHalo) {
    hoveredHalo.scale.setScalar(1);
    hoveredHalo.material.opacity = haloOpacity(hoveredHaloPoint);
  }
  hoveredMesh = null;
  hoveredScale = null;
  hoveredHalo = null;
  hoveredHaloPoint = null;
}

function nearestWithin(lat, lng, maxDegrees) {
  let best = null;
  let bestDegrees = maxDegrees;
  for (const point of state.points) {
    const degrees = haversineKm(lat, lng, point.lat, point.lon) / 111.32;
    if (degrees < bestDegrees) {
      bestDegrees = degrees;
      best = point;
    }
  }
  return best;
}

let tapOrigin = null;

function startGlobeTap(event) {
  if (event.button !== 0) return;
  tapOrigin = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId };
}

// globe.gl only resolves a click when the pointer already hovered the globe, which
// never happens on a touchscreen. Read the tap straight off the canvas instead, so
// the first tap on the world both works and lands on the right coordinates.
function finishGlobeTap(event) {
  const origin = tapOrigin;
  tapOrigin = null;
  if (!origin || origin.id !== event.pointerId || !globe) return;
  if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) return;
  if (performance.now() - origin.time > 700) return;
  const rect = globe.renderer().domElement.getBoundingClientRect();
  const coords = globe.toGlobeCoords(event.clientX - rect.left, event.clientY - rect.top);
  if (!coords) return;
  const near = state.layer === "cities" ? nearestWithin(coords.lat, coords.lng, HOVER_AREA_DEG) : null;
  if (near) {
    selectPoint(near);
    return;
  }
  recommendAt(coords.lat, coords.lng);
}

function handleCanvasPointerMove(event) {
  if (state.layer !== "cities" || event.buttons !== 0) return;
  const rect = globe.renderer().domElement.getBoundingClientRect();
  pendingPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    if (!pendingPointer) return;
    const coords = globe.toGlobeCoords(pendingPointer.x, pendingPointer.y);
    if (!coords) {
      setHoveredPoint(null);
      return;
    }
    setHoveredPoint(nearestWithin(coords.lat, coords.lng, HOVER_AREA_DEG));
  });
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
  // Points are re-scaled by the layer update, so drop any hover growth with it.
  hoveredMesh = null;
  hoveredScale = null;
  hoveredHalo = null;
  hoveredHaloPoint = null;
  state.hovered = null;
  const data = state.layer === "field" ? state.gridPoints : state.points;
  globe.pointsData(data);
  if (state.layer === "field") {
    for (const point of state.points) delete point.__halo;
  }
  syncCustomLayer();
  globe.ringsData(
    state.selected && !state.selected.global
      ? [{ lat: state.selected.lat, lng: state.selected.lon }]
      : []
  );
  refreshHalos();
  document.querySelectorAll(".layer-switch button").forEach((button) => {
    button.classList.toggle("on", button.dataset.layer === state.layer);
  });
}

/* --------------------------------------------------------------- selection */

function selectPoint(point, options = {}) {
  if (!point) return;
  clearRecommendation();
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
  if (options.fly !== false) {
    globe.pointOfView(
      { lat: point.lat, lng: point.lon, altitude: point.isGrid ? 1.45 : 1.75 },
      900
    );
    globe.controls().autoRotate = false;
    clearTimeout(autoRotateTimer);
  }
  els.hint.textContent = point.isGrid
    ? "GISTEMP cell · click another cell"
    : `${point.name} · ${state.byCode.get(state.variable)?.short || "trend"}`;
}

function selectGlobal(windowKey = state.windowKey) {
  clearRecommendation();
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
  els.hint.textContent = "Drag to rotate · scroll to zoom · tap anywhere to find the nearest record";
}

/* ----------------------------------------------------- tap recommendation */

// Tapping the globe answers "what do you have near here?" without leaving it: a
// yellow marker on the tap, dashed yellow arcs to the closest station and the
// closest GISTEMP cell, their distances written on the globe, and a small card
// that can open either record.

let recommendationFrame = 0;
let customLayerKey = "";

function recommendAt(lat, lng) {
  if (!globe) return;
  state.recommendation = {
    target: { lat, lng },
    station: nearestRecord(lat, lng, state.points),
    cell: nearestCell(lat, lng, state.gridPoints),
  };
  globe.controls().autoRotate = false;
  clearTimeout(autoRotateTimer);
  syncCustomLayer();
  renderRecommendationOverlay();
  els.hint.textContent = "Nearest station and cell to the tapped point";
}

function clearRecommendation() {
  if (!state.recommendation) return;
  state.recommendation = null;
  if (globe) {
    globe.arcsData([]);
    globe.labelsData([]);
  }
  syncCustomLayer();
  stopRecommendationFrame();
  if (els.recommendation) {
    els.recommendation.hidden = true;
    els.recommendation.innerHTML = "";
  }
}

// One custom layer holds the station halos and, while a recommendation is up,
// the marker on the tapped point. three-globe re-digests the whole layer when the
// data identity changes, so hand it a new array only when the contents change.
function syncCustomLayer() {
  if (!globe) return;
  const rec = state.recommendation;
  const key = `${state.layer}|${rec ? `${rec.target.lat},${rec.target.lng}` : ""}`;
  if (key !== customLayerKey) {
    customLayerKey = key;
    const entries = state.layer === "cities" ? [...state.points] : [];
    if (rec) entries.push({ kind: "tap", lat: rec.target.lat, lon: rec.target.lng });
    globe.customLayerData(entries);
  }
  refreshHalos();
}

function renderRecommendationOverlay() {
  const rec = state.recommendation;
  if (!rec || !globe) return;
  const arcs = [];
  // The card already names the tapped coordinates, so the globe only carries the
  // two yellow distances to keep the overlay legible.
  const labels = [];
  for (const entry of [rec.station, rec.cell]) {
    if (!entry) continue;
    const target = entry.point || entry.cell;
    arcs.push({
      startLat: rec.target.lat,
      startLng: rec.target.lng,
      endLat: target.lat,
      endLng: target.lon,
      distance: distanceText(entry.km),
    });
    labels.push({
      lat: target.lat,
      lng: target.lon,
      text: distanceText(entry.km),
      size: 1,
    });
  }
  globe.arcsData(arcs);
  globe.labelsData(labels);
  renderRecommendationCard();
}

function renderRecommendationCard() {
  const el = els.recommendation;
  const rec = state.recommendation;
  if (!el) return;
  if (!rec) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const station = rec.station;
  const cell = rec.cell;
  const offset = station && station.km > 1 ? ` ${escapeHtml(station.direction)}` : "";
  el.innerHTML = `
    <button class="rec-close" type="button" data-action="close-recommendation" aria-label="Close recommendation">×</button>
    <div class="rec-target">${escapeHtml(formatLatLon(rec.target.lat, rec.target.lng))}</div>
    <div class="rec-row">
      <span class="rec-kind">Nearest station</span>
      <b>${escapeHtml(station?.point?.name || "none")}</b>
      <span class="rec-distance">${station ? `${distanceText(station.km)}${offset}` : "—"}</span>
      ${station ? `<button type="button" data-action="open-station">Open</button>` : ""}
    </div>
    <div class="rec-row">
      <span class="rec-kind">GISTEMP cell</span>
      <b>${escapeHtml(cell?.cell?.name || "none")}</b>
      <span class="rec-distance">${cell ? distanceText(cell.km) : "—"}</span>
      ${cell ? `<button type="button" data-action="open-cell">Open</button>` : ""}
    </div>
  `;
  el.hidden = false;
  positionRecommendationCard();
  startRecommendationFrame();
}

// Keep the card beside the tapped point as the globe moves, and hide it when the
// point has rotated behind the globe.
function positionRecommendationCard() {
  const el = els.recommendation;
  const rec = state.recommendation;
  if (!el || !rec || !globe) return;
  const { x, y, z } = globe.getCoords(rec.target.lat, rec.target.lng, 0);
  const facing = new Vector3(x, y, z).normalize().dot(globe.camera().position) > 100;
  el.style.opacity = facing ? "1" : "0";
  el.style.pointerEvents = facing ? "auto" : "none";
  if (!facing) return;
  const screen = globe.getScreenCoords(rec.target.lat, rec.target.lng, 0.01);
  const width = el.offsetWidth || 250;
  const height = el.offsetHeight || 140;
  const left = Math.min(Math.max(screen.x + 18, 12), window.innerWidth - width - 12);
  const top = Math.min(Math.max(screen.y + 18, 74), window.innerHeight - height - 58);
  el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function startRecommendationFrame() {
  if (recommendationFrame) return;
  const tick = () => {
    if (!state.recommendation) {
      recommendationFrame = 0;
      return;
    }
    positionRecommendationCard();
    recommendationFrame = requestAnimationFrame(tick);
  };
  recommendationFrame = requestAnimationFrame(tick);
}

function stopRecommendationFrame() {
  if (recommendationFrame) cancelAnimationFrame(recommendationFrame);
  recommendationFrame = 0;
}

function distanceText(km) {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return "< 1 km";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

/* ------------------------------------------------------------------- cases */

function renderCase() {
  if (state.selectedKind === "global") return renderGlobalCase();
  if (state.selectedKind === "grid") return renderGridCase();
  if (state.selectedKind === "country") return renderCountryCase();
  if (state.selectedKind === "city") return renderCityCase();
  renderEmptyCase();
}

function selectCountry(country) {
  if (!country) return;
  clearRecommendation();
  state.selected = country;
  state.selectedKind = "country";
  state.layer = "cities";
  if (!country.trends?.[state.variable]?.[state.windowKey]) {
    state.variable = country.trends?.T2M ? "T2M" : Object.keys(country.trends || {})[0] || "T2M";
  }
  document.body.classList.add("has-case");
  renderCase();
  refreshLayer();
  globe.pointOfView({ lat: country.lat, lng: country.lon, altitude: 2.15 }, 900);
  globe.controls().autoRotate = false;
  clearTimeout(autoRotateTimer);
  els.hint.textContent = `${country.name} · mean of ${country.stations} stations`;
}

function countryNarrative(country, variable, trend, windowKey) {
  if (!trend) {
    return `No ${variable.short.toLowerCase()} series is available for ${country.name} in the ${windowKey.replace("-", "–")} window.`;
  }
  const direction = trend.slope_per_decade >= 0 ? "rose" : "fell";
  const correction = trend.significant
    ? ` It survives the Benjamini–Hochberg correction across ${state.countries.length} country averages (q = ${formatP(
        trend.q_value
      )}).`
    : trend.p_value < 0.05
      ? ` It is locally significant but does not survive the correction across ${state.countries.length} country averages (q = ${formatP(
          trend.q_value
        )}).`
      : ` It does not survive the HAC test at the 5% level (q = ${formatP(trend.q_value)}).`;
  return `Averaged over the ${country.stations} ${country.name} station${
    country.stations === 1 ? "" : "s"
  } in this bundle, annual ${variable.short.toLowerCase()} ${direction} by <strong>${signed(
    trend.slope_per_decade
  )} ${variable.units} per decade</strong> over ${windowKey.replace(
    "-",
    "–"
  )} (95% CI ${signed(trend.ci_low_per_decade)} to ${signed(
    trend.ci_high_per_decade
  )}; n = ${trend.n}; HAC p ${pText(trend.p_value)}).${correction} A country mean describes the stations, not every square kilometre: they cluster where people live, so desert and mountain interiors are represented only as far as the network reaches. This is a trend detection, not an attribution.`;
}

function renderCountryCase() {
  const country = state.selected;
  const code = state.variable === "GISTEMP" ? "T2M" : state.variable;
  const variable = state.byCode.get(code) || state.variables[0];
  const trend = country.trends?.[code]?.[state.windowKey] || null;
  const series = country.series?.[code] || [];
  const window = seriesWindow(series, state.meta.years, state.windowKey);
  const info = verdictInfo(trend, variable);
  const id = caseId(`${country.id}:${code}:${state.windowKey}`);

  els.casePanel.innerHTML = `
    <div class="case-head">
      <div class="case-id">${id}</div>
      <button class="case-close" data-action="close-case" type="button">Close</button>
    </div>
    <h2 class="place-title">${escapeHtml(country.name)}</h2>
    <p class="place-sub">Country average · ${country.stations} station${
      country.stations === 1 ? "" : "s"
    } · ${escapeHtml(country.continent)}</p>
    ${variableChips(variable, false)}
    ${windowChips()}
    <p class="narrative">${countryNarrative(country, variable, trend, state.windowKey)}</p>
    ${verdictBlock(trend, variable, info)}
    ${caveatBlock(trend, variable, false)}
    <div class="chart" id="case-chart"></div>
    <dl class="facts">
      <div><dt>Stations averaged</dt><dd>${country.stations}</dd></div>
      <div><dt>With all four variables</dt><dd>${country.full_coverage}</dd></div>
      <div><dt>Series</dt><dd>${state.windowKey.replace("-", "–")} · n = ${
        window.years.length
      }</dd></div>
      <div><dt>Source</dt><dd>NASA POWER (MERRA-2 derived) · station mean</dd></div>
    </dl>
    ${caseSources(null, variable)}
    <div class="case-cities">
      <div class="plan-cities-label">Open a city in ${escapeHtml(country.name)}</div>
      <div class="city-chips">${country.cities
        .map(
          (city) =>
            `<button class="chip chip-small" type="button" data-action="open-city" data-city-id="${escapeHtml(
              city.id
            )}">${escapeHtml(city.name)}</button>`
        )
        .join("")}</div>
    </div>
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
    <p class="narrative">${cityNarrative(point, variable, trend, state.windowKey)}</p>
    ${verdictBlock(trend, variable, info)}
    ${caveatBlock(trend, variable, false)}
    <div class="chart" id="case-chart"></div>
    <dl class="facts">${facts(trend, variable, false)}</dl>
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
    <p class="narrative">${gridNarrative(cell, trend, variable, state.windowKey)}</p>
    ${verdictBlock(trend, variable, info)}
    ${caveatBlock(trend, variable, true)}
    <div class="chart" id="case-chart"></div>
    <dl class="facts">${facts(trend, variable, true)}</dl>
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
    <p class="narrative">${globalNarrative(trend, variable, state.windowKey, counts)}</p>
    ${verdictBlock(trend, variable, info)}
    <div class="caveat">
      The global series is an anomaly relative to 1951–1980. The cell counts are the
      cells that survive Benjamini–Hochberg FDR correction at q = 0.05 across the grid;
      neighbouring cells are correlated, so that correction is approximate. The counts
      are not a second opinion on the global slope.
    </div>
    <div class="chart" id="case-chart"></div>
    <dl class="facts">${facts(trend, variable, false, counts)}</dl>
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
  if (!isGrid && trend.mk_p_corrected != null) {
    if (trend.p_value < 0.05 && trend.mk_p_corrected >= 0.05) {
      return `<div class="caveat">The HAC slope test is significant (p ${pText(
        trend.p_value
      )}), but the autocorrelation-corrected Mann–Kendall test is not (p ${pText(
        trend.mk_p_corrected
      )}). A verdict needs both, so this case is not proven.</div>`;
    }
    if (
      trend.p_value < 0.05 &&
      trend.mk_p_corrected < 0.05 &&
      trend.verdict === "no significant trend"
    ) {
      return `<div class="caveat">Both tests are significant, but they point in opposite directions, so the app does not call this a trend.</div>`;
    }
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
  if (Number.isFinite(trend.mk_p)) rows.push(["MK p (i.i.d.)", formatP(trend.mk_p)]);
  if (Number.isFinite(trend.mk_p_corrected)) {
    rows.push(["MK p (Hamed–Rao)", formatP(trend.mk_p_corrected)]);
  }
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
  const live = Boolean(point.live.is_live);
  const observed = liveTimeLabel(point.live.valid_time || point.live.fetched_at, live);
  const title = live
    ? `Meteomatics current conditions, fetched ${liveTimeLabel(point.live.fetched_at)}`
    : `Meteomatics snapshot from the last data build (${liveTimeLabel(
        point.live.valid_time || point.live.fetched_at
      )}); the live proxy is unavailable`;
  return `<div class="live-chip ${live ? "is-live" : "is-snapshot"}" title="${escapeHtml(
    title
  )}"><i></i>${live ? "Live" : "Snapshot"} · ${escapeHtml(
    values.join(" · ")
  )} · Meteomatics${observed ? ` · ${escapeHtml(observed)}` : ""}</div>`;
}

function liveTimeLabel(value, compact = false) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const time = `${hours}:${minutes} UTC`;
  if (compact) return time;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${day} ${month} ${time}`;
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
  if (variable.kind === "grid") bits.push("<b>Grid:</b> GISTEMP v4, 4° subsample, BH FDR q = 0.05");
  return `<div class="case-sources">${bits.join("<br>")}</div>`;
}

function workBlock(kind) {
  const text =
    kind === "grid"
      ? "Annual GISTEMP anomalies are fitted with OLS and Newey–West HAC standard errors. Cells count as significant only after Benjamini–Hochberg FDR correction at q = 0.05 across the 4° subsample. Neighbouring cells are correlated, so that correction is approximate. The baseline is the published 1951–1980 anomaly. No attribution is claimed."
      : kind === "global"
        ? "The global series is the published GISTEMP annual anomaly. The cell counts come from the same 4° subsample and HAC contract, corrected with Benjamini–Hochberg FDR at q = 0.05; neighbouring cells are correlated, so the correction is approximate. The global slope is not an area-weighted average of the cells."
        : "Annual means only. OLS with Newey–West HAC standard errors; 95% interval with Student-t on n − 2 df; Sen's slope as a robust check. A verdict needs the HAC p < 0.05 and the Hamed–Rao corrected Mann–Kendall p < 0.05 with the same direction. The AI proposed the variable and wrote the narrative; it did not compute a number.";
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
      ? `The HAC slope test (p ${pText(
          trend.p_value
        )}) and the corrected Mann–Kendall test (p ${pText(
          trend.mk_p_corrected
        )}) are both significant at the 5% level and agree on direction.`
      : `The app calls a trend only when the HAC slope test and the corrected Mann–Kendall test both pass at the 5% level; here HAC p ${pText(
          trend.p_value
        )} and corrected Mann–Kendall p ${pText(trend.mk_p_corrected)}.`;
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
  )} ${escapeHtml(
    variable.units
  )}/decade. The Mann–Kendall p-value uses the Hamed–Rao variance correction for autocorrelation, computed on the Sen-detrended series. This is a trend detection, not an attribution.`;
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
  )}; n = ${trend.n}; HAC p ${pText(trend.p_value)}). Across the 4° grid, ${counts.significant_increasing.toLocaleString()} cells survive Benjamini–Hochberg FDR correction at q = 0.05 as increases, ${counts.significant_decreasing.toLocaleString()} as decreases, and ${counts.not_significant.toLocaleString()} are not significant. Neighbouring cells are correlated, so that correction is approximate. This is a trend detection, not an attribution.`;
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
    <div class="plan-title">${escapeHtml(
      plan.kind === "country" ? `${plan.place.name} average` : plan.variable.label
    )}</div>
    <div class="plan-meta">${escapeHtml(plan.place.name)}${
      plan.kind === "country" ? ` · ${plan.place.stations} stations` : ""
    } · ${plan.windowKey.replace("-", "–")} · ${escapeHtml(plan.variable.units)}</div>
    <p class="plan-why">${escapeHtml(plan.explanation)}</p>
    <div class="plan-sources">${escapeHtml(plan.sources)}${
      plan.note ? `<br>${escapeHtml(plan.note)}` : ""
    }</div>
    ${
      plan.cities?.length
        ? `<div class="plan-cities">
      <div class="plan-cities-label">Or open a city in ${escapeHtml(plan.place.name)}</div>
      <div class="city-chips">${plan.cities
        .map(
          (city) =>
            `<button class="chip chip-small" type="button" data-action="plan-city" data-city-id="${escapeHtml(
              city.id
            )}">${escapeHtml(city.name)}</button>`
        )
        .join("")}</div>
    </div>`
        : ""
    }
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
    countries: state.countries,
  });
  state.plan = plan;
  renderPlan(plan);
}

function planForCity(cityId) {
  const point = state.byId.get(cityId);
  const base = state.plan;
  if (!point || !base) return;
  const plan = {
    ...base,
    kind: "city",
    place: point,
    cities: [],
    sources: `${base.variable.source} · ${point.name}, ${point.country}`,
    explanation: `"${point.name.toLowerCase()}" resolves to ${point.name}; using the ${base.windowKey.replace(
      "-",
      "–"
    )} record.`,
  };
  state.plan = plan;
  renderPlan(plan);
}

function runPlan() {
  const plan = state.plan;
  if (!plan) return;
  state.windowKey = plan.windowKey;
  if (plan.kind === "country") {
    selectCountry(plan.place);
    showToast(`Case opened: ${plan.variable.short} · ${plan.place.name} average`);
    return;
  }
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

/* ------------------------------------------------------------------- live */

function startLiveRefresh() {
  refreshLiveReadings();
  setInterval(() => {
    if (!document.hidden) refreshLiveReadings();
  }, LIVE_REFRESH_MS);
}

async function refreshLiveReadings() {
  try {
    const response = await fetch(assetUrl("/api/live"), { headers: { accept: "application/json" } });
    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.debug(`Live readings unavailable (HTTP ${response.status}); using the build snapshot.`);
      }
      return;
    }
    const payload = await response.json();
    if (!payload?.ok || !payload.points) return;

    let updated = 0;
    for (const point of state.points) {
      const reading = payload.points[point.id];
      if (!reading || !Number.isFinite(reading.t_2m)) continue;
      point.live = {
        t_2m: reading.t_2m,
        precip_1h: reading.precip_1h,
        wind_speed_10m: reading.wind_speed_10m,
        valid_time: reading.valid_time || payload.valid_time,
        fetched_at: payload.fetched_at,
        source: "Meteomatics",
        is_live: true,
      };
      updated += 1;
    }

    if (updated && state.selectedKind === "city") refreshLiveChip();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug("Live readings unavailable; using the build snapshot.", error);
    }
  }
}

function refreshLiveChip() {
  if (!state.selected || state.selectedKind !== "city") return;
  const markup = liveChip(state.selected);
  const chip = els.casePanel.querySelector(".live-chip");
  if (chip) {
    if (markup) chip.outerHTML = markup;
    else chip.remove();
    return;
  }
  if (!markup) return;
  const subtitle = els.casePanel.querySelector(".place-sub");
  if (subtitle) subtitle.insertAdjacentHTML("afterend", markup);
}

/* -------------------------------------------------------------- chrome UI */

function renderSourceStrip() {
  els.sourceStrip.innerHTML = state.sources
    .map((source) => {
      const cls = `source-pill ${source.status === "ok" ? "" : "offline"}`;
      const title = escapeHtml(source.detail || "");
      const label = `${escapeHtml(source.name.replace("NASA ", ""))}`;
      const href = SOURCE_LINKS[source.id]?.url;
      if (!href) return `<span class="${cls}" title="${title}">${label}</span>`;
      return `<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${title}">${label}</a>`;
    })
    .join("");
}

// The case panel only exists while a case is open, so there is nothing to draw
// and nothing to label when the board is empty.
function renderEmptyCase() {
  els.casePanel.innerHTML = "";
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
    if (action.dataset.action === "plan-city") planForCity(action.dataset.cityId);
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
    if (name === "open-city") {
      const point = state.byId.get(action.dataset.cityId);
      if (point) selectPoint(point);
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
  });

  document.querySelectorAll(".layer-switch button").forEach((button) => {
    button.addEventListener("click", () => {
      state.layer = button.dataset.layer;
      refreshLayer();
      showToast(
        state.layer === "field"
          ? `Trend field: ${state.gridPoints.length.toLocaleString()} GISTEMP cells`
          : `City points: ${state.points.length.toLocaleString()} stations`
      );
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

  els.recommendation?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action || !els.recommendation.contains(action)) return;
    const rec = state.recommendation;
    if (action.dataset.action === "close-recommendation") {
      clearRecommendation();
      return;
    }
    if (action.dataset.action === "open-station" && rec?.station?.point) {
      selectPoint(rec.station.point);
      return;
    }
    if (action.dataset.action === "open-cell" && rec?.cell?.cell) {
      selectPoint(rec.cell.cell);
    }
  });
}
