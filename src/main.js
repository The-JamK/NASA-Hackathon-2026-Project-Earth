import Globe from "globe.gl";
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from "three";
import { mesh as topojsonMesh } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import "./style.css";
import { oceanRegionAt, oceanVariable, planCase, seaIceVariable } from "./rag.js";
import { renderCompareChart, renderSeriesChart, trendColor } from "./chart.js";
import { caseSlug, downloadCsv, reportRows, seriesRows, toCsv } from "./export.js";
import { SOURCE_LINKS } from "./sources.js";
import { formatLatLon, haversineKm, nearestCell, nearestRecord } from "./geo.js";
import { deriveSteepUnproven } from "./herring.js";

const state = {
  exportData: null,
  variables: [],
  points: [],
  countries: [],
  countriesById: new Map(),
  ocean: [],
  oceanById: new Map(),
  oceanMeta: null,
  seaIce: [],
  seaIceById: new Map(),
  seaIceMeta: null,
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

// Readings fetched from the live proxy, keyed by station id. The build snapshot
// on the point stays untouched, so a failed refresh falls back to a labelled
// Snapshot rather than to a stale reading wearing a Live badge.
const liveReadings = new Map();

function liveFor(point) {
  if (!point?.id) return null;
  return liveReadings.get(point.id) || point.live || null;
}

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
  oceanLegend: document.getElementById("ocean-legend"),
};

let globe;
let toastTimer;
let autoRotateTimer;
let hoveredMesh = null;
let hoveredScale = null;
let hoverFrame = 0;
let pendingPointer = null;

init();

