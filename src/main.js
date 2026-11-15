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
import { renderCompareChart, renderSeriesChart, renderTrendChart, trendColor, trendPalette } from "./chart.js";
import {
  MAX_STARS,
  compareRows,
  isStarred,
  loadStars,
  saveStars,
  sectionsFor,
  starKey,
  starsToCsv,
  toggleStar,
  variablesAcross,
} from "./stars.js";
import { caseSlug, downloadCsv, reportRows, seriesRows, toCsv } from "./export.js";
import { SOURCE_LINKS } from "./sources.js";
import { formatLatLon, haversineKm, nearestCell, nearestRecord } from "./geo.js";
import { describeFailure, derivedPlan, isResolvablePlan, resolveQuestion } from "./field.js";
import { dehydrate, detailPath, hydrate, trendOf } from "./bundle.js";

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
  // Every ask gets a sequence number so a slow resolver cannot overwrite the
  // plan for a question the reader has already replaced.
  askSeq: 0,
  // Detail shards already merged into state.points, newest first. The cap keeps
  // a browsing session at a few hundred kB rather than the whole 5.8 MB record
  // set. A shard holds roughly 44 stations.
  detailShards: new Map(),
  detailOrder: [],
  // Saved places, the only state that outlives the page. `starTarget` is what the
  // star in the current case head would toggle; `starRecords` holds the station
  // trend records fetched for the comparison's intervals.
  stars: [],
  starsUnstored: false,
  starTarget: null,
  // Normalised series and trends per saved place, once the charts ask for them.
  starSeries: new Map(),
  compareVariable: null,
  // The comparison keeps its own window, so changing it here never moves the case
  // the reader left open behind the dialog.
  compareWindow: null,
  compareLoading: false,
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
  methodDialog: document.getElementById("method-dialog"),
  methodBtn: document.getElementById("method-btn"),
  globalBtn: document.getElementById("global-btn"),
  closeMethod: document.getElementById("close-method"),
  methodDone: document.getElementById("method-done"),
  recommendation: document.getElementById("recommendation"),
  oceanLegend: document.getElementById("ocean-legend"),
  starsBtn: document.getElementById("stars-btn"),
  starsCount: document.getElementById("stars-count"),
  compareDialog: document.getElementById("compare-dialog"),
  compareBody: document.getElementById("compare-body"),
  compareNote: document.getElementById("compare-note"),
  closeCompare: document.getElementById("close-compare"),
  compareDone: document.getElementById("compare-done"),
  compareCsv: document.getElementById("compare-csv"),
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
    loadSavedStars();

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

// The station index carries identity and a verdict summary; the full trend
// records and annual series are fetched with the station's shard, once, when a
// case is opened. A shard is merged in place, so every reader of a point keeps
// working unchanged, and is dropped again when the cache turns over.
const DETAIL_CACHE_LIMIT = 3;

function touchDetailShard(path) {
  state.detailOrder = [path, ...state.detailOrder.filter((item) => item !== path)];
  const keep = new Set(state.detailOrder.slice(0, DETAIL_CACHE_LIMIT));
  const openPath = state.selected?.id ? detailPath(state.selected.id, state.meta) : "";
  if (openPath) keep.add(openPath);
  for (const loaded of [...state.detailShards.keys()]) {
    if (keep.has(loaded)) continue;
    dehydrate(state.detailShards.get(loaded));
    state.detailShards.delete(loaded);
    state.detailPromises.delete(loaded);
  }
  // The order list is bookkeeping only; keep it as small as the cache.
  state.detailOrder = state.detailOrder.filter((item) => keep.has(item));
}

async function ensurePointDetail(point) {
  if (!point?.id) return point;
  if (point.trends || point.isGrid) return point;
  const path = detailPath(point.id, state.meta);
  if (!path) return point;
  if (!state.detailShards.has(path)) {
    if (!state.detailPromises) state.detailPromises = new Map();
    let promise = state.detailPromises.get(path);
    if (!promise) {
      promise = loadJson(assetUrl(path)).catch((error) => {
        state.detailPromises.delete(path);
        throw error;
      });
      state.detailPromises.set(path, promise);
    }
    const block = await promise;
    if (!state.detailShards.has(path)) state.detailShards.set(path, hydrate(state.points, block));
  }
  touchDetailShard(path);
  return point;
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
  globe.controls().autoRotateSpeed = 0.18;
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
  // three-globe builds its globe layer on the first frame, so the patch has to
  // wait for it; it is idempotent and re-tries until it lands.
  requestAnimationFrame(() => cheapGlobePicking());
  if (typeof globe.onGlobeReady === "function") globe.onGlobeReady(() => cheapGlobePicking());
}

/* Picking the globe is the app's hottest pointer path: every move asks
   three-globe for the coordinates under the cursor, and the mesh it hits is a
   7,920-triangle sphere sitting behind a 32,040-triangle starfield and a
   7,920-triangle atmosphere, all of which get tested too, about 21 ms per move,
   which is what made the globe stutter under the cursor on a machine that
   otherwise drew it at 60 fps. The starfield, the atmosphere and the graticules
   cannot be picked at all, and the sphere answers analytically instead of a
   triangle at a time, for the same coordinates to within a rounding step. */
const globePickPoint = new Vector3();
let pickingPatched = false;

