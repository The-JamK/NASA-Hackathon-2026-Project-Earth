// The public surface has three ways to be abused, and each one is pinned here:
//
//   1. a place name that comes back from a keyless public geocoder is drawn into
//      the derived case narrative, so it has to be escaped where it is drawn;
//   2. /api/live spends a metered Meteomatics quota, so a caller must not be able
//      to ask for the whole bundle in a loop;
//   3. /api/resolve parses a JSON body, so an oversized one is refused unread.
//
// Plus the one place a Cloudflare token is allowed to appear in CI. There is no
// browser here: the escaping check reads the render site, and the resolver test
// proves the hostile name really does reach the page, so the escape is the guard
// rather than luck.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleLive } from "../worker/live.js";
import { handleResolve } from "../worker/resolve.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(condition, message) {
  if (condition) return;
  console.error(`FAIL: ${message}`);
  failures += 1;
}

/* ------------------------------------------- 1. the name is escaped where drawn */

const main = readFileSync(resolve(ROOT, "src", "main.js"), "utf8");
const start = main.indexOf("function derivedNarrative(");
const end = main.indexOf("\nfunction ", start + 1);
const narrative = start === -1 ? "" : main.slice(start, end === -1 ? undefined : end);
check(narrative.length > 0, "derivedNarrative is missing from src/main.js");

const draws = [...narrative.matchAll(/\$\{([^}]*place\.name[^}]*)\}/g)].map((match) => match[1].trim());
check(draws.length >= 2, `derivedNarrative draws place.name ${draws.length} time(s), expected 2`);
for (const draw of draws) {
  check(
    draw.startsWith("escapeHtml"),
    `derivedNarrative draws place.name without escaping it: \${${draw.replace(/\s+/g, " ").slice(0, 60)}}`
  );
}

