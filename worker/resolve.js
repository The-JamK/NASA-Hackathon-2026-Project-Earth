// Resolver for questions the bundle cannot place: "Is Gold Coast getting hotter?"
//
// The bundle holds 708 stations. A question about a place outside that network
// has no case file — but it still has a coordinate, and the GISTEMP field covers
// every coordinate. This module turns a place name into a latitude and longitude
// and hands the coordinate back to the app, which then answers from the field.
//
// Two resolvers, in this order:
//   1. the gazetteer — 6,400-odd Natural Earth populated places, matched locally.
//      Free, deterministic, and it answers most questions without touching the
//      network at all.
//   2. keyless public geocoders — Open-Meteo first (no key, CC BY 4.0, under
//      10,000 calls/day), then OpenStreetMap's Nominatim (no key, but its policy
//      requires a User-Agent that names the app and at most 1 request/second).
//      They cover names the gazetteer does not carry: suburbs, hamlets,
//      alternate spellings.
//
// No API key is involved anywhere, so the feature works on a Worker with no
// secrets configured. Nothing here computes a trend: the coordinate goes to the
// same deterministic statistics every other case uses, and the model never
// existed — a geocoder is both cheaper and better at this job than a language
// model.
//
// This file is shared by the Workers entry (worker/index.js) and the Vite
// dev/preview middleware, so both paths run identical validation and caching.

import { chooseWindow, climateTypo, editDistance, parseTime, variableFromQuestion } from "../src/rag.js";

const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_QUESTION_LENGTH = 240;
const MAX_PLACE_QUERY = 80;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 128;
// A shared community service sits behind this: Nominatim allows one request per
// second for the whole application, and a public endpoint should not let one
// visitor spend the demo's budget. Twenty lookups a minute is plenty for a room.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

// Nominatim's usage policy: a stock library User-Agent is not acceptable, and a
// request without one may be blocked.
const USER_AGENT =
  "signal-and-noise-case-files/0.2 (+https://github.com/The-JamK/NASA-Hackathon-2026-Project-Earth)";

export const GEOCODERS = [
  {
    id: "open-meteo",
    label: "Open-Meteo geocoding",
    attribution: "Open-Meteo, CC BY 4.0",
    url: (query) =>
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        query
      )}&count=1&language=en&format=json`,
    headers: { accept: "application/json" },
    read(payload) {
      const hit = payload?.results?.[0];
      if (!hit) return null;
      return {
        name: hit.name,
        country: hit.country || hit.country_code || "",
        lat: Number(hit.latitude),
        lon: Number(hit.longitude),
        detail: [hit.admin2, hit.admin1].filter(Boolean).join(", "),
      };
    },
  },
  {
    id: "nominatim",
    label: "OpenStreetMap Nominatim",
    attribution: "© OpenStreetMap contributors, ODbL",
    url: (query) =>
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        query
      )}&format=jsonv2&limit=1&addressdetails=0`,
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    read(payload) {
      const hit = Array.isArray(payload) ? payload[0] : null;
      if (!hit) return null;
      const parts = String(hit.display_name || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return {
        name: hit.name || parts[0] || "",
        country: parts.length > 1 ? parts[parts.length - 1] : "",
        lat: Number(hit.lat),
        lon: Number(hit.lon),
        detail: parts.slice(1, -1).join(", "),
      };
    },
  },
];

const IGNORED_NAMES = new Set([
  "world",
  "earth",
  "planet",
  "global",
  "globe",
  "everywhere",
  "climate",
  "weather",
  "temperature",
  "rainfall",
  "ocean",
  "sea",
  "ice",
]);

// Words that ask the question rather than name the place, plus the climate
// vocabulary the variable already decides. Removing both leaves the place name:
// "Is Gold Coast getting hotter?" -> "gold coast".
const QUESTION_WORDS = new Set(
  (
    "is are was were be been being the a an does do did has have had will would can could should " +
    "what how which why who where when and or of in at on for to from since through between about " +
    "there here it its this that these those more less get gets got getting become becomes becoming " +
    "trend trends changed change changing out than then over under during by across near around into onto"
  ).split(" ")
);
const CLIMATE_WORDS = new Set(
  (
    "temperature temp warming warmed warmer warm hottest hot hotter cooling cooled cold colder cool " +
    "heat degrees rainfall rain raining rainy precip precipitation wet wetter wetting dry drier drying " +
    "drought soil moisture wetness root agriculture land solar sun sunlight sunshine radiation " +
    "irradiance cloud clouds cloudiness bright brightening dimming"
  ).split(" ")
);

