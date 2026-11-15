// Checks the place matcher every host shares: exact names, names typed without
// their space, misspellings, and the ambiguity that turns one name into a list of
// candidates. Both the Worker and the static page run this same function, so a
// pass here is a pass for the server and the page alike.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { foldPlace, indexGazetteer, searchPlaces } from "../worker/resolve.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
}

const payload = JSON.parse(readFileSync(resolve(ROOT, "public/data/gazetteer.json"), "utf8"));
const entries = [
  ...indexGazetteer(payload.places || []),
  ...indexGazetteer(payload.regions || [], { kind: "region" }),
];

const top = (question) => searchPlaces(question, entries)[0] || null;
const nameOf = (hit) => (hit ? hit.entry.name : "(nothing)");

check("the matcher has something to match", entries.length > 5000, String(entries.length));

/* ------------------------------------------------------------- exact names */

const goldCoast = top("Is Gold Coast getting hotter?");
check(
  "a place in a sentence resolves",
  goldCoast?.entry.name === "Gold Coast" && goldCoast.entry.country === "Australia",
  nameOf(goldCoast)
);
check("and it counts as an exact match", goldCoast?.match === "exact", goldCoast?.match);

const ulaanbaatar = top("Is Ulaanbaatar warming?");
check("a name with doubled vowels still resolves", ulaanbaatar?.entry.name === "Ulaanbaatar", nameOf(ulaanbaatar));

/* ------------------------------------------------------- space left out */

const compact = top("Is goldcoast getting hotter?");
check("a name typed without its space resolves", compact?.entry.name === "Gold Coast", nameOf(compact));

/* --------------------------------------------------------------- regions */

const illinois = top("Is Illinois getting hotter?");
check("a state resolves", illinois?.entry.name === "Illinois", nameOf(illinois));
check("and is tagged as a region", illinois?.entry.kind === "region", illinois?.entry.kind);
check("with its type kept", /state/i.test(illinois?.entry.subtype || ""), illinois?.entry.subtype);
check(
  "and a coordinate inside Illinois",
  illinois && Math.abs(illinois.entry.lat - 40) < 3 && Math.abs(illinois.entry.lon + 89) < 3,
  illinois && `${illinois.entry.lat},${illinois.entry.lon}`
);

const queensland = top("Has rainfall in Queensland changed?");
check("a province resolves", queensland?.entry.name === "Queensland", nameOf(queensland));

/* ------------------------------------------------------------- misspelled */

const typo = top("Is illonoisis getting hotter?");
check("a misspelt state resolves", typo?.entry.name === "Illinois", nameOf(typo));
check("and is reported as a correction", typo?.match === "typo", typo?.match);

const reykjavik = top("Is reykavik getting warmer?");
check(
  "a misspelt city resolves",
  reykjavik && foldPlace(reykjavik.entry.name) === "reykjavik",
  nameOf(reykjavik)
);
check("and is reported as a correction too", reykjavik?.match === "typo", reykjavik?.match);

const pariss = top("Is Pariss getting hotter?");
check("a near miss on a short name resolves", pariss?.entry.name === "Paris", nameOf(pariss));

/* ------------------------------------------------- ambiguous place names */

const washington = searchPlaces("Is Washington getting hotter?", entries);
const dc = washington.find((hit) => foldPlace(hit.entry.name) === "washington d c");
check("Washington, D.C. is offered for \"Washington\"", Boolean(dc), JSON.stringify(washington.map(nameOf)));
check("and it comes first", washington[0] && foldPlace(washington[0].entry.name) === "washington d c", nameOf(washington[0]));
check("the state of Washington is offered too", washington.some((hit) => hit.entry.kind === "region" && /washington/i.test(hit.entry.name)));
check(
  "the match is flagged as an expansion, which is what asks the reader",
  washington[0]?.match === "expanded",
  washington[0]?.match
);
check(
  "the region is the second candidate",
  washington[1]?.entry.kind === "region",
  nameOf(washington[1])
);

/* -------------------------------------------------------- no false matches */

check("nonsense matches nothing", searchPlaces("zzqxville", entries).length === 0);
check("a bare word matches nothing", searchPlaces("the", entries).length === 0);
check("an exact city is not displaced by a longer name", top("Paris")?.entry.name === "Paris", nameOf(top("Paris")));
check("a suffix word does not match a longer name", !searchPlaces("gold coast", entries).some((hit) => /^coast$/i.test(hit.entry.name)));
check("an unrelated question matches nothing", searchPlaces("what is the trend", entries).length === 0);

if (failures) {
  console.error(`\nsearch: ${failures} check(s) failed`);
  process.exit(1);
}
console.log(
  `search verified: ${entries.length} places · exact, unspaced, misspelt and ambiguous names · ` +
    `Washington → Washington, D.C. · illonoisis → Illinois`
);
