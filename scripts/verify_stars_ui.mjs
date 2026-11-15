// The saved-places dialog is static markup plus a handful of delegated actions, so
// most of it can be checked without a browser: the dialog must ship closed, the
// top-bar button must ship hidden, a star must exist in every place case, and every
// place name must pass through an escaper before it reaches innerHTML. A name is
// data from a bundle, never markup.
//
//   node scripts/verify_stars_ui.mjs
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

let failures = 0;
function check(condition, message) {
  if (condition) return;
  console.error(`FAIL: ${message}`);
  failures += 1;
}

const app = read("app.html");
const main = read("src/main.js");
const chart = read("src/chart.js");
const css = read("src/style.css");
const stars = read("src/stars.js");
const suite = read("scripts/verify_all.sh");

/* ------------------------------------------------------------- app.html */

check(/<dialog[^>]*id="compare-dialog"[^>]*>/.test(app), "app.html carries the compare dialog");
const dialogTag = app.match(/<dialog[^>]*id="compare-dialog"[^>]*>/)?.[0] || "";
check(!/\sopen(\s|>)/.test(dialogTag), "the compare dialog ships closed, not open");
check(/aria-labelledby="compare-title"/.test(dialogTag), "the dialog is labelled by its heading");
check(/id="compare-body"/.test(app), "the dialog has a body to render into");
check(/id="compare-note"/.test(app), "the dialog states where saved places live");
check(/id="compare-csv"/.test(app), "the dialog can export the comparison");
check(/id="compare-done"/.test(app), "the dialog has a way back to the case");
check(!/compare-intervals/.test(app), "the old interval button is gone, because series now load with the dialog");

const starsBtn = app.match(/<button[^>]*id="stars-btn"[^>]*>/)?.[0] || "";
check(starsBtn !== "", "app.html carries the saved-places button");
check(/\shidden/.test(starsBtn), "the saved-places button ships hidden at zero stars");
check(/aria-haspopup="dialog"/.test(starsBtn), "the saved-places button announces that it opens a dialog");
check(/id="stars-count"/.test(app), "the saved-places button carries its count");

/* -------------------------------------------------------------- main.js */