const cache = new Map();
const lookups = [];

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/** Lowercase ASCII, single-spaced, so "Reykjavík" and "Reykjavik" meet. */
export function foldPlace(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The place name inside a question, with the question and the variable removed. */
export function placeQuery(question) {
  const kept = foldPlace(question)
    .split(" ")
    .filter(
      (token) =>
        token &&
        !QUESTION_WORDS.has(token) &&
        !CLIMATE_WORDS.has(token) &&
        // A misspelt climate word is not part of the place name; leaving it in
        // would drag coverage below the floor and hide a real place beside it.
        !climateTypo(token) &&
        !/^(19|20)\d{2}$/.test(token)
    );
  return kept.join(" ").trim().slice(0, MAX_PLACE_QUERY);
}

/**
 * Gazetteer rows -> matchable entries. Called once per isolate.
 *
 * Cities arrive as `[name, country, lat, lon, population, altNames]`; states and
 * provinces as `[name, country, lat, lon, type, altNames]`, where the label point
 * stands in for the division. Both become the same entry shape, tagged with the
 * kind so the answer can say whether it means a city or a state.
 */
export function indexGazetteer(rows = [], { kind = "place" } = {}) {
  const entries = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const [rawName, rawCountry, rawLat, rawLon, extra = 0, alt = ""] = row;
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    const name = String(rawName || "").trim();
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const keys = [name, ...String(alt || "").split(",")]
      .map(foldPlace)
      .filter((key) => key.length >= 3 && !IGNORED_NAMES.has(key));
    if (!keys.length) continue;
    entries.push({
      name,
      country: String(rawCountry || "").trim(),
      lat,
      lon,
      population: kind === "place" ? Number(extra) || 0 : 0,
      kind,
      subtype: kind === "region" ? String(extra || "").trim() : "",
      keys: [...new Set(keys)],
    });
  }
  return entries;
}

const PREFIX_MIN_QUERY = 5;
const MIN_COVERAGE = 0.6;

/** A name people keep in mind is a name they search for: "New York" over "York". */
function populationPrior(population) {
  return 0.25 * Math.min(1, Math.log10((Number(population) || 0) + 1) / 7);
}

/**
 * How well one gazetteer key fits the question, or null.
 *
 * - `exact` — the key appears as whole words ("gold coast").
 * - `exact` with initials — the question is a prefix and only abbreviations
 *   follow, which is how "washington" reaches "Washington, D.C.".
 * - `prefix` — the question is the start of a longer name ("san" -> San Diego).
 * - `compact` — the spaces were left out ("goldcoast").
 */
function rateKey(key, folded, place, compact) {
  // How much of the typed name a key accounts for. "gold coast" is covered by
  // "gold coast"; the Kenyan region "Coast" covers half of it and is not an
  // answer to that question.
  const coverage = Math.min(1, key.length / Math.max(place.length, 1));
  if (` ${folded} `.includes(` ${key} `)) return { base: 1, match: "exact", coverage };
  if (place.length >= PREFIX_MIN_QUERY && key.startsWith(`${place} `)) {
    const extra = key.slice(place.length).trim().split(" ").filter(Boolean);
    const initials = extra.length > 0 && extra.every((word) => word.length <= 3);
    // "washington" only reaches "Washington, D.C." because the rest is initials,
    // and the reader deserves to see that expansion rather than be told it.
    return initials
      ? { base: 0.98, match: "expanded", coverage: 1 }
      : { base: 0.9, match: "prefix", coverage: 1 };
  }
  const compactKey = key.replace(/ /g, "");
  // Dropping the spaces is the whole test: "goldcoast" is "gold coast" with the
  // space removed. A key that only sits inside the typed word is a different,
  // shorter name — "Guandong" contains "Andong", and that is not an unspaced
  // match of Andong.
  if (compact === compactKey) {
    return { base: 0.85, match: "compact", coverage: 1 };
  }
  return null;
}

