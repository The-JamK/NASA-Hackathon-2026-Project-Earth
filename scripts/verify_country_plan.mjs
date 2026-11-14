// Every country on the globe must plan a country-average case, and the city and
// global questions that already worked must keep resolving as they did.

import { readFileSync } from "node:fs";
import { planCase } from "../src/rag.js";

const read = (path) => JSON.parse(readFileSync(new URL(`../public/data/${path}`, import.meta.url), "utf8"));

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const points = read("points.json").points;
const { countries } = read("countries.json");
const { variables } = read("variables.json");
const rag = read("rag_index.json");
const context = { rag, points, variables, countries };

if (countries.length !== new Set(points.map((point) => point.country)).size) {
  fail("the bundle has countries without an average record");
}

let planned = 0;
for (const country of countries) {
  const plan = planCase(`Is ${country.name} warming?`, context);
  if (!plan) fail(`${country.name} produced no plan`);
  if (plan.kind !== "country") {
    fail(`${country.name} planned a ${plan.kind} case instead of the country average`);
  }
  if (plan.place.id !== country.id) {
    fail(`${country.name} planned ${plan.place.id}`);
  }
  if (!plan.cities.length) fail(`${country.name} offers no city suggestions`);
  if (!plan.sources.includes("station mean")) {
    fail(`${country.name} plan does not describe the station mean: ${plan.sources}`);
  }
  if (plan.variable.code !== "T2M") fail(`${country.name} planned ${plan.variable.code} for a warming question`);
  planned += 1;
}

const cityCases = [
  ["Is Nairobi warming?", "nairobi"],
  ["Is Delhi getting hotter?", "delhi"],
  ["Has London's rainfall changed?", "london"],
  ["Is Yakutsk warming?", "yakutsk"],
  ["Is the Sahel getting drier?", "niamey"],
];
for (const [question, id] of cityCases) {
  const plan = planCase(question, context);
  if (plan.kind !== "city") fail(`"${question}" planned a ${plan.kind} case`);
  if (plan.place.id !== id) fail(`"${question}" resolved to ${plan.place.id}, expected ${id}`);
}

const global = planCase("Is the world warming?", context);
if (global.kind !== "global") fail(`"Is the world warming?" planned a ${global.kind} case`);

const blank = planCase("   ", context);
if (blank !== null) fail("an empty question must not produce a plan");

console.log(
  `country plans: ${planned} · city regressions: ${cityCases.length} · global: 1 · aliases: ${countries.reduce(
    (total, country) => total + country.aliases.length,
    0
  )}`
);
console.log("country plan verified");
