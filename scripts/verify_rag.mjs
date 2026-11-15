import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { planCase, parseTime, chooseWindow } from "../src/rag.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const read = (name) => JSON.parse(readFileSync(resolve(ROOT, "public", "data", name), "utf8"));

const variables = read("variables.json");
const points = read("points.json");
const rag = read("rag_index.json");

const cases = [
  {
    question: "Is the Sahel getting drier?",
    code: "PRECTOTCORR",
    place: "niamey",
    window: "1990-2025",
    token: "sahel",
  },
  {
    question: "Is Nairobi warming?",
    code: "T2M",
    place: "nairobi",
    window: "1990-2025",
    token: "nairobi",
  },
  {
    question: "Has London's rainfall changed?",
    code: "PRECTOTCORR",
    place: "london",
    window: "1990-2025",
    token: "london",
  },
  {
    question: "Is Delhi getting hotter?",
    code: "T2M",
    place: "delhi",
    window: "1990-2025",
    token: "delhi",
  },
  {
    question: "Is the Amazon drying out?",
    code: "PRECTOTCORR",
    place: "manaus",
    window: "1990-2025",
    token: "amazon",
  },
  {
    question: "Is the Arctic warming faster?",
    code: "T2M",
    place: "tromso",
    window: "1990-2025",
    token: "arctic",
  },
  {
    question: "Which places warmed fastest?",
    code: "GISTEMP",
    place: "global",
    window: "1990-2025",
    token: "global",
  },
  {
    question: "Is soil moisture declining in the Sahel since 2005?",
    code: "GWETROOT",
    place: "niamey",
    window: "2000-2025",
    token: "soil",
  },
  {
    question: "Is McMurdo warming?",
    code: "T2M",
    place: "mcmurdo",
    window: "1990-2025",
    token: "mcmurdo",
  },
  // Comparatives name the variable. "hotter" used to reach temperature only
  // because temperature is the first document in the index, and "sunnier" fell
  // to temperature at all.
  {
    question: "Is Brisbane getting hotter?",
    code: "T2M",
    place: "brisbane",
    window: "1990-2025",
    token: "hotter",
  },
  {
    question: "Is Brisbane getting cooler?",
    code: "T2M",
    place: "brisbane",
    window: "1990-2025",
    token: "cooler",
  },
  {
    question: "Is Brisbane getting sunnier?",
    code: "ALLSKY_SFC_SW_DWN",
    place: "brisbane",
    window: "1990-2025",
    token: "sunnier",
  },
];

let failures = 0;
for (const expected of cases) {
  const plan = planCase(expected.question, {
    rag,
    points: points.points,
    variables: variables.variables,
  });
  if (!plan) {
    console.error(`FAIL: no plan for "${expected.question}"`);
    failures += 1;
    continue;
  }
  const actualPlace = plan.place.global ? "global" : plan.place.id;
  const checks = [
    [plan.variable.code, expected.code, "variable"],
    [actualPlace, expected.place, "place"],
    [plan.windowKey, expected.window, "window"],
    [plan.explanation.toLowerCase().includes(expected.token), true, "explanation"],
    [plan.confidence >= 0.5, true, "confidence"],
  ];
  for (const [actual, wanted, label] of checks) {
    if (actual !== wanted) {
      console.error(
        `FAIL: "${expected.question}" ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(
          wanted
        )}`
      );
      failures += 1;
    }
  }
  if (plan.alternatives.length > 2) {
    console.error(`FAIL: "${expected.question}" returned too many alternatives`);
    failures += 1;
  }
  console.log(
    `ok  ${expected.question.padEnd(52)} -> ${plan.variable.code} · ${actualPlace} · ${plan.windowKey}`
  );
}

const since = parseTime("since 2005");
if (since.start !== 2005 || since.end !== 2025) {
  console.error("FAIL: parseTime('since 2005') did not produce 2005–2025");
  failures += 1;
}
if (chooseWindow(since, ["1990-2025", "2000-2025", "2010-2025"]) !== "2000-2025") {
  console.error("FAIL: chooseWindow did not select the 2000–2025 window");
  failures += 1;
}

const late = parseTime("2010-2020");
if (late.start !== 2010 || late.end !== 2020) {
  console.error("FAIL: parseTime('2010-2020') did not preserve the range");
  failures += 1;
}
if (chooseWindow(late, ["1990-2025", "2000-2025", "2010-2025"]) !== "2010-2025") {
  console.error("FAIL: chooseWindow did not select the 2010–2025 window");
  failures += 1;
}

const early = parseTime("since 1900");
if (early.start !== 1990 || !early.note) {
  console.error("FAIL: parseTime did not clamp the earliest record");
  failures += 1;
}

if (planCase("", { rag, points: points.points, variables: variables.variables }) !== null) {
  console.error("FAIL: empty input produced a plan");
  failures += 1;
}

if (failures) {
  console.error(`\n${failures} RAG check(s) failed`);
  process.exit(1);
}

console.log(`\n${cases.length} golden questions · time parsing · empty input`);
console.log("rag verified");
