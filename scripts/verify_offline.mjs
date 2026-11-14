import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const read = (name) => readFileSync(resolve(ROOT, name), "utf8");
const data = (name) => JSON.parse(read(`public/data/${name}`));

let failures = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

// The landing page may link out to the repository and carries the SVG namespace
// URI inside its inline favicon. Neither is a request the app makes, so they are
// stripped before the check; every other URL in the app source must stay local.
const LANDING_LINKS = [
  "http://www.w3.org/2000/svg",
  "https://github.com/The-JamK/NASA-Hackathon-2026-Project-Earth",
];

for (const file of ["index.html", "src/main.js", "src/rag.js", "src/chart.js", "src/style.css", "src/geo.js"]) {
  let text = read(file);
  for (const link of LANDING_LINKS) text = text.split(link).join("");
  if (/https?:\/\//i.test(text)) fail(`${file} contains an external URL`);
}
if (/\b(fetch|XMLHttpRequest)\s*\(\s*["'`]https?:/i.test(read("src/main.js"))) {
  fail("main.js performs a remote fetch");
}

// The tap recommendation is pure geometry over the cached bundle: no map tiles,
// no geocoder, no outbound link.
for (const file of ["src/geo.js"]) {
  if (/https?:\/\//i.test(read(file))) fail(`${file} contains an external URL`);
  if (/\b(fetch|XMLHttpRequest)\s*\(/.test(read(file))) fail(`${file} performs a network call`);
}

for (const file of [
  "public/textures/earth-blue-marble.jpg",
  "public/textures/earth-topology.jpg",
  "public/textures/night-sky.png",
]) {
  if (!existsSync(resolve(ROOT, file)) || statSync(resolve(ROOT, file)).size < 10_000) {
    fail(`missing or tiny globe asset: ${file}`);
  }
}

const points = data("points.json");
const grid = data("grid.json");
const nairobi = points.points.find((point) => point.id === "nairobi");
if (!nairobi) fail("Nairobi is missing from the bundle");
if (nairobi.series.T2M.filter((value) => typeof value === "number").length !== 36) {
  fail("Nairobi temperature series is not complete offline");
}
if (!nairobi.trends.T2M["1990-2025"]) fail("Nairobi trend is missing offline");
if (!grid.cells.length || !grid.cells[0].trends["1990-2025"]) fail("grid trend is missing offline");
if (!grid.meta.global.series.length || !grid.meta.global.trends["1990-2025"]) {
  fail("global series is missing offline");
}

for (const point of points.points.filter((item) => item.imagery)) {
  const path = resolve(ROOT, "public", point.imagery.replace(/^\//, ""));
  if (!existsSync(path) || statSync(path).size < 1_000) fail(`missing context image: ${point.id}`);
  if (!point.imagery_meta?.label || !point.imagery_meta?.source_id) {
    fail(`imagery source label missing: ${point.id}`);
  }
}

const imports = read("src/main.js").match(/from\s+["']([^"']+)["']/g) || [];
for (const statement of imports) {
  const specifier = statement.match(/["']([^"']+)["']/)?.[1];
  if (specifier?.startsWith("/")) fail(`absolute import is not portable: ${specifier}`);
}

if (failures) {
  console.error(`\n${failures} offline check(s) failed`);
  process.exit(1);
}

console.log("network: no external URLs in the app source");
console.log("recommendation: nearest station and cell computed from the cached bundle, no map service");
console.log(`bundle: ${points.points.length} points · ${grid.cells.length} grid cells · ${grid.meta.global.series.length} global years`);
console.log(`imagery: ${points.points.filter((point) => point.imagery).length} local context images`);
console.log("offline verified");