function cheapGlobePicking() {
  if (pickingPatched || !globe) return;
  let globeObject = null;
  globe.scene().traverse((object) => {
    if (object.__globeObjType === "globe") globeObject = object;
  });
  if (!globeObject) return;

  // The layer beside the globe holds only decoration: stars, atmosphere, graticules.
  const layer = globeObject.parent;
  for (const child of layer.children) {
    if (child === globeObject) continue;
    child.traverse((object) => {
      if (object.isMesh || object.isLine || object.isLineSegments) object.raycast = () => {};
    });
  }

  let sphereMesh = null;
  globeObject.traverse((object) => {
    if (object.isMesh && object.geometry) sphereMesh = object;
  });
  if (!sphereMesh) return;

  const geometry = sphereMesh.geometry;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const localSphere = geometry.boundingSphere.clone();
  const inverse = new Matrix4();

  sphereMesh.raycast = function raycastSphere(raycaster, intersects) {
    inverse.copy(this.matrixWorld).invert();
    const ray = raycaster.ray.clone().applyMatrix4(inverse);
    const hit = ray.intersectSphere(localSphere, globePickPoint);
    if (!hit) return;
    hit.applyMatrix4(this.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(hit);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({ distance, point: hit.clone(), object: this });
  };

  pickingPatched = true;
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
  const trend = trendOf(point, state.variable, state.windowKey);
  return trendColor(trend);
}

/* Each station keeps a faint halo: the "imaginary" area around the dot. When
   the cursor is anywhere inside that area the dot grows and the halo lights up,
   and a click there opens the case.

   Drawn as one mesh per station, the 708 halos and the 286 country outlines were
   ~3,000 of the frame's 3,552 draw calls, and the globe sat at 15 fps for it.
   Both are now a single object each, the halos an InstancedMesh, the borders one
   LineSegments, which is the same picture for four calls. three-globe keeps each
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
// per country were fully transparent, they existed only to carry the stroke.
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
      showToast("Land, the Ocean layer only shows water. Switch to Cities to ask about a station.");
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
  const trend = trendOf(point, state.variable, state.windowKey);
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

async function selectPoint(point, options = {}) {
  if (!point) return;
  try {
    await ensurePointDetail(point);
  } catch (error) {
    showToast("That station's record did not load. Check the connection and try again.");
    return;
  }
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
}

/* ------------------------------------------------------ derived field case */

// A place the bundle does not hold still has a coordinate. The resolver turns
// the name into one, and the case is the nearest GISTEMP cell to it, the same
// field, the same stored statistics, the same verdict contract. Nothing is
// invented: the case says which cell it borrowed and how far away it is.
const DERIVED_STATION_CHIP_KM = 400;

async function selectDerived(place, resolution = null) {
  if (!place) return;
  clearRecommendation();
  await ensureGrid();
  const near = nearestCell(place.lat, place.lon, state.gridPoints);
  if (!near) {
    showToast("No GISTEMP cell covers that coordinate.");
    return;
  }
  const station = nearestRecord(place.lat, place.lon, state.points);
  state.selected = {
    ...near.cell,
    derived: true,
    place,
    distanceKm: near.km,
    station: station
      ? { id: station.point.id, name: station.point.name, km: station.km, direction: station.direction }
      : null,
    resolution,
  };
  state.selectedKind = "derived";
  state.variable = "GISTEMP";
  state.layer = "field";
  if (!state.selected.trends?.[state.windowKey]) state.windowKey = state.meta.windows[0];
  document.body.classList.add("has-case");
  renderCase();
  refreshLayer();
  globe.pointOfView({ lat: place.lat, lng: place.lon, altitude: 1.55 }, 900);
  globe.controls().autoRotate = false;
  clearTimeout(autoRotateTimer);
}

function clearCase() {
  state.selected = null;
  state.selectedKind = null;
  state.exportData = null;
  document.body.classList.remove("has-case");
  renderEmptyCase();
  refreshLayer();
  globe.controls().autoRotate = true;
}

/* ------------------------------------------------------------ saved places */

// The app keeps nothing between visits except this. `stars.js` owns the rules
// (the cap, duplicates, a corrupt stored value); the functions below only decide
// where a star appears and what the comparison says. Starring is deliberately
// quiet: it paints one button and raises a toast, and never re-renders the case,
// moves the camera or opens the comparison by itself.

let starStorage = null;
let starStorageProbed = false;

function starsStorage() {
  if (starStorageProbed) return starStorage;
  starStorageProbed = true;
  try {
    // A probe, because reading the property succeeds in some browsers that then
    // refuse every write.
    const probe = "signal-noise:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    starStorage = window.localStorage;
  } catch {
    starStorage = null;
  }
  return starStorage;
}

function loadSavedStars() {
  const saved = loadStars(starsStorage());
  state.stars = saved.stars;
  state.starsUnstored = saved.unavailable === true;
  if (saved.repaired && saved.stars.length) {
    showToast("A saved place could not be read and was set aside.");
  }
  refreshStarsButton();
}

function persistStars() {
  if (state.starsUnstored) return;
  if (saveStars(starsStorage(), state.stars)) return;
  // Storage is full or blocked. The stars stay for this visit; say so once.
  state.starsUnstored = true;
}

// What the star would save for the case that is open. Global and derived cases
// have no star: one is not a place, the other borrows the nearest grid cell.
function starTarget() {
  const record = state.selected;
  const kind = state.selectedKind;
  if (!record) return null;

  // A grid cell and a searched place borrow the same field, so both save as one
  // "point": the cell's own identity, named by whatever the reader was looking at.
  if (kind === "grid" || kind === "derived") {
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return null;
    const name = kind === "derived" ? record.place?.name || record.name : record.name;
    return {
      kind: "point",
      id: `grid:${record.lat}:${record.lon}`,
      name,
      country: record.place?.country || null,
      lat: record.lat,
      lon: record.lon,
      savedAt: new Date().toISOString(),
    };
  }

  if (!["city", "country", "ocean", "seaice"].includes(kind)) return null;
  if (!record.id || !record.name) return null;
  return {
    kind,
    id: record.id,
    name: record.name,
    country: kind === "city" ? record.country || null : null,
    lat: Number.isFinite(record.lat) ? record.lat : null,
    lon: Number.isFinite(record.lon) ? record.lon : null,
    savedAt: new Date().toISOString(),
  };
}

function starLabel(star, on) {
  return on ? `Remove ${star.name} from saved places` : `Save ${star.name} to compare`;
}

// Rendered inside the case head, beside Close, so starring adds no chrome and
// cannot shift the panel. The header is redrawn with every case, so the button is
// a paint of state rather than a second source of truth.
function starButton() {
  const star = starTarget();
  state.starTarget = star;
  if (!star) return "";
  const on = isStarred(state.stars, star.kind, star.id);
  const label = escapeHtml(starLabel(star, on));
  return `<button class="case-star${on ? " on" : ""}" type="button" data-action="toggle-star" aria-pressed="${on}" aria-label="${label}" title="${label}"><span aria-hidden="true">${
    on ? "\u2605" : "\u2606"
  }</span></button>`;
}

function refreshStarsButton() {
  if (!els.starsBtn) return;
  const count = state.stars.length;
  // No stars, no button: a reader who never uses this sees no new top-bar chrome.
  els.starsBtn.hidden = count === 0;
  if (els.starsCount) els.starsCount.textContent = String(count);
  els.starsBtn.setAttribute(
    "aria-label",
    `${count} saved place${count === 1 ? "" : "s"}, compare them`
  );
}

function toggleStarForCase() {
  const star = state.starTarget;
  if (!star) return;
  const result = toggleStar(state.stars, star);
  if (result.changed === "full") {
    showToast(`Saved places hold ${MAX_STARS}. Remove one to add ${star.name}.`);
    return;
  }
  if (result.changed === "invalid") return;
  state.stars = result.stars;
  persistStars();
  refreshStarsButton();

  // Repaint the one button rather than re-rendering the case, so a star can never
  // scroll the reader's case panel back to the top.
  const on = result.changed === "added";
  const button = els.casePanel.querySelector('[data-action="toggle-star"]');
  if (button) {
    const label = starLabel(star, on);
    button.setAttribute("aria-pressed", String(on));
    button.classList.toggle("on", on);
    button.setAttribute("aria-label", label);
    button.title = label;
    const glyph = button.querySelector("span");
    if (glyph) glyph.textContent = on ? "\u2605" : "\u2606";
  }

  if (!on) {
    showToast(`Removed ${star.name} from saved places`);
    return;
  }
  if (state.starsUnstored) {
    showToast(`Saved ${star.name} for this visit only`);
    return;
  }
  const count = state.stars.length;
  showToast(`Saved ${star.name} · ${count} place${count === 1 ? "" : "s"}`);
}

// The record behind a star: the station index, a loaded bundle, or the station's
// shard record once the reader asks for its interval.
// One record per saved place: the annual series and the stored trends, normalised
// to the same shape whatever bundle it came from. The comparison reads only this, so
// it never has to know which dataset a place belongs to.
function starSeriesRecord(star) {
  if (star.kind === "country") {
    const country = state.countriesById.get(star.id);
    if (!country) return null;
    return { years: state.meta.years, series: country.series || {}, trends: country.trends || {} };
  }
  if (star.kind === "ocean") {
    const region = state.oceanById.get(star.id);
    if (!region) return null;
    return {
      years: state.oceanMeta?.years || state.meta.years,
      series: region.series || {},
      trends: region.trends || {},
    };
  }
  if (star.kind === "seaice") {
    const record = state.seaIceById.get(star.id);
    if (!record) return null;
    return {
      years: state.seaIceMeta?.years || state.meta.years,
      series: record.series || {},
      trends: record.trends || {},
    };
  }
  if (star.kind === "point") {
    const cell = state.gridPoints.find((entry) => entry.id === star.id);
    if (!cell) return null;
    // A grid cell carries one field, so its trends are keyed by window rather than
    // by variable. They are lifted into the same shape the rest of the dialog reads.
    const trends = {};
    for (const [code, byWindow] of Object.entries(cell.trends || {})) {
      trends[code] = Object.fromEntries(
        Object.entries(byWindow || {}).map(([windowKey, trend]) => [windowKey, normalizeGridTrend(trend)])
      );
    }
    return { years: state.grid?.meta?.years || [], series: { GISTEMP: cell.values }, trends };
  }
  return null;
}

/**
 * Load what the charts need. Stations live in detail shards, so each distinct
 * shard is fetched once and every saved station in it is taken from that one
 * response; the other bundles are already cached by the app. A failure leaves a
 * place with rows and no line rather than an empty dialog.
 */
async function loadStarSeries() {
  const missing = state.stars.filter((star) => !state.starSeries.has(starKey(star)));
  if (!missing.length) return;

  const kinds = new Set(missing.map((star) => star.kind));
  const jobs = [];
  if (kinds.has("country")) jobs.push(ensureCountries());
  if (kinds.has("ocean")) jobs.push(ensureOcean());
  if (kinds.has("seaice")) jobs.push(ensureSeaIce());
  if (kinds.has("point")) jobs.push(ensureGrid());
  await Promise.allSettled(jobs);

  const shards = new Map();
  for (const star of missing.filter((entry) => entry.kind === "city")) {
    const path = detailPath(star.id, state.meta);
    if (!path) continue;
    if (!shards.has(path)) shards.set(path, []);
    shards.get(path).push(star);
  }
  for (const [path, stars] of shards) {
    try {
      const block = await loadJson(assetUrl(path));
      for (const star of stars) {
        const detail = block?.points?.[star.id];
        if (!detail) continue;
        state.starSeries.set(starKey(star), {
          years: state.meta.years,
          series: detail.series || {},
          trends: detail.trends || {},
        });
      }
    } catch {
      // Offline or a slow shard: the place keeps its row and loses only its line.
    }
  }

  for (const star of missing.filter((entry) => entry.kind !== "city")) {
    if (state.starSeries.has(starKey(star))) continue;
    const record = starSeriesRecord(star);
    if (record) state.starSeries.set(starKey(star), record);
  }
}

const KIND_LABEL = {
  city: "Station",
  country: "Country average",
  point: "Grid point",
  ocean: "Ocean region",
  seaice: "Sea ice record",
};

// Distinct from the case file's `signed()`: a missing number must leave the cell
// empty here, because "no interval" and "an interval around zero" are not the same
// claim and the table has a column for each.
function signedValue(value, digits = 2) {
  if (!Number.isFinite(value)) return "";
  const magnitude = Math.abs(value).toFixed(digits);
  return `${value < 0 ? "\u2212" : "+"}${magnitude}`;
}

const VERDICT_TONE = {
  "significant increasing": "warm",
  "significant decreasing": "cool",
  "no significant trend": "flat",
};

function verdictTone(row) {
  if (row.exploratory) return "explore";
  return VERDICT_TONE[row.verdict] || "flat";
}

function verdictWord(row) {
  if (row.missing) return "no record";
  if (row.exploratory) return "exploratory";
  return row.verdict || "no verdict";
}

// A verdict is a dot and a word here, not a filled block: the same language the
// globe legend already uses.
function verdictPill(row) {
  return `<span class="compare-verdict"><span class="compare-dot ${verdictTone(row)}"></span>${escapeHtml(
    verdictWord(row)
  )}</span>`;
}

function compareRow(row, color, variable) {
  const kind = KIND_LABEL[row.kind] || row.kind;
  const sub = [kind, row.country].filter(Boolean).join(" · ");
  const shared = row.sharesCell
    ? `<span class="compare-shared" title="Shares a NASA POWER cell with another saved place">same cell</span>`
    : "";
  const key = escapeHtml(row.key);

  const bits = [];
  if (row.hasInterval) bits.push(`${signedValue(row.low)} to ${signedValue(row.high)}`);
  else if (!row.missing) bits.push("interval in case file");
  if (row.n !== null) bits.push(`n ${row.n}`);
  if (row.delta) bits.push(`Δ ${signedValue(row.delta)} vs first here`);

  const label = String(variable || "record").toLowerCase();
  const rate = row.missing
    ? `<span class="compare-absent">no ${escapeHtml(label)} record</span>`
    : signedValue(row.slope);

  return `<tr data-key="${key}"${row.missing ? ' class="is-missing"' : ""}>
      <th scope="row">
        <span class="compare-place"><span class="compare-swatch" style="background:${color}"></span>${escapeHtml(
          row.name
        )}</span>
        <span class="compare-kind">${escapeHtml(sub)}</span>
      </th>
      <td class="num compare-rate">
        <span class="compare-slope">${rate}</span>
        ${
          bits.length
            ? `<span class="compare-sub" title="95% interval for this slope, sample size, difference from the first place in this section">${escapeHtml(
                bits.join(" · ")
              )}</span>`
            : ""
        }
      </td>
      <td class="compare-verdict-cell">${verdictPill(row)}${shared}</td>
      <td class="actions">
        <button class="row-open" type="button" data-action="open-saved" data-key="${key}">Open</button>
        <button class="row-remove" type="button" data-action="remove-saved" data-key="${key}" aria-label="${escapeHtml(
          `Remove ${row.name} from saved places`
        )}">×</button>
      </td>
    </tr>`;
}

function compareVariableButtons(available, active) {
  if (!available.length) return "";
  return `<div class="compare-vars" role="group" aria-label="Variable to compare">${available
    .map(
      (variable) =>
        `<button class="compare-var${variable.code === active ? " on" : ""}" type="button" data-action="compare-variable" data-code="${escapeHtml(
          variable.code
        )}" aria-pressed="${variable.code === active}">${escapeHtml(
          variable.short || variable.label || variable.code
        )}<span>${variable.places}</span></button>`
    )
    .join("")}</div>`;
}

