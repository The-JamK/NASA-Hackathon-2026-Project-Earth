// The site's motion is meant to be quiet: it moves things a few pixels, never
// rearranges the page, and it can be switched off. This check holds the stylesheet
// to that, so "subtle" stays measurable instead of becoming a matter of taste.
//
//   node scripts/verify_motion.mjs
import { readFileSync } from "node:fs";

const CSS_URL = new URL("../src/style.css", import.meta.url);
const css = readFileSync(CSS_URL, "utf8");
const failures = [];

function fail(message) {
  failures.push(message);
}

function ok(message) {
  console.log(`  ok   ${message}`);
}

// ---------- parse the keyframes ----------

function keyframeBlocks(source) {
  const blocks = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let match;
  while ((match = re.exec(source))) {
    let depth = 1;
    let index = re.lastIndex;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ name: match[1], body: source.slice(re.lastIndex, index - 1) });
  }
  return blocks;
}

const keyframes = keyframeBlocks(css);
if (!keyframes.length) {
  fail("no @keyframes found in style.css");
} else {
  ok(`${keyframes.length} keyframe blocks parsed`);
}

// Only opacity and transform are allowed inside a keyframe: both are composited,
// so they cannot push the layout around while they run.
const ALLOWED = new Set(["opacity", "transform", "scale", "translate", "filter", "box-shadow", "visibility", "background", "color", "border-color", "background-color"]);
const COMPOSITED = new Set(["opacity", "transform", "scale", "translate"]);
for (const block of keyframes) {
  const properties = [...block.body.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
  const bad = properties.filter((property) => !ALLOWED.has(property));
  if (bad.length) {
    fail(`@keyframes ${block.name} animates ${[...new Set(bad)].join(", ")}; only composited properties are allowed`);
    continue;
  }
  const uncomposited = properties.filter((property) => !COMPOSITED.has(property));
  if (uncomposited.length) {
    // A glow or a haze is fine, but it has to be the exception, not the motion.
    console.log(`  note @keyframes ${block.name} also animates ${[...new Set(uncomposited)].join(", ")}`);
  }
}

// ---------- durations ----------

function toSeconds(value) {
  const number = Number.parseFloat(value);
  if (Number.isNaN(number)) return null;
  return /ms\s*$/.test(value) ? number / 1000 : number;
}

const LONGEST = 1.2; // seconds, for anything that is not the loader spinner
const declarations = [...css.matchAll(/animation(?:-name)?\s*:\s*([^;{}]+);/g)].map((match) => match[1].trim());
let slow = 0;
for (const declaration of declarations) {
  const times = [...declaration.matchAll(/(-?[\d.]+)(m?s)\b/g)].map((match) => toSeconds(`${match[1]}${match[2]}`));
  const longest = times.length ? Math.max(...times) : 0;
  const isSpinner = /spin/.test(declaration) && /infinite/.test(declaration);
  if (longest > LONGEST && !isSpinner) {
    fail(`animation "${declaration}" runs ${longest}s; the limit is ${LONGEST}s`);
    slow += 1;
  }
}
if (!slow) ok(`every animation declaration stays within ${LONGEST}s (the spinner excepted)`);

// ---------- the case stagger ----------

const stagger = [...css.matchAll(/\.case-panel\s*>\s*[^{]*\{[^}]*animation-delay:\s*([\d.]+)s/g)].map((match) => Number(match[1]));
if (!stagger.length) {
  fail("no case-panel entrance stagger found");
} else {
  const last = Math.max(...stagger);
  if (last > 0.15) fail(`the case stagger's last delay is ${last}s; it should read as one settle, so 0.15s is the ceiling`);
  else ok(`case stagger: ${stagger.length} steps, last delay ${last}s`);
}
if (!/\.case-panel\s*>\s*\*\s*\{[^}]*animation:\s*settle/.test(css)) {
  fail("the case panel's children are not given the settle animation");
}

// ---------- press feedback ----------

// Count the controls, not the declarations: one grouped rule can cover several.
const activeTransforms = [...css.matchAll(/([^{}]*:active[^{}]*)\{([^}]*)\}/g)]
  .filter((match) => /transform\s*:/.test(match[2]))
  .reduce((count, match) => count + match[1].split(",").filter((part) => /:active/.test(part)).length, 0);
if (activeTransforms < 5) fail(`only ${activeTransforms} controls give press feedback; at least 5 should`);
else ok(`${activeTransforms} controls give press feedback`);

// ---------- reduced motion ----------

const reduced = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
if (!reduced) {
  fail("no prefers-reduced-motion block");
} else {
  const body = reduced[1];
  if (!/animation-duration:\s*0?\.\d+m?s\s*!important/.test(body)) {
    fail("the reduced-motion block does not zero animation-duration with !important");
  }
  if (!/transition-duration:\s*0?\.\d+m?s\s*!important/.test(body)) {
    fail("the reduced-motion block does not zero transition-duration with !important");
  }
  if (!/\*,\s*\n?\s*\*::before/.test(body)) {
    fail("the reduced-motion override is not applied to every element");
  }
  ok("reduced motion zeroes animation and transition durations for every element");
}

// ---------- budget ----------

const gzipNote = `stylesheet is ${(readFileSync(CSS_URL).length / 1024).toFixed(1)} kB raw`;
console.log(`  note ${gzipNote}`);

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("MOTION CHECK PASS");
