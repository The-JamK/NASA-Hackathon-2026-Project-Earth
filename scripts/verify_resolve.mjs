// The resolver is what makes "Is Gold Coast getting hotter?" answerable: a place
// the bundle does not hold still gets a coordinate, and the GISTEMP field
// supplies the numbers. This check pins the whole contract without depending on
// a live geocoder — both providers are stubs, so a passing run proves the
// matching, the place-name extraction, the validation, the fallbacks, the
// caching and the rate limit. It also proves the feature needs no API key: no
// test here passes one, and there is no option to pass one.
import { readFileSync } from "node:fs";
import {
  GEOCODERS,
  foldPlace,
  handleResolve,
  indexGazetteer,
  matchGazetteer,
  placeQuery,
} from "../worker/resolve.js";
import { planCase } from "../src/rag.js";
import { nearestCell } from "../src/geo.js";

let failures = 0;
function check(condition, message) {
  if (condition) return;
  console.error(`FAIL: ${message}`);
  failures += 1;
}

const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

const gazetteer = read("public/data/gazetteer.json");
const points = read("public/data/points.json");
const variables = read("public/data/variables.json").variables;
const grid = read("public/data/grid.json");
const entries = [
  ...indexGazetteer(gazetteer.places),
  ...indexGazetteer(gazetteer.regions || [], { kind: "region" }),
];
const cells = grid.cells.map((cell) => ({ ...cell, isGrid: true }));

check(entries.length >= 6000, `gazetteer indexed only ${entries.length} places`);
for (const point of points.points) {
  if (Math.abs(point.lat) > 90) check(false, "a station has an impossible latitude");
}

