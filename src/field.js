// Derived cases: a question about a place the bundle does not hold.
//
// The planner (`rag.js`) answers from the 708 stations, 222 country averages,
// nine ocean basins and three sea-ice records. When a question names none of
// them ("Is Gold Coast getting hotter?") it falls back to the global field and
// says so. This module asks the resolver for a coordinate instead, and the app
// then answers from the GISTEMP field at that coordinate — a derived case.
//
// What comes back is a place and two numbers. No trend, no verdict: those are
// computed from the cached field by the same code as every other case. The
// resolver is a gazetteer first and a keyless public geocoder second, so there is
// nothing to configure — no key ever reaches this module.

import { indexGazetteer, matchGazetteer, readIntent } from "../worker/resolve.js";

const RESOLVE_TIMEOUT_MS = 15_000;
const GAZETTEER_TIMEOUT_MS = 10_000;

function endpoint(path) {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${String(path).replace(/^\/+/, "")}`;
}

/**
 * The place, matched in this page from the gazetteer the bundle already ships.
 *
 * A static host has no `/api/resolve`, but it does have the same 6,421-place
 * Natural Earth table the resolver reads, sitting unused in `public/data`. Loading
 * it here — once, lazily, and only after the server path has failed — lets "Is
 * Gold Coast getting hotter?" open a derived case on GitHub Pages exactly as it
 * does on the Worker. Suburbs and spelling variants still need the Worker: the
 * keyless geocoders live there, not in the page.
 *
 * Returns the same shape as `resolveQuestion`, or null when nothing matches.
 */
let gazetteerEntries = null;

async function localPlace(question, fetchImpl) {
  if (!gazetteerEntries) {
    try {
      const response = await fetchImpl(endpoint("/data/gazetteer.json"), {
        signal: AbortSignal.timeout(GAZETTEER_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload?.places || [];
      gazetteerEntries = indexGazetteer(rows);
    } catch {
      return null;
    }
  }

  const match = matchGazetteer(question, gazetteerEntries);
  if (!match?.place) return null;
  const intent = readIntent(question);
  return {
    ok: true,
    place: {
      name: match.place.name,
      country: match.place.country,
      detail: "",
      lat: match.place.lat,
      lon: match.place.lon,
    },
    source: "gazetteer",
    provider: null,
    providerLabel: "the bundled Natural Earth gazetteer",
    attribution: "Natural Earth populated places, public domain",
    note: "This page placed the name from its bundled gazetteer; the GISTEMP field supplies the numbers.",
    variable: intent.variable,
    windowKey: intent.windowKey,
  };
}

export function isResolvablePlan(plan) {
  // A global plan the question did not ask for is the planner saying
  // "I found no place in this question".
  return Boolean(plan) && plan.kind === "global" && plan.resolved === false;
}

/**
 * Ask the resolver to place the question.
 *
 * Returns `{ ok: true, place, source, model, note, variable, windowKey }` or
 * `{ ok: false, error, detail }`. Never throws: an unresolved place is a case
 * that cannot be opened, not a broken page.
 */
export async function resolveQuestion(question, { fetchImpl = fetch } = {}) {
  const clean = String(question || "").trim();
  if (!clean) return { ok: false, error: "empty_question" };
  let response;
  try {
    response = await fetchImpl(endpoint("/api/resolve"), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ question: clean }),
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    if (!timeout) {
      const local = await localPlace(clean, fetchImpl);
      if (local) return local;
    }
    return { ok: false, error: timeout ? "resolver_timeout" : "resolver_unreachable" };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    const local = await localPlace(clean, fetchImpl);
    if (local) return local;
    return { ok: false, error: "resolver_unreadable", status: response.status };
  }

  if (!response.ok || !payload?.ok) {
    // 404/405 is a static host refusing the route, not the resolver's own
    // answer (that is a 4xx JSON error, which localPlace cannot improve on).
    if (response.status === 404 || response.status === 405) {
      const local = await localPlace(clean, fetchImpl);
      if (local) return local;
    }
    return {
      ok: false,
      error: payload?.error || `resolver_${response.status}`,
      detail: payload?.detail || "",
      status: response.status,
    };
  }

  const place = payload.place || {};
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ok: false, error: "place_coordinate_invalid" };
  }

  return {
    ok: true,
    place: {
      name: String(place.name || clean).slice(0, 80),
      country: String(place.country || "").slice(0, 60),
      detail: String(place.detail || "").slice(0, 80),
      lat,
      lon,
    },
    source: payload.source === "geocoder" ? "geocoder" : "gazetteer",
    provider: payload.provider || null,
    providerLabel: payload.providerLabel || "",
    attribution: payload.attribution || "",
    note: payload.note || "",
    variable: payload.variable || "T2M",
    windowKey: payload.windowKey || "1990-2025",
  };
}

/**
 * The plan card for a derived case. Shaped like the planner's plan so the same
 * renderer draws it, with `kind: "derived"` so running it takes the field path.
 */
export function derivedPlan(resolution) {
  if (!resolution?.ok) return null;
  return {
    kind: "derived",
    resolved: true,
    question: resolution.place.name,
    place: resolution.place,
    variable: { code: "GISTEMP", short: "Surface air temperature", units: "°C" },
    windowKey: resolution.windowKey,
    confidence: resolution.source === "gazetteer" ? 0.74 : 0.68,
    explanation:
      `"${resolution.place.name.toLowerCase()}" is not one of the bundle's stations, ` +
      `so this case is the GISTEMP field over its coordinate` +
      (resolution.place.country ? ` (${resolution.place.country})` : ""),
    sources: `NASA GISTEMP v4 · nearest 4° cell to ${resolution.place.name} · baseline 1951–1980`,
    cities: [],
    alternatives: [],
    note: resolution.note,
    resolution,
  };
}

export function describeFailure(result) {
  switch (result?.error) {
    case "place_not_found":
      return "The resolver could not place that name. Try adding the country or region.";
    case "rate_limited":
      return "The resolver is rate limited. Try again in a minute.";
    case "resolver_timeout":
      return "The resolver timed out. The app still works with the cached bundle.";
    case "resolver_unreachable":
    case "resolver_unreadable":
      return "No resolver server is reachable here, and the bundled gazetteer does not carry that name. Try a larger nearby city — suburbs and spelling variants need the Worker deployment.";
    default:
      return result?.detail || "The place could not be resolved.";
  }
}
