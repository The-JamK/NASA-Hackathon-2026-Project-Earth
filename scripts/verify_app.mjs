const BASE = process.env.APP_URL || "http://127.0.0.1:5173";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function get(path, expectedType) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (expectedType && !contentType.includes(expectedType)) {
    fail(`${path} returned ${contentType || "no content type"}, expected ${expectedType}`);
  }
  return response;
}

async function json(path) {
  const response = await get(path, "application/json");
  try {
    return await response.json();
  } catch {
    fail(`${path} is not valid JSON`);
  }
}

const landing = await (await get("/", "text/html")).text();
for (const marker of ['id="sample-case"', 'href="./app.html"']) {
  if (!landing.includes(marker)) fail(`the landing page is missing ${marker}`);
}

const html = await (await get("/app.html", "text/html")).text();
for (const marker of [
  'id="globe"',
  'id="ask-form"',
  'id="case-panel"',
  'id="method-dialog"',
  'id="recommendation"',
]) {
  if (!html.includes(marker)) fail(`app.html is missing ${marker}`);
}

const variables = await json("/data/variables.json");
if (variables.variables.length !== 5) fail("expected five variables");
if (variables.variables.filter((item) => item.kind === "point").length !== 4) {
  fail("expected four point variables");
}

const points = await json("/data/points.json");
if (points.points.length < 25) fail("too few points");
if (points.points.filter((point) => point.featured).length < 10) fail("too few featured points");
if (points.points.filter((point) => point.live).length < 5) fail("too few live points");

const grid = await json("/data/grid.json");
if (grid.cells.length < 2_000) fail("too few grid cells");
if (grid.meta.windows.length !== 3) fail("expected three analysis windows");

const rag = await json("/data/rag_index.json");
if (rag.docs.length < 5) fail("retrieval documents missing");
if (rag.places.length !== points.points.length) fail("retrieval places do not match points");

const sources = await json("/data/sources.json");
if (sources.sources.length !== 6) fail("expected six source checks");
if (sources.sources.some((source) => source.status !== "ok")) fail("a source is not ok");

for (const path of [
  "/textures/earth-blue-marble.jpg",
  "/textures/earth-topology.png",
  "/textures/night-sky.png",
]) {
  await get(path, "image/");
}

const featured = points.points.filter((item) => item.featured);
if (featured.some((point) => !point.imagery_meta?.label || !point.imagery_meta?.attribution)) {
  fail("a featured point has no imagery source label");
}
if (featured.filter((point) => point.imagery_meta?.source_id === "sentinel-2").length < 10) {
  fail("fewer than 10 featured points serve Sentinel-2 imagery");
}

for (const point of points.points.filter((item) => item.imagery)) {
  await get(point.imagery, "image/jpeg");
}

const main = await (await get("/src/main.js", "javascript")).text();
if (!main.includes("new Globe")) fail("main.js does not mount the globe");
if (!main.includes("planCase")) fail("main.js is not wired to the retrieval planner");
if (!main.includes("recommendAt")) fail("main.js does not recommend the nearest record on tap");
if (!main.includes("nearestCell")) fail("main.js does not look up the nearest GISTEMP cell");

// Chrome copy that was removed on purpose: the tagline, the dot inside the
// wordmark, the intake label and the case board wording must not come back.
const TAGLINE = "Ask the planet. Get the evidence.";
if (html.includes(TAGLINE) || landing.includes(TAGLINE)) fail("the tagline is still on a page");
if (html.includes("brand-dot") || landing.includes("brand-dot")) {
  fail("the wordmark still contains the brand dot");
}
if (!html.includes("GAUSSIAN FRONTIERS") || !landing.includes("GAUSSIAN FRONTIERS")) {
  fail("the wordmark is not GAUSSIAN FRONTIERS on both pages");
}
if (html.includes(">Intake<")) fail("the intake panel still shows the Intake label");
if (html.includes("Case board") || main.includes("Case board")) {
  fail("the case board wording is still present");
}
if (!/id="case-panel"[^>]*><\/aside>/.test(html)) {
  fail("the case panel still ships an empty state instead of staying hidden");
}
if (html.includes("map-canvas") || html.includes("locate-form") || main.includes("MapView")) {
  fail("the map panel is still present");
}
if (/google\.com\/maps/i.test(main) || /google\.com\/maps/i.test(html)) {
  fail("a Google Maps link is still present");
}

// The narrative paragraph is read before the stamp, the chart and the facts.
const narrativeAt = main.indexOf('class="narrative"');
const verdictAt = main.indexOf("${verdictBlock(");
if (narrativeAt === -1 || verdictAt === -1 || narrativeAt > verdictAt) {
  fail("the narrative paragraph is not rendered above the verdict block");
}

console.log(`page: ${BASE}`);
console.log(`points: ${points.points.length} · grid: ${grid.cells.length} · sources: ${sources.sources.length}`);
console.log(`assets: 3 textures · ${points.points.filter((point) => point.imagery).length} context images`);
console.log("recommendation: overlay element served and wired to the tap handler");
console.log("chrome: tagline, brand dot, Intake label and case board wording removed");
console.log("case layout: narrative paragraph above the verdict block");
console.log("app verified");