function compareSectionsHtml(sections, colors) {
  return sections
    .map((section) => {
      const chart = state.compareLoading
        ? `<p class="compare-hint compare-loading">Loading annual series…</p>`
        : section.lines.length
          ? `<figure class="compare-figure"><div class="compare-chart" id="compare-chart-${section.kind}"></div></figure>`
          : `<p class="compare-hint compare-nochart">Nothing to draw here: none of these places has a ${escapeHtml(
              String(section.variable || "").toLowerCase()
            )} series.</p>`;
      return `<section class="compare-section">
        <header class="compare-section-head">
          <h3>${escapeHtml(section.label)}</h3>
          <span>${section.rows.length} place${section.rows.length === 1 ? "" : "s"}</span>
        </header>
        ${chart}
        <table class="compare-table">
          <caption class="sr-only">${escapeHtml(section.label)}: slopes for ${escapeHtml(
            section.variable || ""
          )}, one row per saved place</caption>
          <thead>
            <tr>
              <th scope="col">Place</th>
              <th scope="col" class="num">Per decade${section.units ? ` (${escapeHtml(section.units)})` : ""}</th>
              <th scope="col">Verdict</th>
              <th scope="col" class="actions"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>${section.rows
            .map((row) => compareRow(row, trendPalette(colors.get(row.key) ?? 0), section.variable))
            .join("")}</tbody>
        </table>
      </section>`;
    })
    .join("");
}

