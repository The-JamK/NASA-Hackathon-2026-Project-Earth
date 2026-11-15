// The site's writing uses commas, colons and full stops, and it uses en-dashes
// only in ranges like 1990–2025. An em-dash is not allowed anywhere a reader can
// meet one, so this check fails on any U+2014 in the pages, the app's source, the
// stylesheet, the docs and the shipped data labels.
//
//   node scripts/verify_prose.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url);
const EM_DASH = String.fromCodePoint(0x2014);
const EN_DASH = String.fromCodePoint(0x2013);

function read(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

const targets = [
  "index.html",
  "app.html",
  "README.md",
  "DEMO.md",
  ...readdirSync(new URL("src/", ROOT))
    .filter((name) => /\.(js|css)$/.test(name))
    .map((name) => `src/${name}`),
  ...readdirSync(new URL("public/data/", ROOT))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `public/data/${name}`),
];

const hits = [];
let scanned = 0;
let enDashes = 0;

for (const path of targets) {
  let text;
  try {
    text = read(path);
  } catch {
    continue;
  }
  scanned += 1;
  enDashes += (text.match(new RegExp(EN_DASH, "g")) || []).length;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    let from = line.indexOf(EM_DASH);
    while (from !== -1) {
      hits.push({
        path,
        line: index + 1,
        context: line.slice(Math.max(0, from - 40), from + 40).trim(),
      });
      from = line.indexOf(EM_DASH, from + 1);
    }
  });
}

console.log(`  scanned ${scanned} files, ${enDashes} en-dashes kept in ranges`);

for (const hit of hits.slice(0, 20)) {
  console.log(`  FAIL ${hit.path}:${hit.line}  ${hit.context}`);
}
if (hits.length > 20) console.log(`  ... ${hits.length - 20} more`);

if (hits.length) {
  console.error(`\n${hits.length} em-dash${hits.length === 1 ? "" : "es"} left (U+2014)`);
  process.exit(1);
}
console.log("PROSE CHECK PASS");