/** A typo, not a different place: only run when nothing else matched. */
function rateTypo(key, compact) {
  const compactKey = key.replace(/ /g, "");
  const longest = Math.max(compact.length, compactKey.length);
  // "illonoisis" is three edits from "illinois" (o for i, then the doubled
  // ending), so the budget has to grow with the word: one edit per five letters.
  const limit = longest >= 10 ? 3 : longest >= 7 ? 2 : longest >= 5 ? 1 : 0;
  if (!limit) return null;
  const distance = editDistance(compact, compactKey, limit);
  if (!distance || distance > limit) return null;
  // A misspelling rarely changes the first letter, and two different names that
  // share a tail are not typos of each other: "Andalucia" (absent from the
  // layer) was matching "Santa Lucía" three edits in. One edit is still allowed
  // to touch the first letter, because "Kairobi" is a typo of Nairobi.
  if (distance >= 2 && compact[0] !== compactKey[0]) return null;
  // A whole extra ending is a different name, not a misspelling: "Normandy" is
  // not "Norman" with two letters left over.
  const [shorter, longer] = compact.length <= compactKey.length ? [compact, compactKey] : [compactKey, compact];
  if (longer.length - shorter.length >= 2 && longer.startsWith(shorter)) return null;
  return {
    base: 0.75 * (1 - distance / longest),
    match: "typo",
    distance,
    keyLength: compactKey.length,
    coverage: Math.min(1, compactKey.length / Math.max(compact.length, 1)),
  };
}

/**
 * Every plausible place for a question, best first.
 *
 * Searching returns a list rather than one answer because a name alone is
 * ambiguous — there are 20-odd Washingtons — and because a near miss ("illonoisis")
 * should come back with what it probably meant instead of a refusal. The caller
 * decides whether to use the best one silently or to ask.
 */
export function searchPlaces(question, entries = [], { limit = 4 } = {}) {
  const folded = foldPlace(question);
  if (folded.length < 3 || !entries.length) return [];
  // The name the question is about, with the question and the variable removed:
  // "Is Washington getting hotter?" -> "washington". Fuzzy and prefix matching
  // work on this, never on the whole sentence, or every name would look like a
  // typo of "is ... getting hotter".
  const place = placeQuery(question) || folded;
  const compact = place.replace(/ /g, "");
  const found = new Map();

  const consider = (entry, hit) => {
    // A fragment is not a place: the key has to account for most of the name the
    // question actually used.
    if ((hit.coverage ?? 1) < MIN_COVERAGE) return;
    const id = `${foldPlace(entry.name)}|${foldPlace(entry.country)}|${entry.kind}`;
    // How many people live somewhere says which of several same-named places is
    // meant (Washington, D.C. over the state), not which of several differently
    // spelled names a typo meant. Ranking a repair by population sent
    // "Guandong" to Andong and "Cataonia" to Catania, so a repair is ranked by
    // how much of the word it has to change — and a state breaks an exact tie
    // with a town, because that is the larger thing to be wrong about.
    const score =
      hit.match === "typo"
        ? hit.base +
          0.05 * (1 - Math.abs(hit.keyLength - compact.length) / Math.max(hit.keyLength, compact.length, 1)) +
          (entry.kind === "region" ? 0.01 : 0)
        : hit.base + populationPrior(entry.population);
    const current = found.get(id);
    if (current && current.score >= score) return;
    found.set(id, { entry, score, match: hit.match, distance: hit.distance || 0 });
  };

  for (const entry of entries) {
    for (const key of entry.keys) {
      const hit = rateKey(key, folded, place, compact);
      if (hit) consider(entry, hit);
    }
  }

  if (!found.size) {
    for (const entry of entries) {
      for (const key of entry.keys) {
        const hit = rateTypo(key, compact);
        if (hit) consider(entry, hit);
      }
    }
  }

  return [...found.values()]
    .sort((a, b) => b.score - a.score || b.entry.population - a.entry.population)
    .slice(0, limit);
}