// The same three windows a case offers, re-cutting only the dialog.
function compareWindowChips() {
  const active = compareWindow();
  return `<div class="window-row compare-window-row"><span class="chip-label">Window</span><div class="var-chips">${(
    state.meta?.windows || []
  )
    .map(
      (key) =>
        `<button class="var-chip${key === active ? " on" : ""}" type="button" data-action="compare-window" data-window="${escapeHtml(
          key
        )}" aria-pressed="${key === active}">${key.replace("-", "–")}</button>`
    )
    .join("")}</div></div>`;
}

function compareAddHtml() {
  return `<div class="compare-add">
    <label class="sr-only" for="compare-add-input">Add a place to compare</label>
    <input id="compare-add-input" type="search" autocomplete="off" spellcheck="false"
      placeholder="Add a station, country, ocean or sea-ice record" />
    <div class="compare-add-results" id="compare-add-results" hidden></div>
  </div>`;
}

/* ------------------------------------------------------- adding a place */

// The picker searches what the app already holds. Stations are in memory from the
// first byte of the index; the other three bundles are small and load once, on the
// first time the picker is used.
let comparePool = null;
let comparePoolReady = false;

// Countries, ocean regions and sea-ice records are three small bundles the picker
// needs before it can match anything, so they are fetched together the first time
// the field is used, not when the dialog opens.
async function ensureComparePool() {
  if (comparePoolReady) return;
  await Promise.allSettled([ensureCountries(), ensureOcean(), ensureSeaIce()]);
  comparePool = null;
  comparePoolReady = true;
}

function compareCandidates() {
  if (comparePool) return comparePool;
  const pool = [];
  for (const point of state.points) {
    pool.push({ kind: "city", id: point.id, name: point.name, country: point.country, lat: point.lat, lon: point.lon, label: "Station" });
  }
  for (const country of state.countries) {
    pool.push({ kind: "country", id: country.id, name: country.name, country: country.continent, lat: country.lat, lon: country.lon, label: "Country" });
  }
  for (const region of state.ocean) {
    pool.push({ kind: "ocean", id: region.id, name: region.name, country: "", lat: region.lat, lon: region.lon, label: "Ocean" });
  }
  for (const record of state.seaIce) {
    pool.push({ kind: "seaice", id: record.id, name: record.name, country: "", lat: record.lat, lon: record.lon, label: "Sea ice" });
  }
  comparePool = pool;
  return pool;
}

function renderCompareCandidates(query) {
  const box = document.getElementById("compare-add-results");
  if (!box) return;
  const text = String(query || "").trim().toLowerCase();
  if (text.length < 2) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  // The bundles arrive after the first keystroke, so opening the dialog stays as
  // cheap as it was; whatever is already loaded is matched straight away.
  if (!comparePoolReady) {
    ensureComparePool().then(() => {
      const input = document.getElementById("compare-add-input");
      if (input && input.value.trim().length >= 2) renderCompareCandidates(input.value);
    });
  }
  const saved = new Set(state.stars.map(starKey));
  // Rank by how the name matched, so "arctic" puts the Arctic records above the
  // eight Antarctic research stations that merely contain the word.
  const rank = (place) => {
    const name = place.name.toLowerCase();
    if (name.startsWith(text)) return 0;
    if (name.includes(text)) return 1;
    return 2;
  };
  const matches = compareCandidates()
    .filter((place) => !saved.has(`${place.kind}:${place.id}`))
    .filter(
      (place) =>
        place.name.toLowerCase().includes(text) || (place.country || "").toLowerCase().includes(text)
    )
    .sort((left, right) => rank(left) - rank(right) || left.name.length - right.name.length)
    .slice(0, 8);
  box.hidden = false;
  box.innerHTML = matches.length
    ? matches
        .map(
          (place) =>
            `<button class="compare-candidate" type="button" data-action="add-saved" data-kind="${place.kind}" data-id="${escapeHtml(
              place.id
            )}" data-name="${escapeHtml(place.name)}" data-country="${escapeHtml(
              place.country || ""
            )}" data-lat="${Number(place.lat)}" data-lon="${Number(place.lon)}"><span>${escapeHtml(
              place.name
            )}</span><em>${escapeHtml(place.label)}${
              place.country ? ` · ${escapeHtml(place.country)}` : ""
            }</em></button>`
        )
        .join("")
    : `<p class="compare-candidate-empty">No place matches that name.</p>`;
}

function addSavedPlace(dataset) {
  if (!dataset?.kind || !dataset?.id) return;
  const star = {
    kind: dataset.kind,
    id: dataset.id,
    name: dataset.name,
    country: dataset.country || null,
    lat: Number(dataset.lat),
    lon: Number(dataset.lon),
    savedAt: new Date().toISOString(),
  };
  const result = toggleStar(state.stars, star);
  if (result.changed === "full") {
    showToast(`Saved places hold ${MAX_STARS}. Remove one to add ${star.name}.`);
    return;
  }
  if (result.changed !== "added") return;
  state.stars = result.stars;
  persistStars();
  refreshStarsButton();
  showToast(`Saved ${star.name} · ${state.stars.length} place${state.stars.length === 1 ? "" : "s"}`);
  loadStarSeries().then(() => {
    renderCompare();
    document.getElementById("compare-add-input")?.focus();
  });
}

/* ---------------------------------------------------------------- hover */

// Hovering a place dims the others, in its chart and in every row. The state lives
// in classes rather than CSS keyed on a data attribute, so any number of keys can
// be dimmed without generating a selector per place.
function setCompareFocus(key) {
  if (!els.compareBody) return;
  for (const element of els.compareBody.querySelectorAll("[data-key]")) {
    const active = key !== null && element.dataset.key === key;
    element.classList.toggle("is-focus", active);
    element.classList.toggle("is-dim", key !== null && !active);
  }
}

/* ------------------------------------------------------------- rendering */

function compareWindow() {
  const windows = state.meta?.windows || [];
  if (state.compareWindow && windows.includes(state.compareWindow)) return state.compareWindow;
  return state.windowKey;
}

function activeCompareVariable(available) {
  if (!available.length) return null;
  if (available.some((variable) => variable.code === state.compareVariable)) return state.compareVariable;
  if (available.some((variable) => variable.code === state.variable)) return state.variable;
  return available[0].code;
}

// Sea ice rides on the same records as stations but is not one of the app's
// station variables, so its two measures are described here or a section would
// fall back to printing "SEAICE".
function compareVariableList() {
  const list = [...state.variables];
  for (const code of ["SEAICE", "SEAICECONC"]) {
    if (!list.some((entry) => entry.code === code)) list.push(seaIceVariable(code));
  }
  return list;
}

function renderCompare() {
  if (!els.compareBody) return;
  const records = new Map(
    state.stars.map((star) => [starKey(star), state.starSeries.get(starKey(star)) || null])
  );
  const variables = compareVariableList();
  const available = variablesAcross([...records.values()].filter(Boolean), variables);
  const code = activeCompareVariable(available);
  state.compareVariable = code;
  const windowKey = compareWindow();
  const sections = code
    ? sectionsFor(state.stars, records, { code, windowKey, variables })
    : [];
  const rows = sections.flatMap((section) => section.rows);
  const shared = rows.filter((row) => row.sharesCell);
  const colors = new Map(state.stars.map((star, index) => [starKey(star), index]));
  const windowText = windowKey.replace("-", "–");
  const variable = available.find((entry) => entry.code === code) || null;

  if (els.compareCsv) els.compareCsv.hidden = rows.length === 0;
  if (els.compareNote) {
    els.compareNote.textContent = rows.length
      ? `${variable?.short || code || "Saved places"} · ${windowText} · saved in this browser only`
      : "Saved in this browser only";
  }

  if (!state.stars.length) {
    els.compareBody.innerHTML = `
      <div class="compare-empty-state">
        <span class="compare-empty-star" aria-hidden="true">☆</span>
        <p class="compare-empty">No saved places yet. Open a place's case file and press the star beside Close, or add one below.</p>
        <p class="compare-hint">Stations, countries, grid points, ocean regions and sea-ice records all compare here, grouped by kind.</p>
      </div>
      ${compareAddHtml()}`;
    return;
  }

  els.compareBody.innerHTML = `
    <div class="compare-hero">
      <div class="compare-meta">
        <b>${escapeHtml(variable?.label || code || "Loading")}</b>
        <span aria-hidden="true">·</span><span>${escapeHtml(windowText)}</span>
        <span aria-hidden="true">·</span><span>${state.stars.length} place${state.stars.length === 1 ? "" : "s"}</span>
      </div>
      <p class="compare-lede">Each section below has its own chart, then the places in it. Hover a place to dim the others.</p>
    </div>

    ${compareVariableButtons(available, code)}
    ${compareWindowChips()}
    ${compareAddHtml()}
    ${compareSectionsHtml(sections, colors)}

    ${
      shared.length
        ? `<p class="compare-note warn">${escapeHtml(
            shared.map((row) => row.name).join(" and ")
          )} share a NASA POWER cell with another saved place, so ${
            shared.length === 1 ? "that pair is" : "those places are"
          } not independent observations: the same series is being counted twice.</p>`
        : ""
    }
    <p class="compare-footnote"><span class="compare-footnote-kicker">Note</span>These are published slopes and series side by side, not a test between places. The bundle carries no covariance between them, so an interval for a difference would be invented. A significant slope is distinguishable from noise, not necessarily large.</p>`;

  if (state.compareLoading) return;
  for (const section of sections) {
    renderTrendChart(document.getElementById(`compare-chart-${section.kind}`), {
      lines: section.lines.map((line) => ({ ...line, color: trendPalette(colors.get(line.key) ?? 0) })),
      units: section.units,
    });
  }
}

// A row can open its own case, so the comparison hands the reader back to the app
// instead of asking them to close it and hunt for the place again.
function openSavedPlace(key) {
  const star = state.stars.find((entry) => starKey(entry) === key);
  if (!star) return;
  if (els.compareDialog?.open) els.compareDialog.close();
  if (star.kind === "city") {
    const point = state.byId.get(star.id);
    if (point) selectPoint(point);
    return;
  }
  if (star.kind === "point") {
    const cell = state.gridPoints.find((entry) => entry.id === star.id);
    if (cell) selectPoint(cell);
    return;
  }
  if (star.kind === "country") {
    const country = state.countriesById.get(star.id);
    if (country) selectCountry(country);
    return;
  }
  if (star.kind === "ocean") {
    const region = state.oceanById.get(star.id);
    if (region) selectOcean(region);
    return;
  }
  if (star.kind === "seaice") {
    const record = state.seaIceById.get(star.id);
    if (record) selectSeaIce(record, record.trends?.SEAICE ? "SEAICE" : "SEAICECONC");
  }
}

function removeSavedPlace(key) {
  const star = state.stars.find((entry) => starKey(entry) === key);
  if (!star) return;
  state.stars = toggleStar(state.stars, star).stars;
  state.starSeries.delete(key);
  persistStars();
  refreshStarsButton();
  showToast(`Removed ${star.name} from saved places`);
  if (!state.stars.length && els.compareDialog?.open) els.compareDialog.close();
  renderCompare();
}

async function openCompare() {
  if (!els.compareDialog) return;
  // Open first: the charts measure the box they are drawn into, and a closed dialog
  // has no width to measure.
  els.compareDialog.showModal();
  state.compareWindow = state.windowKey;
  state.compareLoading = true;
  renderCompare();
  await loadStarSeries();
  state.compareLoading = false;
  renderCompare();
}

function exportCompare() {
  const code = state.compareVariable;
  const windowKey = compareWindow();
  const rows = compareRows(state.stars, (star) => {
    const record = state.starSeries.get(starKey(star));
    return record?.trends?.[code]?.[windowKey] || null;
  });
  if (!rows.length) return;
  downloadCsv(
    `saved-places-${code || "places"}-${windowKey}.csv`,
    toCsv(starsToCsv(rows, { variable: code, windowKey }))
  );
  showToast(`Exported ${rows.length} saved place${rows.length === 1 ? "" : "s"} as CSV`);
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
      <span class="rec-distance">${station ? `${distanceText(station.km)}${offset}` : ", "}</span>
      ${station ? `<button type="button" data-action="open-station">Open</button>` : ""}
    </div>
    <div class="rec-row">
      <span class="rec-kind">GISTEMP cell</span>
      <b>${escapeHtml(cell?.cell?.name || "none")}</b>
      <span class="rec-distance">${cell ? distanceText(cell.km) : ", "}</span>
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
  else if (state.selectedKind === "derived") renderDerivedCase();
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
  )}; n = ${trend.n}; HAC p ${pText(trend.p_value)}).${correction} A country mean describes the stations, not every square kilometre: they cluster where people live, so desert and mountain interiors are represented only as far as the network reaches. This is a trend detection, not an attribution, and significance is not size.`;
}