// The hostile string has to survive the resolver to be a real risk — otherwise
// the escaping test above would be protecting nothing.
const HOSTILE = "<img src=x onerror=alert(1)>";
const stubProvider = {
  id: "stub",
  label: "stub geocoder",
  attribution: "stub",
  url: (query) => `https://stub.example/search?q=${encodeURIComponent(query)}`,
  headers: { accept: "application/json" },
  read(payload) {
    return { name: payload[0].name, country: "Testland", lat: Number(payload[0].lat), lon: Number(payload[0].lon) };
  },
};
const hostileResponse = await handleResolve(
  new Request("https://case.example/api/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "Is Nowhereville getting hotter?" }),
  }),
  {
    entries: [],
    providers: [stubProvider],
    fetchImpl: async () =>
      new Response(JSON.stringify([{ name: HOSTILE, display_name: `${HOSTILE}, Testland`, lat: "1", lon: "2" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  }
);
check(hostileResponse.status === 200, `the hostile-name resolver call returned ${hostileResponse.status}`);
const hostileBody = await hostileResponse.json();
check(
  hostileBody.place?.name === HOSTILE,
  "the resolver no longer passes a geocoder name through, so the escape check above proves nothing"
);

/* ---------------------------------------- 2. the metered upstream is budgeted */

const points = Array.from({ length: 1400 }, (_, index) => ({
  id: `p${index}`,
  lat: 0.5 + index * 0.001,
  lon: 0.25 + index * 0.001,
}));
const at = new Date("2026-11-15T09:20:00Z");
const now = () => at;
const creds = { username: "user", password: "pass" };

// Meteomatics echoes the coordinates it was asked for, and the proxy maps them
// back onto bundle ids; the stub reads them out of the URL so a wrong chunk shows
// up as a lost reading.
function stub() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const asked = segments[2].split("+").map((pair) => {
      const [lat, lon] = pair.split(",").map(Number);
      return { lat, lon, dates: [{ date: "2026-11-15T09:00:00Z", value: 20 }] };
    });
    return new Response(JSON.stringify({ data: [{ parameter: "t_2m:C", coordinates: asked }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

const live = (query, options = {}) => handleLive(new Request(`https://case.example/api/live${query}`), options);

// 2a. An explicit id list is capped, and a capped list costs nothing.
{
  const { calls, fetchImpl } = stub();
  const ids = Array.from({ length: 200 }, (_, index) => `p${index}`).join(",");
  const response = await live(`?ids=${ids}`, { points, ...creds, fetchImpl, now });
  const body = await response.json();
  check(response.status === 400, `a 200-id request returned ${response.status}`);
  check(body.error === "too_many_points", `a 200-id request reported ${body.error}`);
  check(calls.length === 0, `a capped id list still spent ${calls.length} upstream quer(y/ies)`);
  check(
    response.headers.get("x-content-type-options") === "nosniff",
    "the JSON answer does not carry x-content-type-options"
  );
}

// 2b. Duplicate and reordered ids are one cache entry, not three.
{
  const { calls, fetchImpl } = stub();
  const first = await live("?ids=p5,p4", { points, ...creds, fetchImpl, now });
  check(first.status === 200, `a two-point request returned ${first.status}`);
  check(calls.length === 1, `two points cost ${calls.length} upstream queries, expected 1`);
  const reordered = await live("?ids=p4,p5", { points, ...creds, fetchImpl, now });
  check((await reordered.json()).cache === "hit", "reordering the same ids missed the cache");
  const duplicated = await live("?ids=p5,p5,p4", { points, ...creds, fetchImpl, now });
  check((await duplicated.json()).cache === "hit", "a duplicated id list missed the cache");
  check(calls.length === 1, `the same two points cost ${calls.length} upstream queries`);
}

// 2c. A loop over distinct points is budgeted by coordinates, not by request.
{
  const batches = 20;
  const perBatch = 60;
  let allowed = 0;
  let limited = 0;
  let upstream = 0;
  const cacheKeys = [];
  for (let batch = 0; batch < batches; batch += 1) {
    const ids = Array.from({ length: perBatch }, (_, index) => `p${100 + batch * perBatch + index}`).join(",");
    cacheKeys.push(`?ids=${ids}`);
    const { calls, fetchImpl } = stub();
    const response = await live(cacheKeys[cacheKeys.length - 1], { points, ...creds, fetchImpl, now });
    upstream += calls.length;
    if (response.status === 200) allowed += 1;
    if (response.status === 429) limited += 1;
    if (response.status !== 200 && response.status !== 429) {
      check(false, `a budgeted request returned ${response.status}`);
    }
  }
  check(allowed > 0 && limited > 0, `${batches} distinct 60-point requests were never rate limited`);
  check(allowed === 16, `${allowed} of ${batches} 60-point requests were allowed, expected 16 (1,000 coordinates)`);
  check(upstream === allowed * 3, `${upstream} upstream queries for ${allowed} allowed requests, expected 3 each`);
  // A cache hit is free, so an exhausted budget does not break a case that is
  // already warm.
  const { calls, fetchImpl } = stub();
  const warm = await live(cacheKeys[cacheKeys.length - 1 - (batches - allowed)], { points, ...creds, fetchImpl, now });
  check((await warm.json()).cache === "hit", "a warm case was refused once the budget was spent");
  check(calls.length === 0, "a cache hit still spent an upstream query");
}

/* --------------------------------------------- 3. the parsed body is bounded */

{
  let geocoderCalls = 0;
  const big = `Is ${"a".repeat(20_000)} getting hotter?`;
  const response = await handleResolve(
    new Request("https://case.example/api/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: big }),
    }),
    {
      entries: [],
      fetchImpl: async () => {
        geocoderCalls += 1;
        return new Response("{}", { status: 200 });
      },
    }
  );
  const body = await response.json();
  check(response.status === 413, `a 20 kB question body returned ${response.status}`);
  check(body.error === "body_too_large", `an oversized body reported ${body.error}`);
  check(geocoderCalls === 0, "an oversized body still reached the geocoder");
  check(
    response.headers.get("x-content-type-options") === "nosniff",
    "the resolver's error answer does not carry x-content-type-options"
  );
}

/* ------------------------------------------------ 4. CI hands the token narrowly */

const workflow = readFileSync(resolve(ROOT, ".github", "workflows", "deploy-worker.yml"), "utf8");
const lines = workflow.split(/\r?\n/);
check(
  !lines.some((line) => /^ {6}CLOUDFLARE_API_TOKEN:/.test(line)),
  "CLOUDFLARE_API_TOKEN is at job level, so `npm ci` and `npm run build` can read it"
);
check(
  lines.filter((line) => /^ {10}CLOUDFLARE_API_TOKEN:/.test(line)).length === 2,
  "the token is not scoped to exactly the check step and the deploy step"
);

if (failures) {
  console.error(`\n${failures} security check(s) failed`);
  process.exit(1);
}

console.log(
  `escaping: ${draws.length} place.name draws escaped; a hostile geocoder name reaches the page and is escaped at render`
);
console.log("live: 200-id list refused · reordered/duplicate ids are one cache entry · 1,000 coordinates a minute budgeted · hits free");
console.log("resolve: an oversized body is refused before it is parsed");
console.log("ci: CLOUDFLARE_API_TOKEN reaches only the check and deploy steps");
console.log("security verified");
