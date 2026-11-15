// Live current conditions for the app's points, proxied server-side so the
// Meteomatics credentials never reach the browser.
//
// This module is shared by the Workers entry (worker/index.js) and the Vite
// dev/preview middleware, so both paths run the same validation, cache and
// normalisation code.

const METEOMATICS_BASE = "https://api.meteomatics.com";
const PARAMETERS = "t_2m:C,precip_1h:mm,wind_speed_10m:ms";
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 32;
const MAX_COORDINATES_PER_QUERY = 25;
const UPSTREAM_TIMEOUT_MS = 15_000;
// A case asks for one point, so a bounded set per request costs nothing the app
// uses and stops one visitor from asking for the whole bundle on every call.
const MAX_IDS_PER_REQUEST = 60;
const MAX_IDS_QUERY_LENGTH = 2_000;
// The upstream is metered at 1,000 queries a day. Budgeting the coordinates a
// minute (not the requests) is what actually bounds that spend, because one
// request for 708 points is 29 upstream queries all by itself.
const MAX_COORDINATES_PER_MINUTE = 1_000;
const RATE_WINDOW_MS = 60_000;
const CACHE_HEADERS = { "cache-control": "public, max-age=120, s-maxage=300" };

const cache = new Map();
const spends = [];

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

// Only a cache miss reaches upstream, so only a miss spends the budget.
function takeBudget(coordinates, now) {
  while (spends.length && now.getTime() - spends[0].at > RATE_WINDOW_MS) spends.shift();
  const used = spends.reduce((total, entry) => total + entry.coordinates, 0);
  if (used + coordinates > MAX_COORDINATES_PER_MINUTE) return false;
  spends.push({ at: now.getTime(), coordinates });
  return true;
}

export function hourStamp(date) {
  const hour = Math.floor(date.getTime() / 3_600_000) * 3_600_000;
  return new Date(hour).toISOString().replace(".000Z", "Z");
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function nearestPoint(points, lat, lon) {
  let best = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.abs(point.lat - lat) + Math.abs(point.lon - lon);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  // Meteomatics echoes the requested coordinates; allow for rounding.
  return bestDistance <= 0.02 ? best : null;
}

function reading(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= -998) return null;
  return number;
}

function mergePayload(payload, group, into) {
  for (const block of payload?.data || []) {
    const parameter = block?.parameter;
    if (!parameter) continue;
    for (const coordinate of block.coordinates || []) {
      const point = nearestPoint(group, Number(coordinate.lat), Number(coordinate.lon));
      if (!point) continue;
      const first = coordinate.dates?.[0];
      const readings = into[point.id] || (into[point.id] = {});
      if (first?.date) readings.valid_time = first.date;
      const value = reading(first?.value);
      if (value === null) continue;
      if (parameter === "t_2m:C") readings.t_2m = value;
      if (parameter === "precip_1h:mm") readings.precip_1h = value;
      if (parameter === "wind_speed_10m:ms") readings.wind_speed_10m = value;
    }
  }
}

async function fetchChunk(points, stamp, { username, password, fetchImpl }) {
  const locations = points.map((point) => `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`).join("+");
  const url = `${METEOMATICS_BASE}/${stamp}/${PARAMETERS}/${locations}/json`;
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Basic ${btoa(`${username}:${password}`)}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`Meteomatics returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/**
 * @param {Request} request
 * @param {{points: Array<{id: string, lat: number, lon: number}>,
 *          username?: string, password?: string,
 *          fetchImpl?: typeof fetch, now?: () => Date}} options
 */
export async function handleLive(request, options) {
  const { points = [], username, password, fetchImpl = fetch, now = () => new Date() } = options;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { allow: "GET" });
  }

  const allowed = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  const requested = url.searchParams.get("ids");
  if (requested && requested.length > MAX_IDS_QUERY_LENGTH) {
    return jsonResponse({ ok: false, error: "ids_too_long" }, 400, { "cache-control": "no-store" });
  }
  const wanted = requested
    ? new Set(
        requested
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      )
    : null;
  if (wanted && wanted.size > MAX_IDS_PER_REQUEST) {
    return jsonResponse(
      { ok: false, error: "too_many_points", limit: MAX_IDS_PER_REQUEST },
      400,
      { "cache-control": "no-store" }
    );
  }
  const selected = wanted ? allowed.filter((point) => wanted.has(point.id)) : allowed;
  // Sorted, so `?ids=b,a` and `?ids=a,b` are one cache entry instead of two: an
  // order-sensitive key let anyone double the metered spend for free.
  if (wanted) selected.sort((one, other) => (one.id < other.id ? -1 : one.id > other.id ? 1 : 0));

  if (!selected.length) {
    return jsonResponse({ ok: false, error: "no_matching_points" }, 400, { "cache-control": "no-store" });
  }

  if (!username || !password) {
    return jsonResponse(
      {
        ok: false,
        error: "live_unconfigured",
        detail: "METEOMATICS_USERNAME and METEOMATICS_PASSWORD are not set for this environment.",
      },
      503,
      { "cache-control": "no-store" }
    );
  }

  const current = now();
  const stamp = hourStamp(current);
  const cacheKey = `${stamp}|${selected.map((point) => point.id).join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached && current.getTime() - cached.storedAt < CACHE_TTL_MS) {
    return jsonResponse({ ...cached.body, cache: "hit" }, 200, CACHE_HEADERS);
  }

  if (!takeBudget(selected.length, current)) {
    return jsonResponse(
      {
        ok: false,
        error: "rate_limited",
        detail: `At most ${MAX_COORDINATES_PER_MINUTE} upstream coordinates a minute.`,
      },
      429,
      { "cache-control": "no-store", "retry-after": "60" }
    );
  }

  const readings = {};
  try {
    for (const group of chunk(selected, MAX_COORDINATES_PER_QUERY)) {
      const payload = await fetchChunk(group, stamp, { username, password, fetchImpl });
      mergePayload(payload, group, readings);
    }
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return jsonResponse(
      {
        ok: false,
        error: timeout ? "upstream_timeout" : "upstream_unavailable",
        upstream_status: Number.isFinite(error?.status) ? error.status : null,
      },
      timeout ? 504 : 502,
      { "cache-control": "no-store" }
    );
  }

  const body = {
    ok: true,
    source: "Meteomatics",
    valid_time: stamp,
    fetched_at: current.toISOString(),
    points: readings,
  };

  cache.set(cacheKey, { storedAt: current.getTime(), body });
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }

  return jsonResponse({ ...body, cache: "miss" }, 200, CACHE_HEADERS);
}