function renderCountryCase() {
  const country = state.selected;
  const code = state.variable === "GISTEMP" ? "T2M" : state.variable;
  const variable = state.byCode.get(code) || state.variables[0];
  const trend = country.trends?.[code]?.[state.windowKey] || null;
  const series = country.series?.[code] || [];
  const window = seriesWindow(series, state.meta.years, state.windowKey);
  const info = verdictInfo(trend, variable);
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
      ${starButton()}
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
    ${statsBlock(
      [
        [
          "The record",
          [
            ["Stations averaged", country.stations],
            ["With all four variables", country.full_coverage],
            ["Series", `${state.windowKey.replace("-", "–")} · n = ${window.years.length}`],
            ["Source", "NASA POWER (MERRA-2 derived) · station mean"],
          ],
        ],
      ],
      "country average",
      "The record"
    )}
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
  )} (95% CI ${signed(trend.ci_low_per_decade)} to ${signed(trend.ci_high_per_decade)}; n = ${trend.n}). ${agreement}${family} Each 4° cell counts in proportion to its area, because a cell near a pole covers less ground than one at the equator. These cells carry ERSST-based sea surface temperature, with land influence inside roughly 1,200 km of a coast. This is a trend detection, not an attribution, and significance is not size.`;
}

function oceanFacts(region, trend, window) {
  const record = [
    ["Cells averaged", region.cells.toLocaleString()],
    ["Extent", region.extent],
    ["Weighting", state.oceanMeta?.weighting || "cos(lat) area weight"],
    ["Series", `${state.windowKey.replace("-", "–")} · n = ${window.years.length}`],
  ];
  const fit = [];
  const robust = [];
  if (trend) {
    fit.push(["HAC p-value", formatP(trend.p_value), true]);
    fit.push([
      "95% interval",
      `${signed(trend.ci_low_per_decade, 2)} to ${signed(trend.ci_high_per_decade, 2)}`,
    ]);
    if (Number.isFinite(trend.sen_slope_per_decade)) {
      robust.push(["Sen's slope", signed(trend.sen_slope_per_decade, 2)]);
    }
    if (Number.isFinite(trend.mk_p_corrected)) {
      robust.push(["MK p (Hamed–Rao)", formatP(trend.mk_p_corrected), true]);
    }
    robust.push([
      region.family === "aggregate" ? "Correction" : "BH q (8 basins)",
      region.family === "aggregate" ? "outside the basin family" : formatP(trend.q_value),
    ]);
  }
  return [
    ["The basin", record],
    ["The fit", fit],
    ["Robustness", robust],
    [
      "Reading it",
      [
        ["Variable", "Sea surface temperature (ERSST-based)"],
        ["Source", "NASA GISTEMP v4 ocean cells · baseline 1951–1980"],
      ],
    ],
  ];
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
      ${starButton()}
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
    ${statsBlock(oceanFacts(region, trend, window), "cos(lat) weighted cells · OLS + HAC")}
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
    : `Corrected across the three sea-ice records it keeps q ${pText(trend.q_value)}, above the 0.05 threshold.`} Each year is the mean of twelve monthly values, so the seasonal cycle, the September minimum and the March maximum, is averaged rather than shown. ${
    variable.code === "SEAICECONC"
      ? "Concentration is ice area ÷ extent: how much of the ice-covered area is actually ice, not how far the ice reaches, so it can rise while the extent falls."
      : "Extent counts every cell with at least 15% ice cover; it is not concentration, and it is not thickness."
  } This is a trend detection, not an attribution, and significance is not size.`;
}

