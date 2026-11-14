import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SKIP = new Set(["node_modules", ".git", "dist", "cache", ".vite", "__pycache__", ".pytest_cache"]);
const TEXT = new Set([
  ".js",
  ".mjs",
  ".json",
  ".py",
  ".md",
  ".html",
  ".css",
  ".toml",
  ".lock",
  ".yml",
  ".yaml",
  ".txt",
  ".example",
]);
const SECRET = /^(EARTHDATA_USERNAME|EARTHDATA_PASSWORD|EARTHDATA_TOKEN|METEOMATICS_USERNAME|METEOMATICS_PASSWORD|PLANETARY_COMPUTER_API_KEY|GITHUB_TOKEN|GODADDY_[A-Z_]+)\s*=\s*(\S+)/m;
const PROTOTYPE = /(nasa-hackathon-docs|\/sample\/|sample\/index\.html)/i;

let failures = 0;
let ignoredEnv = false;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    const info = statSync(absolute);
    if (info.isDirectory()) {
      if (SKIP.has(entry)) continue;
      walk(absolute);
      continue;
    }
    const path = relative(ROOT, absolute);
    if (path === join("scripts", "verify_clean.mjs")) continue;
    if (entry === ".env") {
      const ignored = existsSync(join(ROOT, ".gitignore"))
        ? readFileSync(join(ROOT, ".gitignore"), "utf8")
            .split(/\r?\n/)
            .some((line) => line.trim().replace(/\/$/, "") === ".env")
        : false;
      if (ignored) {
        ignoredEnv = true;
        continue;
      }
      fail(`secret-bearing env file is present: ${path}`);
      continue;
    }
    if (entry.startsWith(".env.") && entry !== ".env.example") {
      fail(`secret-bearing env file is present: ${path}`);
      continue;
    }
    if (entry === ".env.example") continue;
    if (!TEXT.has(extname(entry)) && !entry.startsWith(".env")) continue;
    let text;
    try {
      text = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    const secret = text.match(SECRET);
    if (secret) fail(`non-empty credential assignment in ${path}`);
    if (PROTOTYPE.test(text)) fail(`prototype path reference in ${path}`);
  }
}

walk(ROOT);

const ignorePath = join(ROOT, ".gitignore");
let ignore = "";
try {
  ignore = readFileSync(ignorePath, "utf8");
} catch {
  fail(".gitignore is missing");
}
for (const pattern of [".env", "node_modules", "dist", "data/cache", ".DS_Store"]) {
  if (!ignore.split(/\r?\n/).some((line) => line.trim().replace(/\/$/, "") === pattern)) {
    fail(`.gitignore is missing ${pattern}`);
  }
}

if (failures) {
  console.error(`\n${failures} cleanliness check(s) failed`);
  process.exit(1);
}

console.log(ignoredEnv ? "env: local .env is ignored; no tracked secrets" : "env: no secret-bearing .env files");
console.log("paths: no prototype references");
console.log("ignore: .env · node_modules · dist · data/cache · .DS_Store");
console.log("clean verified");
