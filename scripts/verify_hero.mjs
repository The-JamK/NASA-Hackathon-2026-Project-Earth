// The landing screen is the whole first impression: one Earth, eight boxes that
// ride around it and one statement centred above it, and no lines drawn from a
// box to anywhere. This checks the structure and the copy that matters, not the
// pixels. The geometry is measured in a browser, because only a browser knows
// where the sphere ends up.
//
//   node scripts/verify_hero.mjs
import { readFileSync } from "node:fs";

const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const failures = [];

function check(label, condition) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures.push(label);
  }
}

const boxClasses = [...landing.matchAll(/class="hero-box hero-box--([\w-]+)"/g)].map((match) => match[1]);
check(
  "nine boxes, one per position around the sphere and one above it",
  boxClasses.length === 9 && new Set(boxClasses).size === 9,
  );
if (boxClasses.length !== 9) console.log(`       found ${boxClasses.length}: ${boxClasses.join(", ")}`);

for (const name of ["belief", "name", "public", "members", "about", "challenge", "analyst", "event", "data"]) {
  check(`the ${name} box exists`, boxClasses.includes(name));
}

// The statement above the sphere, and the label that frames it.
const beliefBox = landing.match(/hero-box--belief"[\s\S]*?<\/article>/)?.[0] ?? "";
check(
  "the belief box says access to Earth science and trends should not require a science degree",
  /We believe access to Earth science and trends shouldn't require a science degree\./.test(beliefBox),
);
check("the belief box is labelled", /Why we built this/.test(beliefBox));

// The two audience boxes, and the sentences they have to carry.
const publicBox = landing.match(/hero-box--public"[\s\S]*?<\/article>/)?.[0] ?? "";
const analystBox = landing.match(/hero-box--analyst"[\s\S]*?<\/article>/)?.[0] ?? "";
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

check("the public box is labelled for everyone", /For everyone/.test(publicBox));
check(
  "the public box says it is made for the general public, through simple search and a clear answer",
  /general public/.test(publicBox) && /simple search/.test(publicBox) && /clear answer/.test(publicBox),
);
check("the analyst box is labelled for analysts", /For analysts/.test(analystBox));
check(
  "the analyst box says it is made for technical analysts, with detailed numbers and calculations fully explained",
  /technical analysts/.test(analystBox) &&
    /detailed numbers/.test(analystBox) &&
    /calculations/.test(analystBox) &&
    /fully explained/.test(analystBox),
);
check("the analyst box says the data is organised and ready to download", /organised data/.test(analystBox) && /download/.test(analystBox));
check("the download formats are named", /CSV/.test(analystBox) && /Excel/.test(analystBox) && /R\b/.test(analystBox));

// Every box has copy, so none of the nine is a placeholder.
const boxes = [...landing.matchAll(/<article class="hero-box[\s\S]*?<\/article>/g)].map((match) => text(match[0]));
check(
  "every box carries copy",
  boxes.length === 9 && boxes.every((box) => box.length > 20),
);

// The page still opens the case and still holds no leader lines or dots.
check("the globe is still the way in", /id="hero-globe"/.test(landing));
check("no leader lines or anchor dots", !/hero-line|hero-lines|hero-dot|hero-leader/.test(landing));

if (failures.length) {
  console.error(`\n${failures.length} failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("HERO CHECK PASS");