function seaIceFacts(record, trend, window, variable) {
  const series = [
    ["Months averaged", "12 per year"],
    ["Record", `1979–present · window ${state.windowKey.replace("-", "–")}`],
    ["Series", `n = ${window.years.length} annual means`],
  ];
  const fit = [];
  const robust = [];
  if (trend) {
    fit.push(["HAC p-value", formatP(trend.p_value), true]);
    fit.push([
      "95% interval",
      `${signed(trend.ci_low_per_decade, 2)} to ${signed(trend.ci_high_per_decade, 2)}`,
    ]);
    if (Number.isFinite(trend.sen_slope_per_decade)) {
      robust.push(["Sen's slope", signed(trend.sen_slope_per_decade, 2)]);
    }
    if (Number.isFinite(trend.mk_p_corrected)) {
      robust.push(["MK p (Hamed–Rao)", formatP(trend.mk_p_corrected), true]);
    }
    robust.push(["BH q (3 records)", formatP(trend.q_value), true]);
  }
  return [
    ["The record", series],
    ["The fit", fit],
    ["Robustness", robust],
    [
      "Reading it",
      [
        ["Measure", variable.code === "SEAICECONC" ? "100 × area ÷ extent" : "area with ≥15% ice cover"],
        ["Variable", `${variable.label} (${variable.units})`],
        ["Source", "NSIDC/NOAA Sea Ice Index G02135, via NOAA PSL"],
      ],
    ],
  ];
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
      ${starButton()}
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
    ${statsBlock(seaIceFacts(record, trend, window, variable), "12 monthly extents → annual mean · OLS + HAC")}
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
      ${starButton()}
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
    ${statsBlock(facts(trend, variable, false))}
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
      ${starButton()}
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
    ${statsBlock(facts(trend, variable, true), "grid cell series · OLS + HAC")}
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

// The derived case is a grid cell wearing the place's name, and it says so in
// three places: the subtitle, the notice above the verdict, and the narrative.
function renderDerivedCase() {
  const item = state.selected;
  const place = item.place || { name: "This place", lat: item.lat, lon: item.lon };
  const region = place.kind === "region";
  const regionLabel = (place.subtype || "state or province").toLowerCase();
  const raw = item.trends?.[state.windowKey] || null;
  const trend = normalizeGridTrend(raw);
  const variable = state.byCode.get("GISTEMP");
  const window = seriesWindow(item.values, state.grid.meta.years, state.windowKey);
  const info = verdictInfo(trend, variable);
  const here = formatLatLon(place.lat, place.lon);
  const cellAt = formatLatLon(item.lat, item.lon);
  const resolution = item.resolution || null;
  const how =
    resolution?.source === "geocoder"
      ? `The coordinates come from ${escapeHtml(
          resolution.providerLabel || "a public geocoder"
        )} (${escapeHtml(
          resolution.attribution || "open data"
        )}); every number below comes from the cached field.`
      : "The place name was resolved from the Natural Earth gazetteer; every number below comes from the cached field.";
  setExport({
    title: place.name,
    detail: `Derived case · no station in this bundle · GISTEMP cell ${cellAt} · ${distanceText(
      item.distanceKm
    )} away`,
    variable,
    trend,
    windowKey: state.windowKey,
    years: window.years,
    values: window.values,
  });

  els.casePanel.innerHTML = `
    <div class="case-head">
      ${starButton()}
      <button class="case-close" data-action="close-case" type="button">Close</button>
    </div>
    <h2 class="place-title">${escapeHtml(place.name)}</h2>
    <p class="place-sub">Derived case · ${region ? escapeHtml(regionLabel) : "no station here"}${
      place.country ? ` · ${escapeHtml(place.country)}` : ""
    } · ${here}</p>
    <div class="caveat">
      ${
        region
          ? `The bundle has no station for ${escapeHtml(place.name)}, a ${escapeHtml(
              regionLabel
            )}, so this case is the GISTEMP 4° cell nearest its centre, ${distanceText(
              item.distanceKm
            )} away at ${cellAt}, and its numbers describe that cell, roughly a 440 km box, not the whole ${escapeHtml(
              regionLabel
            )}.`
          : `The bundle holds no station at ${escapeHtml(
              place.name
            )}, so this case is the nearest GISTEMP 4° cell, ${distanceText(
              item.distanceKm
            )} away at ${cellAt}, and its numbers describe that cell, roughly a 440 km box, not the city boundary.`
      } ${how}
    </div>
    ${variableChips(variable, true)}
    ${windowChips()}
    <p class="narrative">${derivedNarrative(place, item, trend, variable, state.windowKey)}</p>
    ${verdictBlock(trend, variable, info)}
    ${caveatBlock(trend, variable, true)}
    <div class="chart" id="case-chart"></div>
    ${statsBlock(facts(trend, variable, true), "nearest cell · OLS + HAC")}
    ${caseSources(null, variable)}
    ${stationBlock(item)}
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

// A station the reader can actually open is the better case when one is close,
// so the derived case always offers it rather than hiding it behind the field.
function stationBlock(item) {
  const station = item.station;
  if (!station) return "";
  const near = station.km <= DERIVED_STATION_CHIP_KM;
  return `<div class="case-cities">
    <div class="plan-cities-label">${
      near ? "A real station is close by" : "Nearest station in the bundle"
    }</div>
    <div class="city-chips"><button class="chip chip-small" type="button" data-action="open-city" data-city-id="${escapeHtml(
      station.id
    )}">${escapeHtml(station.name)} · ${distanceText(station.km)} ${escapeHtml(
      station.direction || ""
    )}</button></div>
  </div>`;
}

function derivedNarrative(place, item, trend, variable, windowKey) {
  if (!trend) {
    return `No complete annual series is available for the cell nearest ${escapeHtml(
      place.name
    )} in the ${windowKey.replace("-", "–")} window.`;
  }
  const direction = trend.slope_per_decade >= 0 ? "rose" : "fell";
  const correction = trend.significant
    ? ` It remains significant after the grid-wide Benjamini–Hochberg correction (q = ${formatP(
        trend.q_value
      )}).`
    : trend.p_value < 0.05
      ? ` It is locally significant but does not survive the grid-wide correction (q = ${formatP(
          trend.q_value
        )}).`
      : ` It does not survive the HAC test at the 5% level (q = ${formatP(trend.q_value)}).`;
  return `There is no station at ${escapeHtml(
    place.name
  )}, so this is the surface air temperature anomaly of the nearest GISTEMP cell, which ${direction} by <strong>${signed(
    trend.slope_per_decade
  )} °C per decade</strong> relative to 1951–1980 over ${windowKey.replace(
    "-",
    "–"
  )} (95% CI ${signed(trend.ci_low_per_decade)} to ${signed(
    trend.ci_high_per_decade
  )}; n = ${trend.n}; HAC p ${pText(trend.p_value)}).${correction} The cell is ${distanceText(
    item.distanceKm
  )} from the requested coordinate and covers roughly 440 km across, so read it as the region around ${escapeHtml(
    place.name
  )}, not as the town itself. This is a trend detection, not an attribution, and significance is not size.`;
}

function renderGlobalCase() {
  const meta = state.grid.meta;
  const raw = meta.global.trends?.[state.windowKey] || null;
  const trend = raw;
  const variable = state.byCode.get("GISTEMP");
  const window = seriesWindow(meta.global.series, meta.years, state.windowKey);
  const counts = meta.counts_by_window?.[state.windowKey] || meta.counts;
  const info = verdictInfo(trend, variable);
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
    ${statsBlock(facts(trend, variable, false, counts))}
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
      <div class="verdict-rate">, <span class="unit">${escapeHtml(variable.units)} / decade</span></div>
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
    return `<div class="caveat">A non-significant result is not proof of no trend, only that this record cannot separate one from noise.</div>`;
  }
  return "";
}

// The numbers were one flat list of equal rows, which made the two tests that
// decide the verdict read like everything else. They now sit under three labels,
// with the decisive p-values emphasised and the reading notes kept apart.
function statsBlock(groups, hint = "annual means · OLS + HAC", title = "The statistics") {
  const body = groups
    .filter(([, rows]) => rows.length)
    .map(
      ([label, rows]) => `<p class="stats-label">${escapeHtml(label)}</p><dl class="facts">${rows
        .map(
          ([term, value, key]) =>
            `<dt>${escapeHtml(term)}</dt><dd${key ? ' class="key"' : ""}>${escapeHtml(
              String(value)
            )}</dd>`
        )
        .join("")}</dl>`
    )
    .join("");
  return `<section class="stats">
    <div class="stats-head">
      <span class="stats-title">${escapeHtml(title)}</span>
      <span class="stats-hint">${escapeHtml(hint)}</span>
    </div>
    ${body}
  </section>`;
}

// (term, value, isDecisive) rows, grouped for statsBlock.
function facts(trend, variable, isGrid, counts = null) {
  if (!trend) {
    return [
      [
        "Reading it",
        [
          ["Series", "unavailable"],
          ["Units", variable.units],
          ["Source", variable.source],
        ],
      ],
    ];
  }
  const fit = [
    ["Sample size", `${trend.n} annual means`],
    ["HAC lag", trend.maxlag ?? ", "],
    ["HAC p-value", formatP(trend.p_value), true],
  ];
  if (Number.isFinite(trend.ci_low_per_decade) && Number.isFinite(trend.ci_high_per_decade)) {
    fit.push([
      "95% interval",
      `${signed(trend.ci_low_per_decade, 2)} to ${signed(trend.ci_high_per_decade, 2)}`,
    ]);
  }
  if (Number.isFinite(trend.r_squared)) fit.push(["R²", trend.r_squared.toFixed(2)]);

  const robust = [];
  if (Number.isFinite(trend.sen_slope_per_decade)) {
    robust.push(["Sen's slope", signed(trend.sen_slope_per_decade, 2)]);
  }
  if (Number.isFinite(trend.mk_tau)) robust.push(["Mann–Kendall", `${signed(trend.mk_tau, 2)} τ`]);
  if (Number.isFinite(trend.mk_p)) robust.push(["MK p (i.i.d.)", formatP(trend.mk_p)]);
  if (Number.isFinite(trend.mk_p_corrected)) {
    robust.push(["MK p (Hamed–Rao)", formatP(trend.mk_p_corrected), true]);
  }
  if (isGrid) robust.push(["BH q-value", formatP(trend.q_value), true]);

  const reading = [
    ["Units", variable.units],
    ["Baseline", variable.baseline],
  ];
  if (counts) {
    reading.push(["Significant ↑", counts.significant_increasing.toLocaleString()]);
    reading.push(["Significant ↓", counts.significant_decreasing.toLocaleString()]);
    reading.push(["Not significant", counts.not_significant.toLocaleString()]);
  }
  return [
    ["The fit", fit],
    ["Robustness", robust],
    ["Reading it", reading],
  ];
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
  )}">${live ? "Live" : "Snapshot"} · ${escapeHtml(
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
    const attribution = meta.attribution ? `, ${escapeHtml(meta.attribution)}` : "";
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
          ? "The Sea Ice Index reports monthly extent and area per hemisphere. Extent is the area with at least 15% ice cover; concentration is 100 × area ÷ extent, the mean concentration of the ice-covered area. Each year is the mean of twelve monthly values, so the same trend code reads it as any other record, which hides the seasonal cycle. The family correction runs across the three records (two hemispheres and their sum), separately for each measure. No attribution is claimed."
          : "Annual means only. OLS with Newey–West HAC standard errors; 95% interval with Student-t on n − 2 df; Sen's slope as a robust check. A verdict needs the HAC p < 0.05 and the Hamed–Rao corrected Mann–Kendall p < 0.05 with the same direction. The SI proposed the variable and wrote the narrative; it did not compute a number.";
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
  )}/decade. The Mann–Kendall p-value uses the Hamed–Rao variance correction for autocorrelation, computed on the Sen-detrended series. This is a trend detection, not an attribution, and significance is not size.`;
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
  return `${local}${correction} This is a trend detection, not an attribution, and significance is not size.`;
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
  )}; n = ${trend.n}; HAC p ${pText(trend.p_value)}). Across the 4° grid, ${counts.significant_increasing.toLocaleString()} cells survive Benjamini–Hochberg FDR correction at q = 0.05 as increases, ${counts.significant_decreasing.toLocaleString()} as decreases, and ${counts.not_significant.toLocaleString()} are not significant. Neighbouring cells are correlated, so that correction is approximate. This is a trend detection, not an attribution, and significance is not size.`;
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
  // A place with no station: the derived path answers from the GISTEMP field.
  chips.push(
    `<button class="chip chip-derived" type="button" data-question="Is Gold Coast getting hotter?">Is Gold Coast getting hotter?</button>`
  );
  els.suggestions.innerHTML = chips.join("");
}

function renderPlan(plan) {
  if (!plan) {
    els.plan.innerHTML = "";
    return;
  }
  const confidence = Math.round(plan.confidence * 100);
  const derived = plan.kind === "derived";
  const title = derived
    ? plan.place.name
    : plan.kind === "country"
      ? `${plan.place.name} average`
      : plan.variable.label;
  const meta = derived
    ? `Derived case${plan.place.country ? ` · ${plan.place.country}` : ""} · ${formatLatLon(
        plan.place.lat,
        plan.place.lon
      )} · nearest GISTEMP cell · ${plan.windowKey.replace("-", "–")} · °C`
    : `${plan.place.name}${
      plan.kind === "country"
        ? ` · ${plan.place.stations} stations`
        : plan.kind === "ocean"
          ? ` · ${plan.place.cells} ocean cells`
          : plan.kind === "seaice"
            ? " · 12-month mean"
            : ""
    } · ${plan.windowKey.replace("-", "–")} · ${escapeHtml(plan.variable.units)}`;
  els.plan.innerHTML = `<div class="plan">
    <div class="plan-top">
      <span class="panel-kicker">Case plan</span>
      <span class="plan-confidence">${confidence}% match</span>
    </div>
    <div class="plan-title">${escapeHtml(title)}</div>
    <div class="plan-meta">${escapeHtml(meta)}</div>
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
  const clean = String(question || "").trim();
  if (!clean) return;
  const seq = (state.askSeq += 1);
  // A country name needs the country averages, which are not on the critical
  // path; this is the only place they enter memory.
  await Promise.all([ensureCountries(), ensureOcean(), ensureSeaIce()]);
  const plan = planCase(clean, {
    rag: state.rag,
    points: state.points,
    variables: state.variables,
    countries: state.countries,
    ocean: state.ocean,
    seaIce: state.seaIce,
  });
  if (seq !== state.askSeq) return;
  state.plan = plan;
  renderPlan(plan);
  // On a phone the intake panel scrolls; bring the plan's buttons into view.
  if (plan) els.plan.scrollIntoView({ block: "nearest" });
  // Every word the app had to repair is offered, not quietly used: the popup
  // says which place, basin, record or climate word it read.
  if (plan?.corrected || plan?.repairs?.length) showSuggestions(plan);
  // A global plan the question did not ask for is the planner saying "no place
  // in this bundle matches". That is the derived case: resolve the name, then
  // answer from the field.
  if (isResolvablePlan(plan)) await offerDerivedPlan(clean, seq);
}