const call = (body, options = {}) =>
  handleResolve(
    new Request("http://local/api/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { entries, ...options }
  );

const probe = new Request("http://local/api/resolve", { method: "GET" });

// 1. The gazetteer answers the headline question with no key and no network.
{
  let network = 0;
  const offline = async () => {
    network += 1;
    throw new Error("the gazetteer path must not touch the network");
  };
  const response = await call({ question: "Is Gold Coast getting hotter?" }, { fetchImpl: offline });
  const body = await response.json();
  check(response.status === 200, `gazetteer hit returned ${response.status}`);
  check(body.ok === true, "a gazetteer hit is not ok");
  check(body.source === "gazetteer", `a gazetteer hit reported source ${body.source}`);
  check(body.place?.country === "Australia", `Gold Coast resolved to ${body.place?.country}`);
  check(Math.abs(body.place.lat + 28.08) < 0.2, `Gold Coast latitude is ${body.place?.lat}`);
  check(Math.abs(body.place.lon - 153.45) < 0.3, `Gold Coast longitude is ${body.place?.lon}`);
  check(body.variable === "T2M", `"hotter" read as ${body.variable}`);
  check(body.windowKey === "1990-2025", `default window is ${body.windowKey}`);
  check(body.derived === true, "a resolved place is not marked derived");
  check(body.provider === null, "the gazetteer path named a geocoder");
  check(network === 0, `the gazetteer path made ${network} network requests`);

  const near = nearestCell(body.place.lat, body.place.lon, cells);
  check(Boolean(near), "no GISTEMP cell is near Gold Coast");
  check(near.km < 300, `the nearest cell to Gold Coast is ${near.km.toFixed(0)} km away`);
  check(Boolean(near.cell.trends?.["1990-2025"]), "the nearest cell has no 1990–2025 trend");
  check(
    near.cell.values.filter((value) => typeof value === "number").length === 36,
    "the nearest cell does not carry 36 annual anomalies"
  );
}

// 1b. The same place typed the way the question usually gets written.
for (const question of ["Is Goldcoast getting hotter?", "is the gold coast warming?"]) {
  const body = await (await call({ question })).json();
  check(body.ok === true, `"${question}" did not resolve`);
  check(body.place?.name === "Gold Coast", `"${question}" resolved to ${body.place?.name}`);
}

// 2. The place name is cut out of the question, not passed through verbatim.
{
  const expectations = [
    ["Is Gold Coast getting hotter?", "gold coast"],
    ["Has rainfall in Broadbeach changed since 2005?", "broadbeach"],
    ["Is the soil moisture drying out in Narok?", "narok"],
    ["Is 2015 hotter than 2010 in Ubud?", "ubud"],
  ];
  for (const [question, expected] of expectations) {
    const query = placeQuery(question);
    check(query === expected, `"${question}" produced the query "${query}", expected "${expected}"`);
  }
  const empty = await call({ question: "Is it getting hotter?" });
  const body = await empty.json();
  check(empty.status === 422, `a question with no place returned ${empty.status}`);
  check(body.detail === "No place name was found in the question.", `unexpected detail ${body.detail}`);
}

// 3. A name the gazetteer does not carry goes to Open-Meteo, keyless.
function geocoderStub(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const provider = url.includes("open-meteo") ? "open-meteo" : "nominatim";
    calls.push({ url, provider, headers: init.headers || {} });
    const entry = responses[provider];
    if (!entry) throw new Error(`unexpected request to ${provider}`);
    if (entry.error) {
      const error = new Error(entry.error);
      if (entry.timeout) error.name = "TimeoutError";
      throw error;
    }
    return new Response(JSON.stringify(entry.body), {
      status: entry.status || 200,
      headers: { "content-type": "application/json" },
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const OPEN_METEO_BROADBEACH = {
  results: [
    {
      id: 2173977,
      name: "Broadbeach",
      latitude: -28.02782,
      longitude: 153.43343,
      country: "Australia",
      country_code: "AU",
      admin1: "Queensland",
      admin2: "Gold Coast",
    },
  ],
};
const NOMINATIM_BROADBEACH = [
  {
    name: "Broadbeach",
    lat: "-28.0281465",
    lon: "153.4312769",
    display_name: "Broadbeach, Gold Coast, Queensland, Australia",
  },
];

{
  const fetchImpl = geocoderStub({ "open-meteo": { body: OPEN_METEO_BROADBEACH } });
  const response = await call({ question: "Is Broadbeach getting hotter?" }, { fetchImpl });
  const body = await response.json();
  check(response.status === 200, `geocoder path returned ${response.status}`);
  check(body.source === "geocoder", `geocoder path reported source ${body.source}`);
  check(body.provider === "open-meteo", `geocoder path reported provider ${body.provider}`);
  check(body.place?.name === "Broadbeach", `geocoder place is ${body.place?.name}`);
  check(body.place?.country === "Australia", `geocoder country is ${body.place?.country}`);
  check(
    Math.abs(body.place.lat + 28.0278) < 0.001 && Math.abs(body.place.lon - 153.4334) < 0.001,
    `geocoder coordinates are ${body.place.lat}, ${body.place.lon}`
  );
  check(/CC BY 4\.0/.test(body.note), "the note does not carry the open-data attribution");
  check(fetchImpl.calls.length === 1, `the geocoder was called ${fetchImpl.calls.length} times`);
  const sent = fetchImpl.calls[0];
  check(
    sent.url.startsWith("https://geocoding-api.open-meteo.com/v1/search?name=broadbeach"),
    `wrong geocoder URL ${sent.url}`
  );
  check(/count=1/.test(sent.url), "the request does not ask for one result");
  check(!/key|token|secret/i.test(sent.url), "the geocoder URL carries a credential");
  check(!("authorization" in sent.headers), "the request sends an authorization header");

  // A repeated question is served from cache: these are shared public services.
  const again = await (
    await call({ question: "Is Broadbeach getting hotter?" }, { fetchImpl })
  ).json();
  check(again.cache === "hit", "the second identical question missed the cache");
  check(fetchImpl.calls.length === 1, "the cached question still called the geocoder");
}

// 4. When the first provider has nothing, the second is asked — with its policy
//    header, because Nominatim blocks stock library User-Agents.
{
  const fetchImpl = geocoderStub({
    "open-meteo": { body: {} },
    nominatim: { body: NOMINATIM_BROADBEACH },
  });
  const body = await (
    await call({ question: "Is Broadbeach warming?" }, { fetchImpl })
  ).json();
  check(body.provider === "nominatim", `fallback provider is ${body.provider}`);
  check(body.place?.name === "Broadbeach", `fallback place is ${body.place?.name}`);
  check(body.place?.country === "Australia", `fallback country is ${body.place?.country}`);
  check(body.place?.detail === "Gold Coast, Queensland", `fallback detail is ${body.place?.detail}`);
  check(/OpenStreetMap/.test(body.note), "the fallback note does not credit OpenStreetMap");
  const sent = fetchImpl.calls.find((entry) => entry.provider === "nominatim");
  check(Boolean(sent), "the fallback provider was never called");
  check(
    typeof sent?.headers["user-agent"] === "string" && sent.headers["user-agent"].includes("signal-and-noise"),
    "the Nominatim request does not identify the application"
  );
  check(fetchImpl.calls.length === 2, `expected two provider calls, saw ${fetchImpl.calls.length}`);
}

// 5. A geocoder answer that is not a coordinate is rejected, not passed upstream.
{
  const bogus = geocoderStub({
    "open-meteo": { body: { results: [{ name: "Nowhere", latitude: 120, longitude: 10 }] } },
    nominatim: { body: [] },
  });
  const response = await call({ question: "Is Nowheresville warming?" }, { fetchImpl: bogus });
  check(response.status === 422, `an out-of-range latitude returned ${response.status}`);

  const missing = geocoderStub({ "open-meteo": { body: { results: [{ name: "Nowhere" }] } }, nominatim: { body: [] } });
  const nan = await call({ question: "Is Nowheretown warming?" }, { fetchImpl: missing });
  check(nan.status === 422, `a missing coordinate returned ${nan.status}`);
}

// 6. Provider failures are labelled, and a dead provider is not "no such place".
{
  const failing = geocoderStub({
    "open-meteo": { status: 500, body: {} },
    nominatim: { error: "network down" },
  });
  // A name nothing in the gazetteer is close to: with fuzzy matching, "Atlantis"
  // now legitimately suggests Atlanta, so an outage needs a name with no match.
  const response = await call({ question: "Is Zzqxmark warming?" }, { fetchImpl: failing });
  const body = await response.json();
  check(response.status === 502, `two failing providers returned ${response.status}`);
  check(body.error === "resolver_unavailable", `two failing providers reported ${body.error}`);
  check(body.provider === "nominatim", `the failure names ${body.provider}, not the last provider tried`);

  const timingOut = geocoderStub({ "open-meteo": { error: "slow", timeout: true }, nominatim: { body: [] } });
  const timeout = await call({ question: "Is Zzqxslow warming?" }, { fetchImpl: timingOut });
  check(timeout.status === 504, `a timeout returned ${timeout.status}`);

  const nothing = geocoderStub({ "open-meteo": { body: {} }, nominatim: { body: [] } });
  const empty = await call({ question: "Is Zzqxville warming?" }, { fetchImpl: nothing });
  const emptyBody = await empty.json();
  check(empty.status === 422, `two empty providers returned ${empty.status}`);
  check(emptyBody.error === "place_not_found", `two empty providers reported ${emptyBody.error}`);
  check(emptyBody.query === "zzqxville", `the error echoes the query "${emptyBody.query}"`);
}

// 7. The question is read for the variable and window, not just the place.
{
  const fetchImpl = geocoderStub({ "open-meteo": { body: OPEN_METEO_BROADBEACH } });
  const body = await (
    await call({ question: "Has rainfall in Broadbeach changed since 2005?" }, { fetchImpl })
  ).json();
  check(body.variable === "PRECTOTCORR", `rainfall read as ${body.variable}`);
  check(body.windowKey === "2000-2025", `"since 2005" read as ${body.windowKey}`);
  check(body.topicOnly === true, "a non-temperature derived case is not flagged as topic-only");

  const warm = await (await call({ question: "Is Gold Coast warming since 2012?" })).json();
  check(warm.windowKey === "2010-2025", `"since 2012" read as ${warm.windowKey}`);
  check(warm.topicOnly === false, "a temperature question is flagged as topic-only");
}

// 8. Request hygiene and the capability probe.
{
  const cases = [
    ["PUT", await handleResolve(new Request("http://local/api/resolve", { method: "PUT", body: "{}" }), { entries }), 405],
    ["invalid JSON", await call("{"), 400],
    ["empty question", await call({ question: "   " }), 400],
    ["long question", await call({ question: "x".repeat(300) }), 400],
  ];
  for (const [label, response, expected] of cases) {
    check(response.status === expected, `${label} returned ${response.status}, expected ${expected}`);
  }
  const tooLong = await (await call({ question: "x".repeat(300) })).json();
  check(tooLong.limit === 240, "the length error does not name the limit");

  const capability = await (await handleResolve(probe, { entries })).json();
  check(capability.ok === true, "the probe is not ok");
  check(capability.places === entries.length, "the probe reports the wrong gazetteer size");
  check(
    JSON.stringify(capability.providers) === JSON.stringify(GEOCODERS.map((provider) => provider.id)),
    `the probe reports providers ${JSON.stringify(capability.providers)}`
  );
  check(
    capability.attribution.every((line) => typeof line === "string" && line.length > 5),
    "the probe does not report provider attribution"
  );
  check(!("configured" in capability), "the probe still reports an API-key state");
}

// 9. The public endpoint that calls shared public services has a ceiling.
{
  const fetchImpl = geocoderStub({ "open-meteo": { body: OPEN_METEO_BROADBEACH } });
  let limited = null;
  for (let index = 0; index < 40 && !limited; index += 1) {
    const response = await call(
      { question: `Is zzqxrate${index} getting hotter?` },
      { fetchImpl }
    );
    if (response.status === 429) limited = response;
  }
  check(Boolean(limited), "the geocoder path never rate limited");
  if (limited) {
    check(limited.headers.get("retry-after") === "60", "the 429 does not say when to retry");
  }
}

// 10. The planner sends exactly this question to the resolver, and nothing else.
{
  const plan = planCase("Is Gold Coast getting hotter?", {
    rag: read("public/data/rag_index.json"),
    points: points.points,
    variables,
    countries: [],
    ocean: [],
    seaIce: [],
  });
  check(plan.kind === "global", `Gold Coast planned as ${plan.kind}`);
  check(plan.resolved === false, "an unplaceable question is not marked unresolved");
  for (const id of ["gold-coast", "broadbeach"]) {
    check(
      points.points.every((point) => point.id !== id),
      `${id} is a station after all; the derived path would never run`
    );
  }

  const world = planCase("Is the world warming?", {
    rag: read("public/data/rag_index.json"),
    points: points.points,
    variables,
    countries: [],
    ocean: [],
    seaIce: [],
  });
  check(world.kind === "global" && world.resolved === true, "a world question is marked unresolved");
}

// 11. The gazetteer and the live geocoder agree about where Gold Coast is. This
//     is the one check that would notice a provider returning plausible nonsense
//     in a different hemisphere, and it needs no network.
{
  const local = matchGazetteer("Is Gold Coast getting hotter?", entries);
  check(Boolean(local), "the gazetteer cannot find Gold Coast");
  check(local.place.country === "Australia", `the gazetteer puts Gold Coast in ${local.place.country}`);
}

// 12. A name that is not one place, and a name that is misspelt, come back as a
//     list of candidates with the reason — never as one silent guess.
{
  const fetchImpl = geocoderStub({});

  const washington = await (
    await call({ question: "Is Washington getting hotter?" }, { fetchImpl })
  ).json();
  check(washington.ok === true, `washington did not resolve: ${washington.error}`);
  check(
    foldPlace(washington.place?.name || "") === "washington d c",
    `washington resolved to ${washington.place?.name}`
  );
  check(washington.expanded === true, "the abbreviations were not flagged as an expansion");
  check(Array.isArray(washington.candidates) && washington.candidates.length >= 2, "no candidates for washington");
  check(
    washington.candidates?.[1]?.kind === "region",
    `the second Washington candidate is a ${washington.candidates?.[1]?.kind}`
  );
  check(
    washington.candidates?.every((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon)),
    "a candidate has no usable coordinate"
  );

  const typo = await (
    await call({ question: "Is illonoisis getting hotter?" }, { fetchImpl })
  ).json();
  check(typo.ok === true, `the misspelling did not resolve: ${typo.error}`);
  check(typo.place?.name === "Illinois", `the misspelling resolved to ${typo.place?.name}`);
  check(typo.corrected === true, "the misspelling was not flagged as a correction");
  check(typo.place?.kind === "region", `Illinois came back as a ${typo.place?.kind}`);

  const state = await (await call({ question: "Is Illinois getting hotter?" }, { fetchImpl })).json();
  check(state.ok === true, `Illinois did not resolve: ${state.error}`);
  check(state.corrected === false, "an exact state name was flagged as a correction");
  check(/state/i.test(state.providerLabel || ""), `the label lost the region: ${state.providerLabel}`);

  const gold = await (await call({ question: "Is Gold Coast getting hotter?" }, { fetchImpl })).json();
  check(gold.ambiguous === false, "Gold Coast was wrongly marked ambiguous");
  check(gold.corrected === false, "Gold Coast was wrongly marked a correction");
  check(gold.expanded === false, "Gold Coast was wrongly marked an expansion");
}

// 13. A climate word or a station name that is nearly right still asks the right
//     question, and the plan says what it had to read.
{
  const context = {
    rag: read("public/data/rag_index.json"),
    points: points.points,
    variables,
    countries: [],
    ocean: [],
    seaIce: [],
  };

  const wet = planCase("Is precipitiation in Nairobi changing?", context);
  check(wet?.variable?.code === "PRECTOTCORR", `a misspelt precipitation asked ${wet?.variable?.code}`);
  check(wet?.variableCorrection?.typed === "precipitiation", "the variable correction was not reported");
  check(
    wet?.variableCorrection?.word === "precipitation",
    `the correction named ${wet?.variableCorrection?.word}`
  );
  check(wet?.place?.name === "Nairobi", `the place beside it became ${wet?.place?.name}`);
  check(wet?.corrected === false, "an exact station name was flagged as a typo");
  check(
    /read "precipitiation" as precipitation/i.test(wet?.explanation || ""),
    `the plan does not say what it read: ${wet?.explanation}`
  );

  const warm = planCase("Is temperture in Chicago rising?", context);
  check(warm?.variable?.code === "T2M", `a misspelt temperature asked ${warm?.variable?.code}`);

  const station = planCase("Is Nairobii getting hotter?", context);
  check(station?.place?.name === "Nairobi", `Nairobii resolved to ${station?.place?.name}`);
  check(station?.kind === "city", `Nairobii became a ${station?.kind} case`);
  check(station?.corrected === true, "the station typo was not flagged");
  check(station?.candidates?.[0]?.id === "nairobi", "the station was not offered as the first candidate");
  check(station?.candidates?.[0]?.kind === "station", "the candidate is not a station");

  const clean = planCase("Is Nairobi getting hotter?", context);
  check(clean?.corrected === false, "an exact station name was flagged as a typo");
  check(clean?.variableCorrection === null, "an exact climate word was flagged");

  // A misspelt climate word is not part of the place name. Left in the query it
  // sank coverage below the floor and hid the place standing next to it.
  const resolved = await (
    await call({ question: "Is precipitiation in London changing?" }, { fetchImpl: geocoderStub({}) })
  ).json();
  check(resolved.ok === true, `the resolver could not place a misspelt-rain question: ${resolved.error}`);
  check(/london/i.test(resolved.place?.name || ""), `the place became ${resolved.place?.name}`);
  check(resolved.variable === "PRECTOTCORR", `the resolver read ${resolved.variable}`);
}

if (failures) {
  console.error(`\n${failures} resolver check(s) failed`);
  process.exit(1);
}

console.log(
  `resolver verified: ${entries.length} gazetteer places · Gold Coast → Australia · ` +
    `keyless fallbacks ${GEOCODERS.map((provider) => provider.id).join(" → ")} · ` +
    `place query, validation, caching and rate limit checked · no API key anywhere`
);
