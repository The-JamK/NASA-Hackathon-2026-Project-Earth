import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { handleLive } from "./worker/live.js";
import { handleResolve, indexGazetteer } from "./worker/resolve.js";

const entry = (file) => fileURLToPath(new URL(file, import.meta.url));
const POINTS_FILE = fileURLToPath(new URL("./public/data/points.json", import.meta.url));
const GAZETTEER_FILE = fileURLToPath(new URL("./public/data/gazetteer.json", import.meta.url));

let pointsCache = { mtimeMs: 0, points: [] };
let gazetteerCache = { mtimeMs: 0, entries: [] };

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

function readGazetteer() {
  try {
    const stat = statSync(GAZETTEER_FILE);
    if (stat.mtimeMs !== gazetteerCache.mtimeMs) {
      gazetteerCache = {
        mtimeMs: stat.mtimeMs,
        entries: (() => {
          const payload = JSON.parse(readFileSync(GAZETTEER_FILE, "utf8"));
          return [
            ...indexGazetteer(payload.places || []),
            ...indexGazetteer(payload.regions || [], { kind: "region" }),
          ];
        })(),
      };
    }
    return gazetteerCache.entries;
  } catch {
    // The gazetteer is built by `uv run python scripts/build_gazetteer.py`;
    // without it the resolver still answers through the keyless geocoders.
    return [];
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Mirror the deployed Worker locally. Credentials come from .env and stay on the
// dev-server side; the browser only sees the normalised JSON.
function apiPlugin(env) {
  const middleware = async (req, res, next) => {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (!url.pathname.startsWith("/api/")) return next();

    try {
      let response;
      if (url.pathname === "/api/live") {
        response = await handleLive(new Request(url.toString(), { method: req.method }), {
          points: readPoints(),
          username: env.METEOMATICS_USERNAME,
          password: env.METEOMATICS_PASSWORD,
        });
      } else if (url.pathname === "/api/resolve") {
        const body = req.method === "POST" ? await readBody(req) : undefined;
        response = await handleResolve(
          new Request(url.toString(), {
            method: req.method,
            body,
            headers: { "content-type": "application/json" },
          }),
          { entries: readGazetteer() }
        );
      } else {
        return next();
      }
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
    name: "case-files-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

// GitHub Pages serves every asset with `max-age=600`, and the bundle names are
// stable by design, so a browser could keep running the previous deploy's
// JavaScript for ten minutes after a release — which is exactly what "it still
// says Wellington" looked like from the outside. Adding a content hash to the
// URL in the HTML gives every build its own cache entry without committing a new
// copy of the file to the repository.
function versionedAssets() {
  return {
    name: "versioned-assets",
    apply: "build",
    closeBundle() {
      for (const page of ["dist/index.html", "dist/app.html"]) {
        if (!existsSync(page)) continue;
        const html = readFileSync(page, "utf8").replace(
          /(\.\/assets\/[A-Za-z0-9._-]+\.(?:js|css))"/g,
          (match, url) => {
            const file = url.replace("./", "dist/");
            if (!existsSync(file)) return match;
            const version = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 10);
            return `${url}?v=${version}"`;
          }
        );
        writeFileSync(page, html);
      }
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
      versionedAssets(),
      apiPlugin({
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
