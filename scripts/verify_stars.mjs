// Saved places are the app's only persisted state, so the storage layer has to
// be right before any of it is wired to a button. Everything checked here is pure:
// a fake storage stands in for localStorage, and no browser is involved.
//
//   node scripts/verify_stars.mjs
import {
  KINDS,
  MAX_STARS,
  STARS_KEY,
  compareRows,
  groupStars,
  isStarred,
  loadStars,
  parseStars,
  sameCell,
  saveStars,
  sectionsFor,
  seriesFor,
  starKey,
  starsToCsv,
  toggleStar,
  variablesAcross,
} from "../src/stars.js";

let failures = 0;
function check(condition, message) {
  if (condition) return;
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function equal(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  check(left === right, `${message} (got ${left}, expected ${right})`);
}

function memory(initial = null) {
  const map = new Map();
  if (initial !== null) map.set(STARS_KEY, initial);
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

const throwing = {
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

const nairobi = { kind: "city", id: "nairobi", name: "Nairobi", country: "Kenya", lat: -1.2921, lon: 36.8219 };
const delhi = { kind: "city", id: "delhi", name: "Delhi", country: "India", lat: 28.6139, lon: 77.209 };
const kenya = { kind: "country", id: "kenya", name: "Kenya", lat: 0.17, lon: 37.9 };

/* ------------------------------------------------------------ parsing */

equal(parseStars(null), { stars: [], repaired: false }, "null storage text is an empty list");
equal(parseStars("").stars, [], "empty string is an empty list");
equal(parseStars("not json at all").repaired, true, "corrupt JSON is reported as repaired, not thrown");
equal(parseStars("not json at all").stars, [], "corrupt JSON yields no stars");

const halfWritten = parseStars(JSON.stringify([nairobi, { kind: "mars", id: "olympus" }, { kind: "city" }, null, 7]));
equal(halfWritten.stars.length, 1, "entries with an unknown kind or no id are dropped");
equal(halfWritten.repaired, true, "dropping an entry marks the list repaired");
equal(halfWritten.stars[0].name, "Nairobi", "a good entry survives its neighbours");

const sanitised = parseStars(JSON.stringify([{ kind: "city", id: "  nairobi  ", name: "  Nairobi  ", lat: "1", lon: NaN }]));
equal(sanitised.stars[0].id, "nairobi", "whitespace is trimmed from a stored id");
equal(sanitised.stars[0].name, "Nairobi", "whitespace is trimmed from a stored name");
equal(sanitised.stars[0].lat, null, "a non-numeric latitude becomes null, not a string");
equal(sanitised.stars[0].lon, null, "a NaN longitude becomes null");

const nameless = parseStars(JSON.stringify([{ kind: "ocean", id: "north-atlantic" }]));
equal(nameless.stars[0].name, "north-atlantic", "a star without a name falls back to its id");

const wrapped = parseStars(JSON.stringify({ stars: [nairobi] }));
equal(wrapped.stars.length, 1, "a versioned wrapper object is accepted");
equal(parseStars(JSON.stringify({ nope: true })).repaired, true, "an object with no list is repaired");

const duplicated = parseStars(JSON.stringify([nairobi, nairobi, delhi]));
equal(duplicated.stars.length, 2, "duplicate stars are collapsed to one");
equal(duplicated.repaired, true, "a collapsed duplicate marks the list repaired");

const many = Array.from({ length: MAX_STARS + 3 }, (_, index) => ({ kind: "city", id: `p${index}`, name: `P${index}` }));
const capped = parseStars(JSON.stringify(many));
equal(capped.stars.length, MAX_STARS, `a stored list is capped at ${MAX_STARS}`);
equal(capped.repaired, true, "a capped list marks the list repaired");

/* ------------------------------------------------------------ storage */

const good = memory();
equal(loadStars(good).stars, [], "an empty storage loads an empty list");
check(loadStars(good).unavailable === false, "a working storage is not marked unavailable");
check(saveStars(good, [nairobi, kenya]) === true, "saving to a working storage succeeds");
equal(loadStars(good).stars.length, 2, "what was saved comes back");
equal(loadStars(good).stars[1].id, "kenya", "order is preserved across a round trip");

equal(loadStars(null).unavailable, true, "a missing storage is unavailable");
equal(loadStars(null).stars, [], "a missing storage yields no stars");
equal(loadStars(throwing).unavailable, true, "a storage that throws on read is unavailable");
equal(loadStars(throwing).stars, [], "a storage that throws on read yields no stars");
check(saveStars(throwing, [nairobi]) === false, "a storage that throws on write reports failure");
check(saveStars(null, [nairobi]) === false, "saving without a storage reports failure");

const dirty = memory(JSON.stringify([nairobi, { kind: "bogus", id: "x" }]));
check(loadStars(dirty).repaired === true, "loading a partly invalid list reports the repair");
equal(loadStars(dirty).stars.length, 1, "loading a partly invalid list keeps the good star");

saveStars(good, [{ kind: "bogus", id: "nope" }, nairobi]);
equal(JSON.parse(good.getItem(STARS_KEY)).length, 1, "saving drops an invalid record instead of storing it");

/* ------------------------------------------------------------ toggling */

const start = Object.freeze([Object.freeze({ ...nairobi })]);
const snapshot = JSON.stringify(start);
const added = toggleStar(start, kenya);
equal(added.changed, "added", "a new place is added");
equal(added.stars.length, 2, "adding grows the list");
equal(JSON.stringify(start), snapshot, "toggleStar never mutates the list it was given");
check(added.stars !== start, "toggleStar returns a new array");

const removed = toggleStar(added.stars, kenya);
equal(removed.changed, "removed", "a saved place is removed by starring it again");
equal(removed.stars.length, 1, "removing shrinks the list");

const invalid = toggleStar(start, { kind: "volcano", id: "x" });
equal(invalid.changed, "invalid", "an unknown kind is rejected");
equal(invalid.stars.length, 1, "an invalid star leaves the list alone");
check(toggleStar(start, null).changed === "invalid", "a null star is rejected");

const fullList = Array.from({ length: MAX_STARS }, (_, index) => ({ kind: "city", id: `p${index}`, name: `P${index}` }));
const overflow = toggleStar(fullList, { kind: "city", id: "one-more", name: "One more" });
equal(overflow.changed, "full", `a ${MAX_STARS}th place cannot be added`);
equal(overflow.stars.length, MAX_STARS, "a full list is returned unchanged");
equal(toggleStar(fullList, fullList[0]).changed, "removed", "a full list can still remove a place");

check(isStarred(added.stars, "country", "kenya") === true, "isStarred finds a saved place");
check(isStarred(added.stars, "city", "kenya") === false, "isStarred distinguishes kinds with the same id");
equal(starKey(nairobi), "city:nairobi", "a star key is kind and id");

/* --------------------------------------------------------- the rows */

const trends = {
  "city:nairobi": { slope_per_decade: 0.31, ci_low_per_decade: 0.2, ci_high_per_decade: 0.42, n: 36, p_value: 1e-9, verdict: "significant increasing", significant: true, exploratory: false },
  "city:delhi": { slope_per_decade: 0.05, n: 16, verdict: "exploratory", significant: false, exploratory: true },
  "country:kenya": { slope_per_decade: -0.12, ci_low_per_decade: -0.3, ci_high_per_decade: 0.06, n: 36, p_value: 0.2, verdict: "no significant trend", significant: false, exploratory: false },
};

const rows = compareRows([nairobi, delhi, kenya], (star) => trends[starKey(star)] || null);
equal(rows.map((row) => row.name), ["Nairobi", "Delhi", "Kenya"], "rows sort by slope, highest first");
equal(rows[0].slope, 0.31, "a row carries its slope");
equal(rows[0].n, 36, "a row carries its sample size");
equal(rows[0].hasInterval, true, "a full record carries its interval");
equal(rows[1].hasInterval, false, "a summary record has no interval and says so");
equal(rows[1].exploratory, true, "an exploratory record is marked exploratory");
equal(rows[1].verdict, "exploratory", "an exploratory record keeps its verdict word");
equal(rows[0].missing, false, "a place with a record is not missing");

// The delta is measured from the first place saved, not from the first row, so
// sorting cannot change what a reader is comparing against.
equal(rows[0].delta, 0, "the first saved place is its own reference");
const kenyaRow = rows.find((row) => row.kind === "country");
equal(Number(kenyaRow.delta.toFixed(4)), Number((-0.12 - 0.31).toFixed(4)), "delta is measured from the first saved place");
equal(Number(rows[1].delta.toFixed(4)), -0.26, "delta survives sorting");

const withMissing = compareRows([nairobi, { kind: "ocean", id: "north-atlantic", name: "North Atlantic" }], (star) =>
  trends[starKey(star)] || null
);
equal(withMissing.length, 2, "a star with no record is kept, not dropped");
equal(withMissing[1].missing, true, "a star with no record is marked missing");
equal(withMissing[1].slope, null, "a missing record has no slope");
equal(withMissing[1].delta, null, "a missing record has no delta");

const empty = compareRows([], () => null);
equal(empty, [], "no stars means no rows");
equal(compareRows(null, () => null), [], "a null star list means no rows");

const order = JSON.stringify([nairobi, delhi, kenya]);
compareRows([nairobi, delhi, kenya], (star) => trends[starKey(star)] || null);
equal(JSON.stringify([nairobi, delhi, kenya]), order, "building rows never mutates the star list");

/* ------------------------------------------------------- shared cells */

check(sameCell({ ...nairobi }, { ...nairobi, id: "nairobi-airport" }) === true, "two stars in one cell share it");
check(sameCell(nairobi, delhi) === false, "stars in different cells do not share one");
check(sameCell(kenya, { ...kenya, name: "Kenya again" }) === false, "country averages have no cell to share");
check(sameCell({ ...nairobi, lat: null }, nairobi) === false, "a star without coordinates shares nothing");

const paired = compareRows(
  [nairobi, { ...nairobi, id: "nairobi-north", name: "Nairobi north" }],
  () => trends["city:nairobi"]
);
equal(paired.filter((row) => row.sharesCell).length, 2, "both stars in one cell are flagged");
const alone = compareRows([nairobi, delhi], (star) => trends[starKey(star)] || null);
equal(alone.filter((row) => row.sharesCell).length, 0, "a lone star in a cell is not flagged");

/* ---------------------------------------------------------------- CSV */

const csv = starsToCsv(rows, { variable: "T2M", windowKey: "1990-2025" });
equal(csv[0][0], "place", "the CSV names its first column");
check(csv[0].includes("slope_per_decade"), "the CSV names the slope column");
check(csv[0].includes("ci_low_per_decade"), "the CSV names the interval column");
check(csv[0].includes("verdict"), "the CSV names the verdict column");
equal(csv.length, rows.length + 1, "the CSV has one row per star plus a header");
const delhiCsv = csv.find((row) => row[0] === "Delhi");
equal(delhiCsv[6], "", "a summary record leaves the interval cell empty rather than filling it");
equal(delhiCsv[9], "exploratory", "the CSV carries the verdict word");
equal(csv.find((row) => row[0] === "Nairobi")[5], 0.31, "the CSV carries the raw slope");
check(csv.find((row) => row[0] === "Nairobi") !== undefined, "names survive into the CSV");

/* ------------------------------------------------------- grouping */

check(KINDS.includes("point"), "a grid point is a starrable kind");
check(
  toggleStar([], { kind: "point", id: "grid:1:2", name: "1.0°S 2.0°E" }).changed === "added",
  "a grid point can be saved"
);

const grouped = groupStars([nairobi, kenya, { kind: "point", id: "grid:1:2", name: "Cell" }, { kind: "ocean", id: "north-atlantic", name: "North Atlantic" }]);
equal(
  grouped.map((group) => group.label),
  ["Cities", "Countries", "Grid points", "Ocean regions"],
  "sections follow the fixed order and skip empty kinds"
);
equal(grouped[0].stars.length, 1, "a section carries only its own places");
equal(groupStars([nairobi]).length, 1, "one kind means one section");
equal(groupStars([]), [], "no stars means no sections");

/* ------------------------------------------------------ variables */

const variables = [
  { code: "T2M", short: "Temperature", units: "°C" },
  { code: "PRECTOTCORR", short: "Rainfall", units: "mm/day" },
  { code: "GISTEMP", short: "Anomaly", units: "°C" },
];
const records = new Map([
  [
    "city:nairobi",
    {
      years: [1990, 1991, 1992, 1993],
      series: { T2M: [1, 2, 3, 4], PRECTOTCORR: [0.1, null, 0.3, 0.4] },
      trends: { T2M: { "1990-2025": { slope_per_decade: 0.3, n: 4, verdict: "significant increasing", significant: true, exploratory: false } } },
    },
  ],
  [
    "ocean:north-atlantic",
    {
      years: [1990, 1991, 1992, 1993, 1994],
      series: { GISTEMP: [0, 0.1, 0.2, 0.3, 0.4] },
      trends: { GISTEMP: { "1990-2025": { slope_per_decade: 0.1, n: 5, verdict: "significant increasing", significant: true, exploratory: false } } },
    },
  ],
]);

const across = variablesAcross([...records.values()], variables);
equal(across.map((entry) => entry.code), ["T2M", "PRECTOTCORR", "GISTEMP"], "variables appear in the app's order");
equal(across[0].places, 1, "a variable counts the places that carry it");
equal(across[0].units, "°C", "a variable keeps its units");
equal(variablesAcross([...records.values()], []).map((entry) => entry.code), ["T2M", "PRECTOTCORR", "GISTEMP"], "a code the app does not describe still appears");
equal(variablesAcross([], variables), [], "no records means no variables");

/* --------------------------------------------------------- series */

equal(
  seriesFor(records.get("city:nairobi"), "T2M", "1990-1991"),
  [{ year: 1990, value: 1 }, { year: 1991, value: 2 }],
  "a window is cut from the record's own years"
);
equal(seriesFor(records.get("city:nairobi"), "PRECTOTCORR", "1990-1993").length, 3, "a missing annual value is skipped, not drawn as zero");
equal(seriesFor(records.get("ocean:north-atlantic"), "GISTEMP", "1990-1991"), [{ year: 1990, value: 0 }, { year: 1991, value: 0.1 }], "another dataset is read against its own axis");
equal(seriesFor(records.get("ocean:north-atlantic"), "T2M", "1990-2025"), [], "a variable a place does not carry yields no series");
equal(seriesFor(records.get("city:nairobi"), "T2M", "2000-2025"), [], "a window outside the record yields no series");
equal(seriesFor(null, "T2M", "1990-2025"), [], "no record yields no series");

/* ------------------------------------------------------- sections */

const cityStar = nairobi;
const oceanStar = { kind: "ocean", id: "north-atlantic", name: "North Atlantic", lat: 40, lon: -40 };
const tempSections = sectionsFor([cityStar, oceanStar], records, { code: "T2M", windowKey: "1990-2025", variables });
equal(tempSections.map((section) => section.label), ["Cities", "Ocean regions"], "sections are built for the kinds that are starred");
equal(tempSections.length, 2, "an ocean with no temperature record still gets its section");
equal(tempSections[0].rows[0].hasInterval, false, "a summary record keeps its row without an interval");
equal(tempSections[0].lines.length, 1, "a place with a series gets a line");
equal(tempSections[1].rows[0].missing, true, "a place without the variable is marked missing, not dropped");
equal(tempSections[1].lines.length, 0, "a missing record draws no line");
equal(tempSections[0].units, "°C", "a section carries the variable's units");
equal(tempSections[0].variable, "Temperature", "a section names the variable");
equal(tempSections[0].lines[0].pairs.length, 4, "a line carries its year and value pairs");

const anomalySections = sectionsFor([cityStar, oceanStar], records, { code: "GISTEMP", windowKey: "1990-2025", variables });
equal(anomalySections[0].rows[0].missing, true, "switching variable can make a city go missing");
equal(anomalySections[1].lines.length, 1, "and gives the ocean its line");
equal(anomalySections[1].lines[0].pairs[0].year, 1990, "the ocean line starts at its own first year");

const noLines = sectionsFor([cityStar], new Map([["city:nairobi", { years: [1990, 1991], series: { T2M: [1, 2] }, trends: {} }]]), { code: "T2M", windowKey: "1990-2025", variables });
equal(noLines[0].lines.length, 0, "fewer than three annual values draws no line");
equal(noLines[0].rows[0].missing, true, "and the row still says there is no record");

equal(sectionsFor([], new Map(), { code: "T2M", windowKey: "1990-2025", variables }), [], "no saved places means no sections");

if (failures) {
  console.error(`${failures} stars check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("stars verified");
