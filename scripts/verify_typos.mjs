// Typo tolerance is not a convenience for English city names: any of the 10,974
// names in the table should survive one dropped letter, on every continent, and
// a name the table does not hold must not quietly become a different place.
//
// The sample is seeded, so a failing run is reproducible.
import { readFileSync } from "node:fs";
import { foldPlace, indexGazetteer, searchPlaces } from "../worker/resolve.js";

let failures = 0;
function check(condition, message) {
  if (condition) return;
  console.error(`FAIL: ${message}`);
  failures += 1;
}

const root = new URL("../", import.meta.url);
const gazetteer = JSON.parse(readFileSync(new URL("public/data/gazetteer.json", root), "utf8"));
const entries = [
  ...indexGazetteer(gazetteer.places),
  ...indexGazetteer(gazetteer.regions || [], { kind: "region" }),
];

let seed = 11;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

/** One letter dropped from the middle of the folded name. */
function typoOf(name) {
  const folded = foldPlace(name).replace(/ /g, "");
  if (folded.length < 5) return null;
  const at = 1 + Math.floor(random() * (folded.length - 2));
  return folded.slice(0, at) + folded.slice(at + 1);
}

function audit(kind, label, sample = 300) {
  const pool = entries.filter(
    (entry) => entry.kind === kind && foldPlace(entry.name).replace(/ /g, "").length >= 5
  );
  let total = 0;
  let top1 = 0;
  let offered = 0;
  let nothing = 0;
  for (let i = 0; i < sample; i += 1) {
    const entry = pool[Math.floor(random() * pool.length)];
    const typed = typoOf(entry.name);
    if (!typed) continue;
    total += 1;
    const hits = searchPlaces(`Is ${typed} getting hotter?`, entries);
    if (!hits.length) {
      nothing += 1;
      continue;
    }
    if (foldPlace(hits[0].entry.name) === foldPlace(entry.name)) top1 += 1;
    if (hits.slice(0, 3).some((hit) => foldPlace(hit.entry.name) === foldPlace(entry.name))) {
      offered += 1;
    }
  }
  return {
    total,
    top1: top1 / total,
    offered: offered / total,
    nothing,
    label,
  };
}

for (const [kind, label, floor] of [
  ["place", "cities", 0.93],
  ["region", "states and provinces", 0.95],
]) {
  const result = audit(kind, label);
  console.log(
    `${label}: ${result.total} sampled one-letter typos · ` +
      `${(result.top1 * 100).toFixed(1)}% first (floor ${(floor * 100).toFixed(0)}%) · ` +
      `${(result.offered * 100).toFixed(1)}% in the first three · ${result.nothing} unplaced`
  );
  check(result.top1 >= floor, `${label} answered ${(result.top1 * 100).toFixed(1)}% first`);
  check(result.offered >= 0.98, `${label} offered ${(result.offered * 100).toFixed(1)}% in the first three`);
  check(result.nothing === 0, `${result.nothing} ${label} typos resolved to nothing`);
}

// One name per continent, each with a letter dropped from the middle. The
// expected value is the entry's own name, which is not always the English one:
// the layer calls Bavaria "Bayern" and Saxony "Sachsen".
const around = [
  ["Queensland", "Queensland"],
  ["Alberta", "Alberta"],
  ["Ontario", "Ontario"],
  ["Jalisco", "Jalisco"],
  ["Santa Catarina", "Santa Catarina"],
  ["Gauteng", "Gauteng"],
  ["KwaZulu-Natal", "KwaZulu-Natal"],
  ["Guangdong", "Guangdong"],
  ["Sichuan", "Sichuan"],
  ["Yunnan", "Yunnan"],
  ["Maharashtra", "Maharashtra"],
  ["Tamil Nadu", "Tamil Nadu"],
  ["Hokkaido", "Hokkaidō"],
  ["Kyoto", "Kyōto"],
  ["Bavaria", "Bayern"],
  ["Saxony", "Sachsen"],
  ["Bayern", "Bayern"],
  ["Reykjavik", "Reykjavík"],
  ["Nairobi", "Nairobi"],
  ["Ulaanbaatar", "Ulaanbaatar"],
  ["Medellin", "Medellín"],
  ["Wellington", "Wellington"],
];
for (const [name, expected] of around) {
  const typed = typoOf(name);
  const hits = searchPlaces(`Is ${typed} getting hotter?`, entries);
  check(
    hits[0] && foldPlace(hits[0].entry.name) === foldPlace(expected),
    `${name} typed as "${typed}" found ${hits[0]?.entry.name || "nothing"}, not ${expected}`
  );
}

// Names this layer does not carry. They may still be offered as a "did you mean"
// (the matcher flags every repair), but they must not come back as a silent,
// exact answer.
for (const absent of ["Andalucia", "Lombardy", "Scotland", "Brittany", "Normandy", "Zzqxville"]) {
  const hits = searchPlaces(`Is ${absent} getting hotter?`, entries);
  const silent = hits[0] && hits[0].match !== "typo" && hits[0].match !== "compact";
  check(!silent, `${absent} silently answered ${hits[0]?.entry.name}`);
}

// Ordinary sentences must not produce a repair at all. Country names are not in
// this table, `resolveCountry` answers them before the gazetteer is asked, so
// the clean set is place names and state names only.
for (const clean of ["Is Nairobi getting hotter?", "Is Queensland getting drier?", "Is Chennai warming?", "Is Chicago changing?"]) {
  const hits = searchPlaces(clean, entries);
  check(hits.every((hit) => hit.match !== "typo"), `"${clean}" needed a repair`);
}

if (failures) {
  console.error(`\n${failures} typo check(s) failed`);
  process.exit(1);
}

console.log(
  `typos verified: ${entries.length} names · one dropped letter anywhere on the map · ` +
    `absent names never answered silently · ordinary questions untouched`
);
