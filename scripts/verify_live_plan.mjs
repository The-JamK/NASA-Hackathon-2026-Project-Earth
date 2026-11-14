// The deployed bundle must answer country questions the same way the build does.
// This runs against the live origin, so it proves the deployed data, not a local
// copy of it.

import { planCase } from "../src/rag.js";

const BASE = process.env.BASE_URL || "https://the-jamk.github.io/NASA-Hackathon-2026-Project-Earth";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function json(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { "cache-control": "no-cache" } });
  if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const [points, countries, variables, rag] = await Promise.all([
  json("/data/points.json"),
  json("/data/countries.json"),
  json("/data/variables.json"),
  json("/data/rag_index.json"),
]);

const context = { rag, points: points.points, variables: variables.variables, countries: countries.countries };
const stations = points.points.length;

if (countries.countries.length !== new Set(points.points.map((point) => point.country)).size) {
  fail("live countries.json does not cover every live country");
}

let planned = 0;
for (const country of countries.countries) {
  const plan = planCase(`Is ${country.name} warming?`, context);
  if (plan?.kind !== "country" || plan.place.id !== country.id) {
    fail(`${country.name} planned ${plan?.kind} ${plan?.place?.id}`);
  }
  if (!plan.cities.length) fail(`${country.name} offers no city suggestions`);
  planned += 1;
}

for (const [question, id] of [
  ["Is Nairobi warming?", "nairobi"],
  ["Is Yakutsk warming?", "yakutsk"],
]) {
  const plan = planCase(question, context);
  if (plan.kind !== "city" || plan.place.id !== id) fail(`"${question}" planned ${plan.kind} ${plan.place.id}`);
}

console.log(`live stations: ${stations} · live countries: ${countries.countries.length} · country plans: ${planned}`);
console.log("live plan verified");