// The star is offered in every case that is a place: city, country, ocean, sea
// ice, grid cell and a searched point. Global is the only case without one.
check(
  (main.match(/\$\{starButton\(\)\}/g) || []).length === 6,
  "the star is rendered in the six place cases"
);
check(
  /kind: "point"/.test(main) && /kind === "grid" \|\| kind === "derived"/.test(main),
  "a grid cell and a searched place save as a point"
);
check(/data-action="toggle-star"/.test(main), "the star is a delegated action");
check(/name === "toggle-star"/.test(main), "the delegated handler answers the star");
check(/function toggleStarForCase\(/.test(main), "starring has one entry point");
check(/aria-pressed="\$\{on\}"/.test(main), "the star reports its pressed state");
check(/function refreshStarsButton\(/.test(main), "the top-bar count is refreshed from state");
check(/els\.starsBtn\.hidden = count === 0/.test(main), "the top-bar button hides itself at zero stars");
check(/els\.compareDialog\.showModal\(\)/.test(main), "the comparison opens as a native modal dialog");
check(/function renderCompare\(/.test(main), "there is one comparison renderer");
check(/function openCompare\(/.test(main), "there is one entry point");

// Grouping, sections and charts.
check(/sectionsFor\(/.test(main) && /variablesAcross\(/.test(main), "the renderer reads the grouped model");
check(/renderTrendChart\(/.test(main), "a section draws the trend chart");
check(/compare-section-head/.test(main), "a section starts with its heading");
check(/compareSectionsHtml/.test(main), "sections are built in one place");
check(/data-action="compare-variable"/.test(main), "the variable can be switched");
check(/name === "compare-variable"/.test(main), "the variable switch is handled");
check(/trendPalette\(/.test(main), "a place keeps its colour between the chart and its row");

// The dialog owns its window and its export; the case keeps its own window.
check(/function compareWindow\(\)/.test(main), "the dialog owns its window");
check(/state\.compareWindow = state\.windowKey/.test(main), "opening starts on the case's window");
check(/data-action="compare-window"/.test(main), "the timeframe can be switched in the dialog");
check(/name === "compare-window"/.test(main), "the window switch is handled");
check(/const windowKey = compareWindow\(\);/.test(main), "sections are cut on the dialog's window");
check(/starsToCsv\(rows, \{ variable: code, windowKey \}\)/.test(main), "the CSV carries the dialog's variable and window");
check(!/starTrend/.test(main), "the deleted interval path is gone from export too");

// Adding places, not only removing them.
check(/data-action="add-saved"/.test(main), "a place can be added from the dialog");
check(/name === "add-saved"/.test(main), "the add action is handled");
check(/id="compare-add-input"/.test(main), "the dialog offers a place search");
check(/function addSavedPlace\(/.test(main), "adding reuses the same star rules");
check(/MAX_STARS/.test(main), "the cap is reported when adding");
check(/function renderCompareCandidates\(/.test(main), "the search renders candidates");

// Hover dimming.
check(/function setCompareFocus\(/.test(main), "hover focus has one owner");
check(/"is-dim"/.test(main) && /"is-focus"/.test(main), "hover toggles dim and focus classes");
check(/pointerover/.test(main) && /pointerleave/.test(main), "hover is bound where the rows and lines live");
check(/data-key="\$\{key\}"/.test(main), "a row carries the key its chart line shares");
check(/data-action="open-saved"/.test(main), "a row can open its own case");
check(/data-action="remove-saved"/.test(main), "a row can unstar itself");
check(/function openSavedPlace\(/.test(main) && /function removeSavedPlace\(/.test(main), "both row actions reuse the app's openers");

// A star must never be a second source of truth for the case header: starring
// repaints the one button and leaves the panel alone.
check(
  !/function toggleStarForCase[\s\S]{0,1400}?renderCase\(\)/.test(main),
  "starring does not re-render the case"
);

// Escaping: every place name in a row builder must be inside an unclosed
// escapeHtml( call at that point.
const rowBuilder = main.match(/function compareRow\([^)]*\)[\s\S]*?\n}/)?.[0] || "";
check(rowBuilder !== "", "the comparison row builder is present");
const nameHits = [...rowBuilder.matchAll(/row\.name/g)].map((hit) => hit.index);
const escapedNames = nameHits.every((index) => {
  const before = rowBuilder.slice(Math.max(0, index - 90), index);
  const opened = before.lastIndexOf("escapeHtml(");
  return opened >= 0 && !before.slice(opened).includes(")");
});
check(nameHits.length > 0 && escapedNames, "every place name in a comparison row is escaped");
check(/escapeHtml\(\s*starLabel\(/.test(main), "the star's label is escaped into its attributes");
check(!/els\.toast\.innerHTML/.test(main), "toasts are written as text, not markup");
check(/escapeHtml\(\s*place\.name\s*\)/.test(main), "a candidate's name is escaped");
check(/data-name="\$\{escapeHtml\(place\.name\)\}"/.test(main), "a candidate's name is escaped into its data attribute");

/* ------------------------------------------------------------- chart.js */

check(/export function renderTrendChart\(/.test(chart), "chart.js exports the trend chart");
check(/export function trendPalette\(/.test(chart), "chart.js exports the shared palette");
check(/escapeText\(\s*line\.key\s*\)/.test(chart), "a line's key is escaped");
check(/escapeText\(\s*units \|\| "values"/.test(chart), "the chart's spoken label is escaped");
check(/getComputedStyle\(container\)/.test(chart) && /container\.clientWidth/.test(chart), "the chart measures its own box");
check(/data-key="\$\{escapeText\(line\.key\)\}"/.test(chart), "each line carries its place key");
check(!/renderSlopeChart/.test(chart), "the old slope chart is gone rather than left dead");
check(/xLabel = "Year"/.test(chart), "the x axis is named");
check(/axis-title/.test(chart) && /axis-line/.test(chart), "both axes carry a title and a rule");
check(/escapeText\(String\(units\)\.toUpperCase\(\)\)/.test(chart), "the y axis title is escaped");

/* ------------------------------------------------------------ style.css */

check(/\.case-star \{/.test(css), "the star is styled");
check(/\.case-star \{[\s\S]{0,120}margin-left: auto/.test(css), "the star keeps Close at the right edge");
check(/\.compare-table \{/.test(css), "the comparison table is styled");
check(/\.compare-dot\.explore/.test(css), "an exploratory verdict keeps its own colour");
check(/\.compare-section \{/.test(css), "a section is styled");
check(/\.compare-section-head h3 \{/.test(css), "a section heading is styled");
check(/\.compare-vars \{/.test(css) && /\.compare-var\.on \{/.test(css), "the variable switcher shows its active state");
check(/\.compare-add input \{/.test(css), "the add field is styled");
check(/\.compare-candidate \{/.test(css), "a candidate is styled");
check(/\.compare-swatch \{/.test(css), "the line and row share a swatch");
check(/\[data-key\]\.is-dim \{ opacity/.test(css), "a dimmed place actually fades");
check(/\.trend-line \{/.test(css) && /\.trend-series\.is-focus/, "the focused line is emphasised");
check(/\.axis-title \{/.test(css) && /\.axis-line \{/.test(css), "axis titles and rules are styled");
check(
  /compare-dialog\[open\]/.test(css) || /compare-dialog:not\(\[open\]\)\s*\{ display: none/.test(css),
  "a closed compare dialog is not rendered"
);
check(/@media \(prefers-reduced-motion: reduce\)/.test(css), "the stylesheet still honours reduced motion");
check(/@media \(max-width: 560px\)/.test(css), "the phone layout still exists");
check(!/\.compare-verdict\.warm/.test(css), "no verdict is a filled block");

/* ------------------------------------------------------------- stars.js */

check(/export const MAX_STARS = 12;/.test(stars), "the cap is twelve places");
check(/export const STARS_KEY = "signal-noise:stars:v1";/.test(stars), "the storage key is versioned");
check(/KIND_GROUPS/.test(stars) && /export function groupStars/.test(stars), "the groups are declared in one place");
check(/export function sectionsFor/.test(stars), "sections are a pure function");
check(/export function seriesFor/.test(stars), "series extraction is a pure function");
check(/export function variablesAcross/.test(stars), "variable availability is a pure function");
check(/missing: slope === null/.test(stars), "a place without a record is marked missing");
check(/row\.sharesCell = cell !== null/.test(stars), "shared POWER cells are flagged");

/* --------------------------------------------------------- verify_all.sh */

check(/node scripts\/verify_stars\.mjs/.test(suite), "the suite runs the stars check");
check(/node scripts\/verify_stars_ui\.mjs/.test(suite), "the suite runs this check");

if (failures) {
  console.error(`${failures} stars ui check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("stars ui verified");
