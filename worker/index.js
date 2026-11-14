// Workers entry: /api/live plus the static app. METEOMATICS_USERNAME and
// METEOMATICS_PASSWORD are runtime secrets; they are never sent to the client.

import { handleLive } from "./live.js";

let pointsPromise = null;

function loadPoints(env, origin) {
  if (!pointsPromise) {
    pointsPromise = env.ASSETS.fetch(new URL("/data/points.json", origin))
      .then((response) => {
        if (!response.ok) throw new Error(`points.json returned ${response.status}`);
        return response.json();
      })
      .then((payload) => payload.points || [])
      .catch((error) => {
        pointsPromise = null;
        throw error;
      });
  }
  return pointsPromise;
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

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