/** The best single match, in the shape the older callers expect. */
export function matchGazetteer(question, entries = []) {
  const [best] = searchPlaces(question, entries, { limit: 1 });
  if (!best) return null;
  return { place: best.entry, alias: best.entry.keys[0], match: best.match, rank: [best.score, best.entry.population] };
}

/** The public face of a candidate: enough to build a case without another call. */
export function candidateOf(item) {
  return {
    name: item.entry.name,
    country: item.entry.country,
    lat: item.entry.lat,
    lon: item.entry.lon,
    kind: item.entry.kind,
    subtype: item.entry.subtype,
    population: item.entry.population,
    score: Number(item.score.toFixed(3)),
    match: item.match,
  };
}

/** Two answers this close are both worth offering: that is the popup. */
export const AMBIGUITY_MARGIN = 0.12;

/** The variable and window the question asks for, from the app's own vocabulary. */
export function readIntent(question) {
  const time = parseTime(question);
  return {
    variable: variableFromQuestion(question) || "T2M",
    windowKey: chooseWindow(time, ["1990-2025", "2000-2025", "2010-2025"]),
    time,
  };
}

/** A coordinate from a geocoder is data, not a claim: it has to survive this. */
export function validatePlace(payload) {
  if (!payload || typeof payload !== "object") return null;
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name || name.length > 80) return null;
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const country = typeof payload.country === "string" ? payload.country.trim().slice(0, 60) : "";
  const detail = typeof payload.detail === "string" ? payload.detail.trim().slice(0, 80) : "";
  return { name, country, lat, lon, detail };
}

/**
 * Ask each keyless geocoder in turn. A provider that errors, times out or returns
 * something unusable is skipped rather than reported as "no such place", so one
 * busy service does not become a false negative.
 */