// The resolver is the only network call the ask box makes, and it is only made
// when the bundle has already failed to place the question.
async function offerDerivedPlan(question, seq) {
  const resolution = await resolveQuestion(question);
  if (seq !== state.askSeq) return;
  if (!resolution.ok) {
    showToast(describeFailure(resolution));
    return;
  }
  const plan = derivedPlan(resolution);
  if (!plan) return;
  state.plan = plan;
  renderPlan(plan);
  els.plan.scrollIntoView({ block: "nearest" });
  // A name is often not one place, and a misspelling is not a different place.
  // Say which one is meant instead of quietly choosing.
  if (resolution.ambiguous || resolution.expanded || resolution.corrected) showSuggestions(resolution);
}

function suggestionLabel(candidate) {
  const kind =
    candidate.kind === "region"
      ? (candidate.subtype || "region").toLowerCase()
      : candidate.kind === "station"
        ? "station"
        : candidate.kind === "place"
          ? "city"
          : "place";
  return candidate.country ? `${kind} · ${candidate.country}` : kind;
}

function hideSuggestions() {
  document.getElementById("suggest-popover")?.remove();
}

function chooseSuggestion(resolution, candidate) {
  hideSuggestions();
  // A station candidate is one the bundle already holds: choosing it opens the
  // station's own case instead of swapping in a derived cell.
  const station = candidate.id ? state.byId.get(candidate.id) : null;
  if (station) {
    planForCity(station.id);
    els.plan.scrollIntoView({ block: "nearest" });
    showToast(`Using ${station.name}${station.country ? `, ${station.country}` : ""}`);
    return;
  }
  const plan = derivedPlan({ ...resolution, place: { ...candidate, detail: "" } });
  if (!plan) return;
  state.plan = plan;
  renderPlan(plan);
  els.plan.scrollIntoView({ block: "nearest" });
  showToast(`Using ${candidate.name}${candidate.country ? `, ${candidate.country}` : ""}`);
}

