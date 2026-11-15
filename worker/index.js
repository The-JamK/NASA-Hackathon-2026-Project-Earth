// Workers entry: /api/live and /api/resolve plus the static app.
// METEOMATICS_USERNAME and METEOMATICS_PASSWORD are runtime secrets; they are
// never sent to the client. The place resolver needs no key at all.

import { handleLive } from "./live.js";
import { handleResolve, indexGazetteer } from "./resolve.js";

let pointsPromise = null;
let gazetteerPromise = null;

function assetJson(env, origin, path, label) {
  return env.ASSETS.fetch(new URL(path, origin)).then((response) => {
    if (!response.ok) throw new Error(`${label} returned ${response.status}`);
    return response.json();
  });
}

function loadPoints(env, origin) {
  if (!pointsPromise) {
    pointsPromise = assetJson(env, origin, "/data/points.json", "points.json")
      .then((payload) => payload.points || [])
      .catch((error) => {
        pointsPromise = null;
        throw error;
      });
  }
  return pointsPromise;
}

// The gazetteer is server-side only: the browser never downloads it, and the
// index is built once per isolate rather than per request.
function loadGazetteer(env, origin) {
  if (!gazetteerPromise) {
    gazetteerPromise = assetJson(env, origin, "/data/gazetteer.json", "gazetteer.json")
      .then((payload) => indexGazetteer(payload.places || []))
      .catch((error) => {
        gazetteerPromise = null;
        throw error;
      });
  }
  return gazetteerPromise;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/live") {
      let points = [];
      try {
        points = await loadPoints(env, url.origin);
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "bundle_unavailable" }), {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      return handleLive(request, {
        points,
        username: env.METEOMATICS_USERNAME,
        password: env.METEOMATICS_PASSWORD,
      });
    }

    if (url.pathname === "/api/resolve") {
      let entries = [];
      try {
        entries = await loadGazetteer(env, url.origin);
      } catch {
        // A missing gazetteer is not fatal: the model fallback can still run,
        // and with neither the handler says so instead of guessing.
        entries = [];
      }
      return handleResolve(request, { entries });
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
