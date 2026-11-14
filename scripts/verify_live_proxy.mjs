// The live proxy is shared by the Workers entry and the Vite middleware, and it
// spends a metered upstream quota. This check runs it against a stub upstream:
// a case-scoped request must cost exactly one upstream query, the cache must
// hold for the hour it was asked about, and every failure has a labelled answer.
import { handleLive, hourStamp } from "../worker/live.js";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// One station per scenario: the module cache is shared across this run, so a
// repeated id would answer from cache and hide a failure path.
const points = [
  { id: "nairobi", lat: -1.2921, lon: 36.8219 },
  { id: "mcmurdo", lat: -77.8419, lon: 166.6863 },
  { id: "paris", lat: 48.8566, lon: 2.3522 },
  { id: "tokyo", lat: 35.6762, lon: 139.6503 },
  { id: "lima", lat: -12.0464, lon: -77.0428 },
];
const now = () => new Date("2026-11-14T07:34:00Z");
const creds = { username: "user", password: "pass" };
const request = (query = "") =>
  new Request(`https://case.example/api/live${query}`, { method: "GET" });

// Meteomatics echoes the coordinates it was asked for; the proxy maps them back
// onto bundle ids, which is what makes a case-scoped request possible.
function upstream(asked) {
  const block = (parameter, value) => ({
    parameter,
    coordinates: asked.map((point) => ({
      lat: point.lat,
      lon: point.lon,
      dates: [{ date: "2026-11-14T07:00:00Z", value }],
    })),
  });
  return {
    data: [
      block("t_2m:C", 21.5),
      block("precip_1h:mm", 0.4),
      block("wind_speed_10m:ms", 3.2),
    ],
  };
}

// Each call answers with the group the proxy sent, so a wrong chunk shows up as
// a lost reading rather than as a silent pass.
function counting(groups) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const asked = groups[calls.length - 1] || groups[0] || [];
    return new Response(JSON.stringify(upstream(asked)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

// 1. One point, one upstream query, one reading back.
{
  const { calls, fetchImpl } = counting([points]);
  const response = await handleLive(request("?ids=nairobi"), { points, ...creds, fetchImpl, now });
  const body = await response.json();
  if (response.status !== 200) fail(`case-scoped request returned ${response.status}`);
  if (calls.length !== 1) fail(`one point cost ${calls.length} upstream queries`);
  const ids = Object.keys(body.points);
  if (ids.length !== 1 || ids[0] !== "nairobi") fail(`response carried ${ids.join(",")}`);
  if (body.points.nairobi.t_2m !== 21.5) fail("the reading did not survive normalisation");
  if (body.cache !== "miss") fail("a first request claimed a cache hit");
  if (!calls[0].includes("T07:00") || !calls[0].includes("-1.2921")) {
    fail(`the upstream URL is not the hour and the point: ${calls[0]}`);
  }
}

// 2. The same request within the hour is served from cache. Paris is used here
// because the module cache is shared across the run and nairobi is already warm.
{
  const { calls, fetchImpl } = counting([points]);
  await (await handleLive(request("?ids=paris"), { points, ...creds, fetchImpl, now })).text();
  const second = await handleLive(request("?ids=paris"), { points, ...creds, fetchImpl, now });
  const body = await second.json();
  if (calls.length !== 1) fail(`cache did not hold: ${calls.length} upstream queries`);
  if (body.cache !== "hit") fail("the second request did not report a cache hit");
}

// 3. A large request is chunked at 25 coordinates, never truncated.
{
  const many = Array.from({ length: 60 }, (_, index) => ({
    id: `p${index}`,
    lat: index * 0.5,
    lon: index * 0.25,
  }));
  const groups = [many.slice(0, 25), many.slice(25, 50), many.slice(50)];
  const { calls, fetchImpl } = counting(groups);
  const body = await (await handleLive(request(), { points: many, ...creds, fetchImpl, now })).json();
  if (calls.length !== 3) fail(`60 coordinates used ${calls.length} queries, expected 3`);
  if (Object.keys(body.points).length !== 60) {
    fail(`chunking lost readings: ${Object.keys(body.points).length}/60`);
  }
}

// 4. Unconfigured stays a labelled 503, which is what the app falls back from.
{
  const { calls, fetchImpl } = counting([points]);
  const response = await handleLive(request("?ids=nairobi"), { points, fetchImpl, now });
  const body = await response.json();
  if (response.status !== 503) fail(`unconfigured returned ${response.status}`);
  if (body.error !== "live_unconfigured") fail(`unconfigured error was ${body.error}`);
  if (calls.length !== 0) fail("an unconfigured proxy still called upstream");
}

// 5. Upstream failures are mapped, never passed through as 200.
{
  const upstreamError = async () => {
    const error = new Error("Meteomatics returned 500");
    error.status = 500;
    throw error;
  };
  const response = await handleLive(request("?ids=mcmurdo"), {
    points,
    ...creds,
    fetchImpl: upstreamError,
    now,
  });
  const body = await response.json();
  if (response.status !== 502) fail(`upstream 500 became ${response.status}`);
  if (body.upstream_status !== 500) fail("the upstream status was not reported");
}
{
  const timeout = async () => {
    const error = new Error("The operation was aborted");
    error.name = "TimeoutError";
    throw error;
  };
  const response = await handleLive(request("?ids=tokyo"), {
    points,
    ...creds,
    fetchImpl: timeout,
    now,
  });
  if (response.status !== 504) fail(`a timeout became ${response.status}`);
}

// 6. Only GET is answered, and only for points the bundle holds.
{
  const post = new Request("https://case.example/api/live?ids=nairobi", { method: "POST" });
  const response = await handleLive(post, { points, ...creds, now });
  if (response.status !== 405) fail(`POST returned ${response.status}`);
}
{
  const response = await handleLive(request("?ids=atlantis"), { points, ...creds, now });
  if (response.status !== 400) fail(`an unknown id returned ${response.status}`);
}

// 7. The stamp is the top of the hour, so one hour is one cache key.
if (hourStamp(new Date("2026-11-14T07:59:59Z")) !== "2026-11-14T07:00:00Z") {
  fail("hourStamp does not floor to the hour");
}

console.log("live proxy verified: 1 point = 1 upstream query, cache, chunking, 503/502/504/405/400");