function showSuggestions(resolution) {
  hideSuggestions();
  const candidates = (resolution.candidates || []).slice(0, 3);
  // Place names already have a button of their own; the other repairs are
  // words with a single right reading, so their button accepts it.
  const repairs = (resolution.repairs || []).filter(
    (repair) => !["station", "region"].includes(repair.kind)
  );
  if (!candidates.length && !repairs.length) return;
  const box = document.createElement("div");
  box.id = "suggest-popover";
  box.className = "suggest-popover";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Did you mean");
  box.innerHTML = `
    <p class="suggest-title">${
      candidates.length && !resolution.corrected ? "Did you mean one of these?" : "Did you mean"
    }</p>
    <ul class="suggest-list">
      ${candidates
        .map(
          (candidate, index) => `
        <li>
          <button type="button" class="suggest-item" data-suggest="${index}">
            <span class="suggest-name">${escapeHtml(candidate.name)}</span>
            <span class="suggest-meta">${escapeHtml(suggestionLabel(candidate))}</span>
          </button>
        </li>`
        )
        .join("")}
      ${repairs
        .map(
          (repair, index) => `
        <li>
          <button type="button" class="suggest-item" data-repair="${index}">
            <span class="suggest-name">${escapeHtml(repair.name)}</span>
            <span class="suggest-meta">${escapeHtml(repair.kind)}</span>
          </button>
        </li>`
        )
        .join("")}
    </ul>
    <button type="button" class="suggest-dismiss" data-suggest="dismiss">Keep my wording</button>
  `;
  const rect = els.askForm.getBoundingClientRect();
  box.style.top = `${Math.round(rect.bottom + window.scrollY + 8)}px`;
  box.style.left = `${Math.round(rect.left + window.scrollX)}px`;
  box.style.width = `${Math.round(Math.max(rect.width, 280))}px`;
  box.addEventListener("click", (event) => {
    const button = event.target.closest("[data-suggest], [data-repair]");
    if (!button) return;
    const repairIndex = button.getAttribute("data-repair");
    if (repairIndex !== null) {
      const repair = repairs[Number(repairIndex)];
      hideSuggestions();
      if (repair) showToast(`Using ${repair.name}`);
      return;
    }
    const key = button.getAttribute("data-suggest");
    if (key === "dismiss") {
      hideSuggestions();
      return;
    }
    const candidate = candidates[Number(key)];
    if (candidate) chooseSuggestion(resolution, candidate);
  });
  document.body.appendChild(box);
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
  if (plan.kind === "derived") {
    await selectDerived(plan.place, plan.resolution);
    showToast(`Derived case: ${plan.place.name} · nearest GISTEMP cell`);
    return;
  }
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
    await selectPoint(point);
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
  if (!Number.isFinite(Number(value))) return ", ";
  const number = Number(value);
  return `${number >= 0 ? "+" : "−"}${Math.abs(number).toFixed(digits)}`;
}

function formatP(value) {
  if (value == null || !Number.isFinite(Number(value))) return ", ";
  const number = Number(value);
  if (number < 0.001) return "< 0.001";
  return number.toFixed(3);
}

function pText(value) {
  const formatted = formatP(value);
  return formatted.startsWith("<") ? formatted : `= ${formatted}`;
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
    hideSuggestions();
    handleAsk(els.askInput.value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideSuggestions();
  });

  els.suggestions.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-question]");
    if (chip) {
      hideSuggestions();
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
    if (name === "toggle-star") {
      toggleStarForCase();
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
      // A grid cell and a derived case are both read straight off the field, so
      // both can be missing a window a station would have.
      if (
        (state.selectedKind === "grid" || state.selectedKind === "derived") &&
        !state.selected.trends?.[state.windowKey]
      ) {
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

  // Saved places. The dialog is native, so Escape, the inert background and the
  // return of focus to the button that opened it all come from the platform.
  if (els.starsBtn) els.starsBtn.addEventListener("click", openCompare);
  if (els.compareDialog) {
    const closeCompare = () => els.compareDialog.close();
    els.closeCompare?.addEventListener("click", closeCompare);
    els.compareDone?.addEventListener("click", closeCompare);
    els.compareCsv?.addEventListener("click", exportCompare);
    // One delegated listener for the row actions, so a row can be opened or
    // unstarred without rebuilding the listener with every render.
    els.compareBody?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      const name = action.dataset.action;
      if (name === "open-saved") openSavedPlace(action.dataset.key);
      if (name === "remove-saved") removeSavedPlace(action.dataset.key);
      if (name === "compare-variable") {
        state.compareVariable = action.dataset.code;
        renderCompare();
      }
      if (name === "compare-window") {
        state.compareWindow = action.dataset.window;
        renderCompare();
      }
      if (name === "add-saved") addSavedPlace(action.dataset);
    });
    els.compareBody?.addEventListener("input", (event) => {
      if (event.target?.id === "compare-add-input") renderCompareCandidates(event.target.value);
    });
    // The charts are drawn in CSS pixels and the dialog is nearly full width, so a
    // resize or a phone rotation leaves them wider than their box unless they are
    // measured again.
    let compareResizeFrame = 0;
    window.addEventListener("resize", () => {
      if (!els.compareDialog?.open) return;
      cancelAnimationFrame(compareResizeFrame);
      compareResizeFrame = requestAnimationFrame(() => renderCompare());
    });

    // Hovering a place dims the others in every section at once.
    els.compareBody?.addEventListener("pointerover", (event) => {
      const host = event.target.closest?.("[data-key]");
      if (host?.dataset?.key) setCompareFocus(host.dataset.key);
    });
    els.compareBody?.addEventListener("pointerleave", () => setCompareFocus(null));
    els.compareDialog.addEventListener("click", (event) => {
      if (event.target === els.compareDialog) closeCompare();
    });
  }
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