export async function searchGeocoder(query, { fetchImpl = fetch, providers = GEOCODERS } = {}) {
  let failure = null;
  for (const provider of providers) {
    let payload;
    try {
      const response = await fetchImpl(provider.url(query), {
        headers: provider.headers,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!response.ok) {
        failure = { kind: "http", provider: provider.id, status: response.status };
        continue;
      }
      payload = await response.json();
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      failure = { kind: timeout ? "timeout" : "network", provider: provider.id };
      continue;
    }
    const place = validatePlace(provider.read(payload));
    if (place) return { place, provider, failure };
  }
  return { place: null, provider: null, failure };
}

function takeBudget(now) {
  while (lookups.length && now.getTime() - lookups[0] > RATE_WINDOW_MS) lookups.shift();
  if (lookups.length >= RATE_LIMIT) return false;
  lookups.push(now.getTime());
  return true;
}

/**
 * @param {Request} request
 * @param {{places?: Array<Array<unknown>>, entries?: Array<object>,
 *          providers?: Array<object>, fetchImpl?: typeof fetch,
 *          now?: () => Date}} options
 */
export async function handleResolve(request, options = {}) {
  const {
    places = [],
    regions = [],
    entries: providedEntries,
    providers = GEOCODERS,
    fetchImpl = fetch,
    now = () => new Date(),
  } = options;

  const entries =
    providedEntries ||
    [...indexGazetteer(places), ...indexGazetteer(regions, { kind: "region" })];

  if (request.method === "GET") {
    // A capability probe: which resolvers are available, and how many places the
    // gazetteer holds. No key, so nothing here is secret.
    return jsonResponse(
      {
        ok: true,
        places: entries.length,
        providers: providers.map((provider) => provider.id),
        attribution: providers.map((provider) => provider.attribution),
      },
      200,
      { "cache-control": "no-store" }
    );
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { allow: "POST, GET" });
  }

  let question = "";
  try {
    const body = await request.json();
    question = String(body?.question || "").trim();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400, { "cache-control": "no-store" });
  }
  if (!question) {
    return jsonResponse({ ok: false, error: "empty_question" }, 400, { "cache-control": "no-store" });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return jsonResponse(
      { ok: false, error: "question_too_long", limit: MAX_QUESTION_LENGTH },
      400,
      { "cache-control": "no-store" }
    );
  }

  const intent = readIntent(question);
  const current = now();
  const cacheKey = `${foldPlace(question)}|${intent.windowKey}`;
  const cached = cache.get(cacheKey);
  if (cached && current.getTime() - cached.storedAt < CACHE_TTL_MS) {
    return jsonResponse({ ...cached.body, cache: "hit" }, 200);
  }

  const candidates = searchPlaces(question, entries);
  const local = candidates[0] || null;
  const base = {
    ok: true,
    question,
    variable: intent.variable,
    windowKey: intent.windowKey,
    derived: true,
    topicOnly: intent.variable !== "T2M",
  };

  if (local) {
    const region = local.entry.kind === "region";
    const body = {
      ...base,
      place: {
        name: local.entry.name,
        country: local.entry.country,
        lat: local.entry.lat,
        lon: local.entry.lon,
        kind: local.entry.kind,
        subtype: local.entry.subtype,
      },
      source: "gazetteer",
      provider: null,
      providerLabel: region
        ? `the Natural Earth gazetteer (${(local.entry.subtype || "region").toLowerCase()})`
        : "the Natural Earth gazetteer",
      attribution: "Natural Earth populated places and admin-1 boundaries, public domain",
      note: region
        ? `Read as ${local.entry.subtype || "a state or province"}; the GISTEMP field supplies the numbers at its centre.`
        : "Place resolved from the Natural Earth gazetteer; the GISTEMP field supplies the numbers.",
      candidates: candidates.map(candidateOf),
      // Two possible meanings: the runner-up is close enough to be plausible.
      ambiguous: candidates.length > 1 && candidates[1].score >= local.score - AMBIGUITY_MARGIN,
      // The answer is a name the question did not spell out ("washington" ->
      // Washington, D.C.), so it has to be shown, not assumed.
      expanded: local.match === "expanded" || local.match === "prefix",
      corrected: local.match === "typo",
    };
    cache.set(cacheKey, { storedAt: current.getTime(), body });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return jsonResponse({ ...body, cache: "miss" }, 200);
  }

  const query = placeQuery(question);
  if (!query) {
    return jsonResponse(
      { ok: false, error: "place_not_found", detail: "No place name was found in the question." },
      422,
      { "cache-control": "no-store" }
    );
  }

  if (!takeBudget(current)) {
    return jsonResponse(
      {
        ok: false,
        error: "rate_limited",
        detail: `At most ${RATE_LIMIT} place lookups per minute.`,
      },
      429,
      { "cache-control": "no-store", "retry-after": "60" }
    );
  }

  const found = await searchGeocoder(query, { fetchImpl, providers });

  if (!found.place) {
    // Every provider failed to answer at all: that is an outage, not a missing place.
    if (found.failure) {
      const timeout = found.failure.kind === "timeout";
      return jsonResponse(
        {
          ok: false,
          error: timeout ? "resolver_timeout" : "resolver_unavailable",
          provider: found.failure.provider,
          upstream_status: Number.isFinite(found.failure.status) ? found.failure.status : null,
        },
        timeout ? 504 : 502,
        { "cache-control": "no-store" }
      );
    }
    return jsonResponse(
      {
        ok: false,
        error: "place_not_found",
        detail: `No gazetteer place or geocoder match for "${query}". Try adding the country or region.`,
        query,
      },
      422,
      { "cache-control": "no-store" }
    );
  }

  const body = {
    ...base,
    place: {
      name: found.place.name,
      country: found.place.country,
      lat: found.place.lat,
      lon: found.place.lon,
      detail: found.place.detail,
    },
    source: "geocoder",
    provider: found.provider.id,
    providerLabel: found.provider.label,
    attribution: found.provider.attribution,
    note: `Coordinates from ${found.provider.label} (${found.provider.attribution}); the GISTEMP field supplies the numbers.`,
    candidates: [],
    ambiguous: false,
    corrected: false,
  };
  cache.set(cacheKey, { storedAt: current.getTime(), body });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return jsonResponse({ ...body, cache: "miss" }, 200);
}
