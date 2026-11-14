import { readFileSync, statSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { handleLive } from "./worker/live.js";

const entry = (file) => fileURLToPath(new URL(file, import.meta.url));
const POINTS_FILE = fileURLToPath(new URL("./public/data/points.json", import.meta.url));

let pointsCache = { mtimeMs: 0, points: [] };

function readPoints() {
  const stat = statSync(POINTS_FILE);
  if (stat.mtimeMs !== pointsCache.mtimeMs) {
    pointsCache = {
      mtimeMs: stat.mtimeMs,
      points: JSON.parse(readFileSync(POINTS_FILE, "utf8")).points || [],
    };
  }
  return pointsCache.points;
}

// Mirror the deployed Worker locally. Credentials come from .env and stay on
// the dev-server side; the browser only sees the normalised JSON.
function liveApi(env) {
  const middleware = async (req, res, next) => {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/api/live") return next();
    try {
      const response = await handleLive(new Request(url.toString(), { method: req.method }), {
        points: readPoints(),
        username: env.METEOMATICS_USERNAME,
        password: env.METEOMATICS_PASSWORD,
      });
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await response.text());
    } catch {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "proxy_failed" }));
    }
  };

  return {
    name: "case-files-live-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

// Two entries: the landing page at the site root and the app at /app.html.
// Relative asset URLs keep both working at the domain root and under
// /<repository>/ on GitHub Pages.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "./",
    plugins: [
      liveApi({
        METEOMATICS_USERNAME: env.METEOMATICS_USERNAME || process.env.METEOMATICS_USERNAME,
        METEOMATICS_PASSWORD: env.METEOMATICS_PASSWORD || process.env.METEOMATICS_PASSWORD,
      }),
    ],
    build: {
      // The build is committed (GitHub Pages serves this repository folder), so
      // keep file names stable and let a rebuild overwrite them instead of adding
      // a new hashed copy of the bundle to Git history on every deploy.
      rollupOptions: {
        input: {
          landing: entry("./index.html"),
          app: entry("./app.html"),
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  };
});