async function init() {
  bindStaticEvents();
  try {
    // Only the bundles a first case needs sit on the critical path. The 3.3 MB
    // trend field and the 2.0 MB country averages are loaded on first use by
    // ensureGrid()/ensureCountries(), so the globe is not held behind 11.3 MB of
    // JSON on a venue network.
    const [variables, points, rag, sources] = await Promise.all([
      loadJson(assetUrl("/data/variables.json")),
      loadJson(assetUrl("/data/points.json")),
      loadJson(assetUrl("/data/rag_index.json")),
      loadJson(assetUrl("/data/sources.json")),
    ]);

    state.variables = variables.variables;
    state.points = points.points;
    state.meta = points.meta;
    state.rag = rag;
    state.sources = sources.sources;
    state.windowKey = points.meta.windows[0];
    state.byCode = new Map(state.variables.map((variable) => [variable.code, variable]));
    state.byId = new Map(state.points.map((point) => [point.id, point]));

    if (import.meta.env.DEV) {
      window.__caseFiles = {
        state,
        // A getter, because the globe is built after this debug handle exists.
        get globe() {
          return globe;
        },
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

// Deferred bundles. Each has exactly one fetch and one promise, so asking twice
// costs one request and a failed load can be retried.
let gridPromise = null;
let countriesPromise = null;
let oceanPromise = null;
let seaIcePromise = null;

function ensureGrid() {
  if (state.grid) return Promise.resolve(state.grid);
  if (!gridPromise) {
    gridPromise = loadJson(assetUrl("/data/grid.json"))
      .then((grid) => {
        state.grid = grid;
        state.gridPoints = grid.cells.map((cell) => ({
          ...cell,
          isGrid: true,
          id: `grid:${cell.lat}:${cell.lon}`,
          name: `${Math.abs(cell.lat).toFixed(1)}°${cell.lat >= 0 ? "N" : "S"} ${Math.abs(
            cell.lon
          ).toFixed(1)}°${cell.lon >= 0 ? "E" : "W"}`,
        }));
        return grid;
      })
      .catch((error) => {
        gridPromise = null;
        throw error;
      });
  }
  return gridPromise;
}

function ensureCountries() {
  if (state.countries.length) return Promise.resolve(state.countries);
  if (!countriesPromise) {
    countriesPromise = loadJson(assetUrl("/data/countries.json"))
      .then((payload) => {
        state.countries = payload.countries;
        state.countriesById = new Map(state.countries.map((country) => [country.id, country]));
        return state.countries;
      })
      .catch((error) => {
        countriesPromise = null;
        throw error;
      });
  }
  return countriesPromise;
}

function ensureOcean() {
  if (state.ocean.length) return Promise.resolve(state.ocean);
  if (!oceanPromise) {
    oceanPromise = loadJson(assetUrl("/data/ocean.json"))
      .then((payload) => {
        state.ocean = payload.regions;
        state.oceanById = new Map(state.ocean.map((region) => [region.id, region]));
        state.oceanMeta = payload.meta;
        return state.ocean;
      })
      .catch((error) => {
        oceanPromise = null;
        throw error;
      });
  }
  return oceanPromise;
}

function ensureSeaIce() {
  if (state.seaIce.length) return Promise.resolve(state.seaIce);
  if (!seaIcePromise) {
    seaIcePromise = loadJson(assetUrl("/data/seaice.json"))
      .then((payload) => {
        state.seaIce = payload.records;
        state.seaIceById = new Map(state.seaIce.map((record) => [record.id, record]));
        state.seaIceMeta = payload.meta;
        return state.seaIce;
      })
      .catch((error) => {
        seaIcePromise = null;
        throw error;
      });
  }
  return seaIcePromise;
}

/* ------------------------------------------------------------------ globe */

function buildGlobe() {
  globe = new Globe(els.globe)
    .globeImageUrl(assetUrl("/textures/earth-blue-marble.jpg"))
    .bumpImageUrl(assetUrl("/textures/earth-topology.jpg"))
    .backgroundImageUrl(assetUrl("/textures/night-sky.png"))
    .atmosphereColor("#5fd3e0")
    .atmosphereAltitude(0.18)
    .showAtmosphere(true)
    .showGraticules(false)
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

  buildOverlay();
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
   and a click there opens the case.

   Drawn as one mesh per station, the 708 halos and the 286 country outlines were
   ~3,000 of the frame's 3,552 draw calls, and the globe sat at 15 fps for it.
   Both are now a single object each — the halos an InstancedMesh, the borders one
   LineSegments — which is the same picture for four calls. three-globe keeps each
   point's mesh on its datum as __threeObjPoint, so one mesh is scaled instead of
   re-digesting the whole layer (4,039 points in the trend field). */
const HOVER_GROWTH = 1.85;
const HOVER_AREA_DEG = 1.6;
const HALO_INNER = 1.15;
const HALO_OUTER = 2.2;
const HALO_SEGMENTS = 44;
const HALO_HOVER_SCALE = 1.8;
const HALO_ALTITUDE = 0.006;
const HALO_OPACITY = 0.18;
const HALO_SELECTED_OPACITY = 0.4;
const HALO_HOVER_OPACITY = 0.55;
const BORDER_ALTITUDE = 0.001;
const BORDER_STEP_DEG = 2;
const BORDER_COLOR = 0xaed8ff;
// A shared border used to be stroked once per country, so 0.2 twice; drawn once
// it needs a little more weight to read the same.
const BORDER_OPACITY = 0.3;
const RECOMMENDATION_COLOR = "#ffd166";
const RECOMMENDATION_STROKE = 0.35;
const TAP_MARKER_INNER = 0.85;
const TAP_MARKER_OUTER = 1.45;

const HALO_Z = new Vector3(0, 0, 1);
const haloPosition = new Vector3();
const haloNormal = new Vector3();
const haloQuaternion = new Quaternion();
const haloScale = new Vector3();
const haloMatrix = new Matrix4();
const haloColor = new Color();

let overlayGroup = null;
let haloMesh = null;
let hoverHalo = null;
let selectedHalo = null;
let borderLines = null;

// The custom layer carries the yellow marker on the tapped point; the halos and
// the country borders live in one overlay group of their own so they keep a
// stable draw-call count across layer switches.
function customLayerObject() {
  return tapMarkerObject();
}

function customLayerUpdate(object, datum) {
  orientOnGlobe(object, datum.lat, datum.lon, HALO_ALTITUDE);
}

function orientOnGlobe(object, lat, lon, altitude) {
  const coords = globe.getCoords(lat, lon, altitude);
  object.position.copy(coords);
  object.quaternion.setFromUnitVectors(HALO_Z, haloNormal.copy(coords).normalize());
}

function buildOverlay() {
  if (overlayGroup || !globe) return;
  overlayGroup = new Group();
  overlayGroup.name = "globe-overlay";
  borderLines = borderOutline();
  haloMesh = haloInstances();
  hoverHalo = haloRing(HALO_HOVER_OPACITY, HALO_HOVER_SCALE);
  selectedHalo = haloRing(HALO_SELECTED_OPACITY, 1);
  overlayGroup.add(borderLines, haloMesh, hoverHalo, selectedHalo);
  globe.scene().add(overlayGroup);
}

function haloMaterial(opacity) {
  return new MeshBasicMaterial({
    transparent: true,
    opacity,
    side: DoubleSide,
    depthWrite: false,
  });
}

function haloInstances() {
  const points = state.points;
  const mesh = new InstancedMesh(
    new RingGeometry(HALO_INNER, HALO_OUTER, HALO_SEGMENTS),
    haloMaterial(HALO_OPACITY),
    points.length
  );
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.renderOrder = 2;
  // The instances cover the whole sphere, so a bounding sphere around the base
  // ring at the origin would cull the mesh as soon as one station left frame.
  mesh.frustumCulled = false;
  points.forEach((point, index) => {
    point.__haloIndex = index;
    mesh.setColorAt(index, haloColor.set(pointColor(point)));
    writeHalo(mesh, index, point);
  });
  mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function writeHalo(mesh, index, point) {
  haloPosition.copy(globe.getCoords(point.lat, point.lon, HALO_ALTITUDE));
  haloQuaternion.setFromUnitVectors(HALO_Z, haloNormal.copy(haloPosition).normalize());
  // The hovered and selected station hide their base ring under the bright one,
  // so the drawn opacity is the halo's own rather than two blended together.
  haloScale.setScalar(haloScaleFor(point));
  haloMatrix.compose(haloPosition, haloQuaternion, haloScale);
  mesh.setMatrixAt(index, haloMatrix);
}

function haloScaleFor(point) {
  if (state.layer !== "cities") return 1;
  return point === state.hovered || isSelected(point) ? 0 : 1;
}

function haloRing(opacity, scale) {
  const mesh = new Mesh(new RingGeometry(HALO_INNER, HALO_OUTER, HALO_SEGMENTS), haloMaterial(opacity));
  mesh.renderOrder = 3;
  mesh.scale.setScalar(scale);
  mesh.visible = false;
  return mesh;
}

// Country borders as one LineSegments: the cap and side meshes three-globe built
// per country were fully transparent — they existed only to carry the stroke.
function borderOutline() {
  const lines = topojsonMesh(world, world.objects.countries);
  const positions = [];
  for (const line of lines.coordinates) {
    for (let index = 0; index < line.length - 1; index += 1) {
      const [lng1, lat1] = line[index];
      const [lng2, lat2] = line[index + 1];
      // One chord between distant vertices would cut under the sphere, so walk
      // each segment in steps small enough to hug the surface.
      const wrappedLng = ((((lng2 - lng1) % 360) + 540) % 360) - 180;
      const steps = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(lat2 - lat1), Math.abs(wrappedLng)) / BORDER_STEP_DEG)
      );
      let previous = null;
      for (let part = 0; part <= steps; part += 1) {
        const ratio = part / steps;
        const coords = globe.getCoords(
          lat1 + (lat2 - lat1) * ratio,
          lng1 + wrappedLng * ratio,
          BORDER_ALTITUDE
        );
        if (previous) positions.push(previous.x, previous.y, previous.z, coords.x, coords.y, coords.z);
        previous = coords;
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const mesh = new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: BORDER_COLOR,
      transparent: true,
      opacity: BORDER_OPACITY,
      depthWrite: false,
    })
  );
  mesh.renderOrder = 1;
  return mesh;
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

function refreshHalos() {
  if (!haloMesh) return;
  for (const point of state.points) {
    const index = point.__haloIndex;
    if (index === undefined) continue;
    haloMesh.setColorAt(index, haloColor.set(pointColor(point)));
  }
  haloMesh.instanceColor.needsUpdate = true;
  syncHalos();
}

// A full pass over the halos: only selection, layer and variable changes need
// one; hover moves a single instance.
function syncHalos() {
  if (!haloMesh) return;
  const cities = state.layer === "cities";
  haloMesh.visible = cities;
  const hovered = cities ? state.hovered : null;
  const selected = cities && state.selectedKind === "city" ? state.selected : null;
  for (const point of state.points) {
    const index = point.__haloIndex;
    if (index === undefined) continue;
    writeHalo(haloMesh, index, point);
  }
  haloMesh.instanceMatrix.needsUpdate = true;
  paintHalo(hoverHalo, hovered, HALO_HOVER_OPACITY, HALO_HOVER_SCALE);
  paintHalo(selectedHalo, selected, HALO_SELECTED_OPACITY, 1);
}

function paintHalo(mesh, point, opacity, scale) {
  if (!mesh) return;
  if (!point || state.layer !== "cities") {
    mesh.visible = false;
    return;
  }
  orientOnGlobe(mesh, point.lat, point.lon, HALO_ALTITUDE);
  mesh.scale.setScalar(scale);
  mesh.material.color.set(pointColor(point));
  mesh.material.opacity = opacity;
  mesh.visible = true;
}

function setHoveredPoint(point) {
  if (state.hovered === point) return;
  const previous = state.hovered;
  restoreHoveredMesh();
  state.hovered = point || null;
  if (els.globe) els.globe.style.cursor = point ? "pointer" : "";
  const mesh = state.hovered?.__threeObjPoint;
  if (mesh?.scale) {
    hoveredMesh = mesh;
    hoveredScale = { x: mesh.scale.x, y: mesh.scale.y };
    mesh.scale.x = hoveredScale.x * HOVER_GROWTH;
    mesh.scale.y = hoveredScale.y * HOVER_GROWTH;
  }
  if (haloMesh) {
    // Two instances move: the one the cursor left and the one it entered.
    for (const changed of [previous, state.hovered]) {
      const index = changed?.__haloIndex;
      if (index === undefined) continue;
      writeHalo(haloMesh, index, changed);
    }
    haloMesh.instanceMatrix.needsUpdate = true;
    paintHalo(hoverHalo, state.hovered, HALO_HOVER_OPACITY, HALO_HOVER_SCALE);
  }
}

function restoreHoveredPoint() {
  const previous = state.hovered;
  restoreHoveredMesh();
  state.hovered = null;
  if (haloMesh && previous) {
    const index = previous.__haloIndex;
    if (index !== undefined) {
      writeHalo(haloMesh, index, previous);
      haloMesh.instanceMatrix.needsUpdate = true;
    }
    paintHalo(hoverHalo, null, HALO_HOVER_OPACITY, HALO_HOVER_SCALE);
  }
}

function restoreHoveredMesh() {
  if (hoveredMesh && hoveredScale) {
    hoveredMesh.scale.x = hoveredScale.x;
    hoveredMesh.scale.y = hoveredScale.y;
  }
  hoveredMesh = null;
  hoveredScale = null;
}

// The ocean layer is a field of 4° cells; a tap lands within about 2.8° of a
// cell centre (half the diagonal), so 3° is "this cell" and nothing larger.
function nearestOceanCell(lat, lng, maxDegrees) {
  let best = null;
  let bestDegrees = maxDegrees;
  for (const cell of state.gridPoints) {
    if (!cell.is_ocean) continue;
    const degrees = haversineKm(lat, lng, cell.lat, cell.lon) / 111.32;
    if (degrees < bestDegrees) {
      bestDegrees = degrees;
      best = cell;
    }
  }
  return best;
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
async function finishGlobeTap(event) {
  const origin = tapOrigin;
  tapOrigin = null;
  if (!origin || origin.id !== event.pointerId || !globe) return;
  if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) return;
  if (performance.now() - origin.time > 700) return;
  const rect = globe.renderer().domElement.getBoundingClientRect();
  const coords = globe.toGlobeCoords(event.clientX - rect.left, event.clientY - rect.top);
  if (!coords) return;

  // In the Ocean layer a tap on water is a question about that basin, not a
  // request for the nearest station or a single cell's surface temperature.
  if (state.layer === "ocean") {
    await ensureOcean();
    const cell = nearestOceanCell(coords.lat, coords.lng, 3);
    if (!cell) {
      showToast("Land — the Ocean layer only shows water. Switch to Cities to ask about a station.");
      return;
    }
    // 339 of the 2,672 ocean cells (the tropical Atlantic, for one) fall outside
    // every named basin. That is water, so it opens the global ocean rather than
    // being reported as land.
    const basin = oceanRegionAt(cell.lat, cell.lon, state.ocean);
    const region = basin || state.ocean.find((item) => item.id === "global-ocean");
    if (!region) {
      showToast("No ocean region is loaded for that cell.");
      return;
    }
    await selectOcean(region);
    showToast(
      basin
        ? `Ocean case: ${region.name} · ${region.cells} cells`
        : "Ocean case: Global ocean · this water is outside the named basins"
    );
    return;
  }

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
  state.hovered = null;
  const data =
    state.layer === "ocean"
      ? state.gridPoints.filter((cell) => cell.is_ocean)
      : state.layer === "field"
        ? state.gridPoints
        : state.points;
  globe.pointsData(data);
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
  // The legend only explains the ocean when the ocean is on screen.
  if (els.oceanLegend) els.oceanLegend.hidden = state.layer !== "ocean";
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
  // One case, one reading: the proxy is asked for this station only.
  if (state.selectedKind === "city") refreshLiveForCase(point);
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

async function selectGlobal(windowKey = state.windowKey) {
  clearRecommendation();
  // The global case counts grid cells, so it waits for the trend field.
  await ensureGrid();
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
  state.exportData = null;
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

async function recommendAt(lat, lng) {
  if (!globe) return;
  // The nearest-cell half of the recommendation needs the trend field.
  await ensureGrid();
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
    // The halos are their own instanced overlay, so the only custom object left
    // is the marker on the tapped point.
    globe.customLayerData(rec ? [{ kind: "tap", lat: rec.target.lat, lon: rec.target.lng }] : []);
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
  const left = Math.min(Math.max(screen.x + 18, 10), window.innerWidth - width - 10);
  // Leave room for the legend bar at the bottom, including the home-indicator inset.
  const top = Math.min(Math.max(screen.y + 18, 66), window.innerHeight - height - 64);
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

// The export describes exactly what is on screen: same place, same variable or
// measure, same window, same trend object the verdict was built from.
function setExport(payload) {
  state.exportData = payload?.trend ? payload : null;
}

function mountExport() {
  const data = state.exportData;
  if (!data) return;
  const box = document.createElement("div");
  box.className = "export-box";
  // Sits directly under the verdict, not at the end of the panel: the buttons are
  // for checking the number above them, and at the bottom of a 1,300px scroll they
  // were three panel-heights away from it.
  box.innerHTML = `
    <div class="export-head">Check the numbers <span>CSV · Excel, R or pandas</span></div>
    <div class="export-actions">
      <button class="ghost-btn" type="button" data-action="export-series">Series CSV</button>
      <button class="ghost-btn" type="button" data-action="export-report">Statistics CSV</button>
    </div>`;
  els.casePanel.append(box);
}

function renderCase() {
  state.exportData = null;
  if (state.selectedKind === "global") renderGlobalCase();
  else if (state.selectedKind === "grid") renderGridCase();
  else if (state.selectedKind === "country") renderCountryCase();
  else if (state.selectedKind === "ocean") renderOceanCase();
  else if (state.selectedKind === "seaice") renderSeaIceCase();
  else if (state.selectedKind === "city") renderCityCase();
  else renderEmptyCase();
  mountExport();
  // A click that opens a case can leave the browser holding a scroll offset for
  // the button it just removed, so the panel is pinned to the top on the next
  // frame as well.
  els.casePanel.scrollTop = 0;
  requestAnimationFrame(() => {
    els.casePanel.scrollTop = 0;
  });
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
  setExport({
    title: country.name,
    detail: `Country average · ${country.stations} stations · ${country.continent}`,
    variable,
    trend,
    windowKey: state.windowKey,
    years: window.years,
    values: window.values,
  });

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

/* ------------------------------------------------------------------ ocean */

// An ocean region is a place, not a cloud of dots: no marker is drawn for it,
// the way no marker exists for a country average. The globe flies there, one
// ring pulses at the centroid, and the case panel carries the area mean.

async function selectOcean(region) {
  if (!region) return;
  clearRecommendation();
  await ensureGrid();
  state.selected = region;
  state.selectedKind = "ocean";
  state.variable = "GISTEMP";
  if (!region.trends?.GISTEMP?.[state.windowKey]) state.windowKey = state.meta.windows[0];
  state.layer = "ocean";
  document.body.classList.add("has-case");
  renderCase();
  refreshLayer();
  globe.pointOfView({ lat: region.lat, lng: region.lon, altitude: 2.4 }, 900);
  globe.controls().autoRotate = false;
  clearTimeout(autoRotateTimer);
  els.hint.textContent = `${region.name} · ${region.cells} ocean cells · sea surface temperature`;
}

function oceanNarrative(region, trend, windowKey) {
  if (!trend) {
    return `No complete sea surface temperature series is available for ${escapeHtml(
      region.name
    )} in the ${windowKey.replace("-", "–")} window.`;
  }
  const direction = trend.slope_per_decade >= 0 ? "rose" : "fell";
  const agreement = trend.exploratory
    ? `Only ${trend.n} annual means are available, so the result is labelled exploratory and no significance claim is made.`
    : trend.significant
      ? `Both the HAC slope test (p ${pText(trend.p_value)}) and the corrected Mann–Kendall test (p ${pText(
          trend.mk_p_corrected
        )}) pass at the 5% level and agree on direction.`
      : `The HAC slope test (p ${pText(trend.p_value)}) and the corrected Mann–Kendall test (p ${pText(
          trend.mk_p_corrected
        )}) do not both pass at the 5% level, so no trend is claimed.`;
  const family =
    region.family === "aggregate"
      ? ` This aggregate is the mean of every ocean cell and is deliberately outside the eight-basin correction, so it reports the HAC test only.`
      : trend.significant
        ? ` It survives the Benjamini–Hochberg correction across the eight basins (q = ${formatP(
            trend.q_value
          )}).`
        : ` It does not survive the correction across the eight basins (q = ${formatP(trend.q_value)}).`;
  return `Across <strong>${region.cells}</strong> GISTEMP ocean cells in ${escapeHtml(
    region.name
  )} (${escapeHtml(region.extent)}), annual sea surface temperature ${direction} by <strong>${signed(
    trend.slope_per_decade
  )} °C per decade</strong> over ${windowKey.replace(
    "-",
    "–"
  )} (95% CI ${signed(trend.ci_low_per_decade)} to ${signed(trend.ci_high_per_decade)}; n = ${trend.n}). ${agreement}${family} Each 4° cell counts in proportion to its area, because a cell near a pole covers less ground than one at the equator. These cells carry ERSST-based sea surface temperature, with land influence inside roughly 1,200 km of a coast. This is a trend detection, not an attribution.`;
}

function oceanFacts(region, trend, window) {
  const rows = [
    ["Cells averaged", region.cells.toLocaleString()],
    ["Extent", region.extent],
    ["Weighting", state.oceanMeta?.weighting || "cos(lat) area weight"],
    ["Series", `${state.windowKey.replace("-", "–")} · n = ${window.years.length}`],
  ];
  if (trend) {
    rows.push(["HAC p-value", formatP(trend.p_value)]);
    rows.push([
      "95% interval",
      `${signed(trend.ci_low_per_decade, 2)} to ${signed(trend.ci_high_per_decade, 2)}`,
    ]);
    if (Number.isFinite(trend.sen_slope_per_decade)) {
      rows.push(["Sen's slope", signed(trend.sen_slope_per_decade, 2)]);
    }
    if (Number.isFinite(trend.mk_p_corrected)) {
      rows.push(["MK p (Hamed–Rao)", formatP(trend.mk_p_corrected)]);
    }
    rows.push([
      region.family === "aggregate" ? "Correction" : "BH q (8 basins)",
      region.family === "aggregate" ? "outside the basin family" : formatP(trend.q_value),
    ]);
  }
  rows.push(["Variable", "Sea surface temperature (ERSST-based)"]);
  rows.push(["Source", "NASA GISTEMP v4 ocean cells · baseline 1951–1980"]);
  return rows.map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(String(value))}</dd>`).join("");
}

function renderOceanCase() {
  const region = state.selected;
  const base = state.byCode.get("GISTEMP") || state.variables.find((item) => item.code === "GISTEMP");
  const variable = oceanVariable(base);
  const trend = region.trends?.GISTEMP?.[state.windowKey] || null;
  const series = region.series?.GISTEMP || [];
  const years = state.oceanMeta?.years || state.meta.years;
  const window = seriesWindow(series, years, state.windowKey);
  const info = verdictInfo(trend, variable);
  const id = caseId(`ocean:${region.id}:${state.windowKey}`);
  setExport({
    title: region.name,
    detail: `Ocean region · ${region.cells} GISTEMP cells · ${region.extent}`,
    variable,
    trend,
    windowKey: state.windowKey,
    years: window.years,
    values: window.values,
  });
  const neighbours = state.ocean.filter((item) => item.id !== region.id && item.family === "basins").slice(0, 5);

  els.casePanel.innerHTML = `
    <div class="case-head">
      <div class="case-id">${id}</div>
      <button class="case-close" data-action="close-case" type="button">Close</button>
    </div>
    <h2 class="place-title">${escapeHtml(region.name)}</h2>
    <p class="place-sub">Ocean region · sea surface temperature · ${region.cells} GISTEMP cells</p>
    <p class="place-sub">${escapeHtml(region.extent)}</p>
    ${windowChips()}
    <p class="narrative">${oceanNarrative(region, trend, state.windowKey)}</p>
    ${verdictBlock(trend, variable, info)}
    ${caveatBlock(trend, variable, true)}
    <div class="chart" id="case-chart"></div>
    <dl class="facts">${oceanFacts(region, trend, window)}</dl>
    ${caseSources(null, variable)}
    <div class="case-cities">
      <div class="plan-cities-label">Compare a neighbouring basin</div>
      <div class="city-chips">${neighbours
        .map(
          (item) =>
            `<button class="chip chip-small" type="button" data-action="open-ocean" data-region-id="${escapeHtml(
              item.id
            )}">${escapeHtml(item.name)}</button>`
        )
        .join("")}</div>
    </div>
    ${workBlock("ocean")}
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

/* ---------------------------------------------------------------- sea ice */

// Sea ice is a hemisphere-scale record, not a place with a dot. Nothing is drawn
// on the cap for it: the case panel carries the number and the globe flies to
// the pole, the same way a country average flies without a marker.

async function selectSeaIce(record, code = "SEAICE") {
  if (!record) return;
  clearRecommendation();
  state.selected = record;
  state.selectedKind = "seaice";
  state.variable = "SEAICE";
  state.iceCode = record.trends?.[code] ? code : "SEAICE";
  if (!record.trends?.SEAICE?.[state.windowKey]) state.windowKey = state.meta.windows[0];
  state.layer = "cities";
  document.body.classList.add("has-case");
  renderCase();
  refreshLayer();
  globe.pointOfView({ lat: record.lat, lng: record.lon, altitude: 1.9 }, 900);
  globe.controls().autoRotate = false;
  clearTimeout(autoRotateTimer);
  els.hint.textContent = `${record.name} · ${seaIceVariable(
    state.iceCode
  ).label.toLowerCase()} · annual mean of 12 monthly values`;
}

function seaIceNarrative(record, trend, windowKey, variable) {
  if (!trend) {
    return `No complete sea ice series is available for ${escapeHtml(
      record.name
    )} in the ${windowKey.replace("-", "–")} window.`;
  }
  const measure = variable.code === "SEAICECONC" ? "mean concentration" : "extent";
  const direction = trend.slope_per_decade >= 0 ? "rose" : "fell";
  const tests = trend.exploratory
    ? `Only ${trend.n} annual means are available, so the result is labelled exploratory and no significance claim is made.`
    : trend.significant
      ? `Both the HAC slope test (p ${pText(trend.p_value)}) and the corrected Mann–Kendall test (p ${pText(
          trend.mk_p_corrected
        )}) pass at the 5% level and agree on direction.`
      : `The HAC slope test (p ${pText(trend.p_value)}) and the corrected Mann–Kendall test (p ${pText(
          trend.mk_p_corrected
        )}) do not both pass at the 5% level, so no trend is claimed.`;
  return `${escapeHtml(record.name)} ${measure} ${direction} by <strong>${signed(
    trend.slope_per_decade
  )} ${escapeHtml(variable.slope_units)} per decade</strong> over ${windowKey.replace("-", "–")} (95% CI ${signed(
    trend.ci_low_per_decade
  )} to ${signed(trend.ci_high_per_decade)}; n = ${trend.n}; HAC p ${pText(
    trend.p_value
  )}). ${tests} ${trend.significant
    ? `It survives the Benjamini–Hochberg correction across the three sea-ice records at q ${pText(trend.q_value)}.`
    : `Corrected across the three sea-ice records it keeps q ${pText(trend.q_value)}, above the 0.05 threshold.`} Each year is the mean of twelve monthly values, so the seasonal cycle — the September minimum and the March maximum — is averaged rather than shown. ${
    variable.code === "SEAICECONC"
      ? "Concentration is ice area ÷ extent: how much of the ice-covered area is actually ice, not how far the ice reaches, so it can rise while the extent falls."
      : "Extent counts every cell with at least 15% ice cover; it is not concentration, and it is not thickness."
  } This is a trend detection, not an attribution.`;
}

function seaIceFacts(record, trend, window, variable) {
  const rows = [
    ["Months averaged", "12 per year"],
    ["Record", `1979–present · window ${state.windowKey.replace("-", "–")}`],
    ["Series", `n = ${window.years.length} annual means`],
  ];
  if (trend) {
    rows.push(["HAC p-value", formatP(trend.p_value)]);
    rows.push([
      "95% interval",
      `${signed(trend.ci_low_per_decade, 2)} to ${signed(trend.ci_high_per_decade, 2)}`,
    ]);
    if (Number.isFinite(trend.sen_slope_per_decade)) {
      rows.push(["Sen's slope", signed(trend.sen_slope_per_decade, 2)]);
    }
    if (Number.isFinite(trend.mk_p_corrected)) {
      rows.push(["MK p (Hamed–Rao)", formatP(trend.mk_p_corrected)]);
    }
    rows.push(["BH q (3 records)", formatP(trend.q_value)]);
  }
  rows.push(["Measure", variable.code === "SEAICECONC" ? "100 × area ÷ extent" : "area with ≥15% ice cover"]);
  rows.push(["Variable", `${variable.label} (${variable.units})`]);
  rows.push(["Source", "NSIDC/NOAA Sea Ice Index G02135, via NOAA PSL"]);
  return rows.map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(String(value))}</dd>`).join("");
}

// Extent and concentration are one click apart, and the case always shows both
// verdicts: the pair is the point, so it must not depend on remembering to switch.
function measureSwitch(activeCode) {
  const options = [
    ["SEAICE", "Extent"],
    ["SEAICECONC", "Concentration"],
  ];
  return `<div class="var-chips measure-chips"><span class="chip-label">Measure</span>${options
    .map(
      ([code, label]) =>
        `<button class="var-chip ${code === activeCode ? "on" : ""}" type="button" data-action="select-ice-code" data-code="${code}">${label}</button>`
    )
    .join("")}</div>`;
}

function measureCompare(record) {
  const active = state.iceCode || "SEAICE";
  const rows = [
    ["SEAICE", "Extent"],
    ["SEAICECONC", "Concentration"],
  ]
    .map(([code, label]) => {
      const trend = record.trends?.[code]?.[state.windowKey];
      if (!trend) return "";
      const variable = seaIceVariable(code);
      const proven = trend.verdict !== "no significant trend";
      return `<button class="ice-measure ${code === active ? "on" : ""}" type="button" data-action="select-ice-code" data-code="${code}">
        <span class="ice-measure-name">${label}</span>
        <span class="ice-measure-rate">${signed(trend.slope_per_decade, 2)} <em>${escapeHtml(
          variable.slope_units
        )}/decade</em></span>
        <span class="ice-measure-word ${proven ? "cool" : "flat"}">${
          proven ? "Proven" : "Not proven"
        }</span>
      </button>`;
    })
    .join("");
  return `<div class="ice-measures">
    <div class="plan-cities-label">Both measures, ${state.windowKey.replace("-", "–")}</div>
    ${rows}
  </div>`;
}

function renderSeaIceCase() {
  const record = state.selected;
  const variable = seaIceVariable(state.iceCode || "SEAICE");
  const code = variable.code;
  const trend = record.trends?.[code]?.[state.windowKey] || null;
  const series = record.series?.[code] || [];
  const years = state.seaIceMeta?.years || state.meta.years;
  const window = seriesWindow(series, years, state.windowKey);
  const extentWindow = seriesWindow(record.series?.SEAICE || [], years, state.windowKey);
  const concWindow = seriesWindow(record.series?.SEAICECONC || [], years, state.windowKey);
  const info = verdictInfo(trend, variable);
  const id = caseId(`ice:${record.id}:${code}:${state.windowKey}`);
  setExport({
    title: record.name,
    detail: `${variable.label} · annual mean of 12 monthly values · ${variable.units}`,
    variable,
    trend,
    windowKey: state.windowKey,
    years: window.years,
    values: window.values,
  });
  const siblings = state.seaIce.filter((item) => item.id !== record.id);

  els.casePanel.innerHTML = `
    <div class="case-head">
      <div class="case-id">${id}</div>
      <button class="case-close" data-action="close-case" type="button">Close</button>
    </div>
    <h2 class="place-title">${escapeHtml(record.name)}</h2>
    <p class="place-sub">${escapeHtml(variable.label)} · annual mean of 12 monthly values · ${escapeHtml(
      variable.units
    )}</p>
    ${measureSwitch(code)}
    ${windowChips()}
    <p class="narrative">${seaIceNarrative(record, trend, state.windowKey, variable)}</p>
    ${verdictBlock(trend, variable, info)}
    ${caveatBlock(trend, variable, false)}
    <div class="chart" id="case-chart"></div>
    <div class="chart-legend">
      <span><i style="background:#4f93d6"></i>Extent</span>
      <span><i style="background:#c9a227"></i>Concentration</span>
      <span class="legend-note">both indexed to the window's first year = 100</span>
    </div>
    ${measureCompare(record)}
    <dl class="facts">${seaIceFacts(record, trend, window, variable)}</dl>
    ${caseSources(null, variable)}
    <div class="case-cities">
      <div class="plan-cities-label">Compare the other hemisphere</div>
      <div class="city-chips">${siblings
        .map(
          (item) =>
            `<button class="chip chip-small" type="button" data-action="open-seaice" data-ice-id="${escapeHtml(
              item.id
            )}">${escapeHtml(item.name)}</button>`
        )
        .join("")}</div>
    </div>
    ${workBlock("ice")}
  `;
  renderCompareChart(document.getElementById("case-chart"), {
    years: extentWindow.years,
    series: [
      { label: "Extent", values: extentWindow.values, color: "#4f93d6", active: code === "SEAICE" },
      {
        label: "Concentration",
        values: concWindow.values,
        color: "#c9a227",
        active: code === "SEAICECONC",
      },
    ],
    xLabel: state.windowKey.replace("-", "–"),
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
  setExport({
    title: point.name,
    detail: `${point.country} · ${lat} ${lon} · station ${point.id}`,
    variable,
    trend,
    windowKey: state.windowKey,
    years: window.years,
    values: window.values,
  });

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
  setExport({
    title: `Grid cell ${lat} ${lon}`,
    detail: `GISTEMP v4 · ${cell.is_ocean ? "ocean" : "land"} · baseline 1951–1980`,
    variable,
    trend,
    windowKey: state.windowKey,
    years: window.years,
    values: window.values,
  });

  els.casePanel.innerHTML = `
    <div class="case-head">
      <div class="case-id">${id}</div>
      <button class="case-close" data-action="close-case" type="button">Close</button>
    </div>
    <h2 class="place-title">Grid cell</h2>
    <p class="place-sub">${lat} &nbsp;${lon} · GISTEMP v4 · ${
      cell.is_ocean ? "ocean · sea surface temperature" : "land · surface air temperature"
    } · baseline 1951–1980</p>
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
  setExport({
    title: "Global mean",
    detail: `GISTEMP v4 · 4° grid · ${counts.cells.toLocaleString()} cells · baseline 1951–1980`,
    variable,
    trend,
    windowKey: state.windowKey,
    years: window.years,
    values: window.values,
  });

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
      variable.slope_units || variable.units
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
  const reading = liveFor(point);
  if (!reading) return "";
  const values = [];
  if (Number.isFinite(reading.t_2m)) values.push(`${reading.t_2m.toFixed(1)} °C now`);
  if (Number.isFinite(reading.precip_1h)) values.push(`${reading.precip_1h.toFixed(2)} mm/h`);
  if (Number.isFinite(reading.wind_speed_10m)) values.push(`${reading.wind_speed_10m.toFixed(1)} m/s`);
  if (!values.length) return "";
  const live = Boolean(reading.is_live);
  const observed = liveTimeLabel(reading.valid_time || reading.fetched_at, live);
  const title = live
    ? `Meteomatics current conditions, fetched ${liveTimeLabel(reading.fetched_at)}`
    : `Meteomatics snapshot from the last data build (${liveTimeLabel(
        reading.valid_time || reading.fetched_at
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
  if (liveFor(point)) bits.push("<b>Live:</b> Meteomatics");
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
        : kind === "ice"
          ? "The Sea Ice Index reports monthly extent and area per hemisphere. Extent is the area with at least 15% ice cover; concentration is 100 × area ÷ extent, the mean concentration of the ice-covered area. Each year is the mean of twelve monthly values, so the same trend code reads it as any other record — which hides the seasonal cycle. The family correction runs across the three records (two hemispheres and their sum), separately for each measure. No attribution is claimed."
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
  const chips = state.rag.examples
    .slice(0, 2)
    .map(
      (question) =>
        `<button class="chip" type="button" data-question="${escapeHtml(question)}">${escapeHtml(
          question
        )}</button>`
    );
  // The ocean is a place to ask about, never a cloud of dots: this opens a
  // basin case like any other question.
  chips.push(
    `<button class="chip chip-ocean" type="button" data-question="Is the Pacific warming?">Is the Pacific warming?</button>`
  );
  chips.push(
    `<button class="chip chip-ice" type="button" data-question="Is the Arctic sea ice shrinking?">Is the Arctic sea ice shrinking?</button>`
  );
  // The demo's twist, derived from the bundle so a rebuild cannot rot it: the
  // steepest featured case the statistics refuse to call, one click away.
  const herring = deriveSteepUnproven(state.points, state.meta.windows[0]);
  if (herring) {
    const units = state.byCode.get("T2M")?.units || "°C";
    chips.push(
      `<button class="chip chip-herring" type="button" data-open-point="${escapeHtml(
        herring.point.id
      )}" title="${escapeHtml(
        `${signed(herring.trend.slope_per_decade)} ${units} per decade, HAC p ${formatP(
          herring.trend.p_value
        )} — steep, but not proven`
      )}">Steep, but not proven · ${escapeHtml(herring.point.name)}</button>`
    );
  }
  els.suggestions.innerHTML = chips.join("");
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
      plan.kind === "country"
        ? ` · ${plan.place.stations} stations`
        : plan.kind === "ocean"
          ? ` · ${plan.place.cells} ocean cells`
          : plan.kind === "seaice"
            ? " · 12-month mean"
            : ""
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

async function handleAsk(question) {
  // A country name needs the country averages, which are not on the critical
  // path; this is the only place they enter memory.
  await Promise.all([ensureCountries(), ensureOcean(), ensureSeaIce()]);
  const plan = planCase(question, {
    rag: state.rag,
    points: state.points,
    variables: state.variables,
    countries: state.countries,
    ocean: state.ocean,
    seaIce: state.seaIce,
  });
  state.plan = plan;
  renderPlan(plan);
  // On a phone the intake panel scrolls; bring the plan's buttons into view.
  if (plan) els.plan.scrollIntoView({ block: "nearest" });
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

async function runPlan() {
  const plan = state.plan;
  if (!plan) return;
  state.windowKey = plan.windowKey;
  if (plan.kind === "seaice") {
    await selectSeaIce(plan.place, plan.variable.code);
    showToast(`Case opened: sea ice extent · ${plan.place.name}`);
    return;
  }
  if (plan.kind === "ocean") {
    await selectOcean(plan.place);
    showToast(`Case opened: ocean · ${plan.place.name} · ${plan.place.cells} cells`);
    return;
  }
  if (plan.kind === "country") {
    selectCountry(plan.place);
    showToast(`Case opened: ${plan.variable.short} · ${plan.place.name} average`);
    return;
  }
  if (plan.place.global) {
    await selectGlobal(plan.windowKey);
  } else {
    const point = state.byId.get(plan.place.id);
    if (!point) return;
    state.variable = plan.variable.code === "GISTEMP" ? "T2M" : plan.variable.code;
    selectPoint(point);
  }
  showToast(`Case opened: ${plan.variable.short} · ${plan.place.name}`);
}

/* ------------------------------------------------------------------- live */

// The proxy spends a metered upstream quota: asking for every station cost 29
// Meteomatics queries per hour (25 coordinates each) against a ~1,000/day
// allowance, and shipped 708 readings to every visitor. A reading is now asked
// for one open case at a time, and only while that case is on screen.
function startLiveRefresh() {
  setInterval(() => {
    if (document.hidden) return;
    if (state.selectedKind !== "city" || !state.selected) return;
    refreshLiveForCase(state.selected, { force: true });
  }, LIVE_REFRESH_MS);
}

async function refreshLiveForCase(point, { force = false } = {}) {
  if (!point?.id) return;
  const cached = liveReadings.get(point.id);
  if (cached && !force && Date.now() - cached.fetchedAt < LIVE_REFRESH_MS) return;
  try {
    const response = await fetch(assetUrl(`/api/live?ids=${encodeURIComponent(point.id)}`), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.debug(`Live readings unavailable (HTTP ${response.status}); using the build snapshot.`);
      }
      return;
    }
    const payload = await response.json();
    const reading = payload?.points?.[point.id];
    if (!payload?.ok || !reading || !Number.isFinite(reading.t_2m)) return;
    liveReadings.set(point.id, {
      t_2m: reading.t_2m,
      precip_1h: reading.precip_1h,
      wind_speed_10m: reading.wind_speed_10m,
      valid_time: reading.valid_time || payload.valid_time,
      fetched_at: payload.fetched_at,
      is_live: true,
      source: "Meteomatics",
      fetchedAt: Date.now(),
    });
    if (state.selectedKind === "city" && state.selected?.id === point.id) refreshLiveChip();
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
  if (variable.code === "SEAICE") {
    return increasing ? "Significant advance" : "Significant decline";
  }
  if (variable.code === "SEAICECONC") {
    return increasing ? "Significant concentration rise" : "Significant concentration fall";
  }
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
  // The source chips sit behind a disclosure so the top bar stays quiet. A
  // click outside it or Escape closes the panel, including on the globe.
  const sourceMenu = document.getElementById("source-menu");
  if (sourceMenu) {
    document.addEventListener("click", (event) => {
      if (sourceMenu.open && !sourceMenu.contains(event.target)) sourceMenu.open = false;
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !sourceMenu.open) return;
      sourceMenu.open = false;
      sourceMenu.querySelector("summary")?.focus();
    });
  }

  els.askForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleAsk(els.askInput.value);
  });

  els.suggestions.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-question]");
    if (chip) {
      els.askInput.value = chip.dataset.question;
      handleAsk(chip.dataset.question);
      return;
    }
    const opener = event.target.closest("[data-open-point]");
    if (!opener) return;
    const point = state.byId.get(opener.dataset.openPoint);
    if (!point) return;
    state.variable = "T2M";
    selectPoint(point);
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
    if (name === "open-ocean") {
      const region = state.oceanById.get(action.dataset.regionId);
      if (region) selectOcean(region);
      return;
    }
    if (name === "export-series" || name === "export-report") {
      const data = state.exportData;
      if (!data) return;
      const slug = caseSlug(data);
      if (name === "export-series") {
        downloadCsv(`${slug}-series.csv`, toCsv(seriesRows(data.years, data.values, data.trend)));
        showToast(`Exported ${data.years.length} annual means as CSV`);
      } else {
        downloadCsv(`${slug}-statistics.csv`, toCsv(reportRows(data)));
        showToast("Exported the statistics as CSV");
      }
      return;
    }
    if (name === "open-seaice") {
      const record = state.seaIceById.get(action.dataset.iceId);
      if (record) selectSeaIce(record, state.iceCode || "SEAICE");
      return;
    }
    if (name === "select-ice-code") {
      if (action.dataset.code === "SEAICE" || action.dataset.code === "SEAICECONC") {
        state.iceCode = action.dataset.code;
        renderSeaIceCase();
      }
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
    button.addEventListener("click", async () => {
      state.layer = button.dataset.layer;
      if (state.layer === "field" || state.layer === "ocean") await ensureGrid();
      refreshLayer();
      showToast(
        state.layer === "ocean"
          ? `Ocean field: ${state.gridPoints
              .filter((cell) => cell.is_ocean)
              .length.toLocaleString()} ocean cells · sea surface temperature`
          : state.layer === "field"
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
