const STOPWORDS = new Set(
  "a an the is are was were of to in on for and or with by from what which how does do did has have had at as it its this that these those be been being".split(
    " "
  )
);

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length > 1 && !STOPWORDS.has(token)) || [];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryWeights(question, rag) {
  const position = new Map(rag.vocab.map((term, index) => [term, index]));
  const weights = new Map();
  for (const token of tokenize(question)) {
    const index = position.get(token);
    if (index === undefined) continue;
    weights.set(index, (weights.get(index) || 0) + rag.idf[index]);
  }
  let norm = 0;
  for (const weight of weights.values()) norm += weight * weight;
  norm = Math.sqrt(norm) || 1;
  for (const [index, weight] of weights) weights.set(index, weight / norm);
  return weights;
}

export function rankVariables(question, rag) {
  const weights = queryWeights(question, rag);
  return rag.docs
    .map((doc) => {
      let score = 0;
      for (const [index, weight] of doc.vector) {
        score += weight * (weights.get(index) || 0);
      }
      return { id: doc.id, label: doc.label, score };
    })
    .sort((a, b) => b.score - a.score);
}

function aliasRegex(alias) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`, "i");
}

export function resolvePlace(question, rag, points) {
  const text = question.toLowerCase();
  const candidates = [];
  for (const place of rag.places) {
    for (const alias of place.aliases) {
      if (alias && alias.length > 1) candidates.push({ alias, place });
    }
  }
  // Longest alias wins (“united states” over “us”); within one alias, every
  // station of a country matches, so prefer the hand-curated case, then the
  // largest population, so “USA” and “United States” land on the same station.
  candidates.sort(
    (a, b) =>
      b.alias.length - a.alias.length ||
      (b.place.primary ? 1 : 0) - (a.place.primary ? 1 : 0) ||
      (b.place.weight || 0) - (a.place.weight || 0)
  );

  for (const { alias, place } of candidates) {
    if (aliasRegex(alias).test(text)) {
      const point = points.find((item) => item.id === place.id);
      if (point) return { place: point, resolved: true, alias };
    }
  }

  if (/\b(global|planet|world|earth|everywhere|which places|all places|map)\b/i.test(text)) {
    return { place: { global: true, name: "Global", lat: 0, lon: 0 }, resolved: true, alias: "global" };
  }

  const typo = stationCandidates(text, points);
  if (typo.length) {
    const best = typo[0];
    return {
      place: best.point,
      resolved: true,
      alias: best.point.name,
      corrected: true,
      typed: best.typed,
      candidates: typo.map(({ point }) => ({
        id: point.id,
        name: point.name,
        country: point.country,
        lat: point.lat,
        lon: point.lon,
        population: point.population,
        kind: "station",
      })),
    };
  }

  return { place: { global: true, name: "Global", lat: 0, lon: 0 }, resolved: false, alias: null };
}

/**
 * Stations whose own name a question nearly spells.
 *
 * The bundle's 708 station records are better than any derived cell, so a
 * one-edit misspelling should reach the station itself rather than fall through
 * to the gazetteer and answer from a coarser 4° cell. Only the station's own name
 * is compared — a country alias ("Kenya") is not a station — and only when the
 * exact pass found nothing, so a correctly spelled name never becomes a typo.
 *
 * Returns the best few, because "Did you mean" is a question the reader answers.
 */
/** Every one-, two- and three-word run of the question, as typed and unspaced. */
function typoWindows(question) {
  const tokens = tokenize(question);
  const windows = [];
  for (let size = 1; size <= 3; size += 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      const words = tokens.slice(start, start + size);
      windows.push({ text: words.join(" "), compact: words.join("") });
    }
  }
  return windows;
}

/** Whether every word of `inner` is a word of `outer` (“ocean” → “indian ocean”). */
function covers(outer, inner) {
  const words = fold(outer).split(" ");
  return fold(inner)
    .split(" ")
    .filter(Boolean)
    .every((word) => words.includes(word));
}

/**
 * The record whose alias a question nearly spells, best first.
 *
 * Used for countries and ocean basins, where the alias is the whole name and a
 * near miss is almost always that name: "Austraila", "Cannda", "Indain Ocean".
 * Short aliases ("us", "uk") are exact-only, because a one-letter difference
 * there is a different word.
 */
function fuzzyRecord(question, records, { slack = 1, maxEdits = null } = {}) {
  if (!Array.isArray(records) || !records.length) return null;
  const windows = typoWindows(question);
  if (!windows.length) return null;

  let best = null;
  for (const record of records) {
    for (const alias of record.aliases || []) {
      const key = fold(alias).replace(/ /g, "");
      const limit = maxEdits ?? typoLimit(key.length);
      if (key.length < 5 || !limit) continue;
      for (const window of windows) {
        // A typo keeps the length; a word that is much shorter or longer is a
        // different name. Without this, "Antarctica" matched "antarctic ice".
        if (Math.abs(window.compact.length - key.length) > Math.min(slack, limit)) continue;
        if (key.length / Math.max(window.compact.length, 1) < 0.6) continue;
        const distance = editDistance(window.compact, key, limit);
        if (!distance || distance > limit) continue;
        // The same rules the place matcher uses: a misspelling rarely changes the
        // first letter, and a whole extra ending is a different name. Without
        // them "Queenland" (Queensland) was read as Greenland.
        if (distance >= 2 && window.compact[0] !== key[0]) continue;
        {
          const [shorter, longer] =
            window.compact.length <= key.length ? [window.compact, key] : [key, window.compact];
          if (longer.length - shorter.length >= 2 && longer.startsWith(shorter)) continue;
        }
        // Longer names are more specific: "Indian Ocean" over "ocean".
        const score = 1 - distance / Math.max(window.compact.length, key.length) + key.length * 0.01;
        if (!best || score > best.score) {
          best = { record, alias, typed: window.text, score };
        }
      }
    }
  }
  return best;
}

function stationCandidates(question, points) {
  if (!Array.isArray(points) || !points.length) return [];
  const windows = typoWindows(question);
  if (!windows.length) return [];

  const found = new Map();
  for (const point of points) {
    const key = fold(point.name).replace(/ /g, "");
    // One edit, same length: a station is repaired for a typo, not guessed at.
    // With a three-edit budget "Washington" was reaching Wellington and taking
    // the question away from the gazetteer, which knows Washington, D.C.
    const limit = 1;
    if (key.length < 5) continue;
    for (const window of windows) {
      if (Math.abs(window.compact.length - key.length) > limit) continue;
      // The typed word has to be most of the name, not a fragment of it.
      if (key.length / Math.max(window.compact.length, 1) < 0.6) continue;
      const distance = editDistance(window.compact, key, limit);
      if (!distance || distance > limit) continue;
      const score = 1 - distance / Math.max(window.compact.length, key.length);
      const current = found.get(point.id);
      if (!current || score > current.score) found.set(point.id, { point, score, typed: window.text });
    }
  }

  return [...found.values()]
    .sort((a, b) => b.score - a.score || (b.point.population || 0) - (a.point.population || 0))
    .slice(0, 3);
}

/**
 * A country name is not a station: it asks for the average across that country.
 * Longest alias wins so "United States" beats a stray "us".
 */
export function resolveCountry(question, countries) {
  if (!countries?.length) return null;
  const text = String(question || "").toLowerCase();
  let best = null;
  for (const country of countries) {
    for (const alias of country.aliases || []) {
      if (!alias || alias.length < 3) continue;
      if (!aliasRegex(alias).test(text)) continue;
      if (!best || alias.length > best.alias.length) best = { country, alias };
    }
  }
  // A near miss may only replace an exact match when that match is a generic
  // word inside the repaired name: "the Indain Ocean" matched "ocean", and the
  // global ocean is a worse answer than repairing one letter. It may never
  // replace a name that was spelled correctly — "Australia" is one edit from
  // "Austria", and an exact name is not a typo of a different one.
  const fuzzy = fuzzyRecord(question, countries);
  if (fuzzy && (!best || covers(fuzzy.alias, best.alias))) {
    return { country: fuzzy.record, alias: fuzzy.alias, corrected: true, typed: fuzzy.typed };
  }
  return best;
}

/**
 * A basin is not a station either: it is the area-weighted mean of the GISTEMP
 * cells inside it. Longest alias wins, so "north pacific" beats "pacific" and
 * "indian ocean" beats "indian".
 */
export function resolveOcean(question, ocean) {
  if (!ocean?.length) return null;
  const text = String(question || "").toLowerCase();
  let best = null;
  for (const region of ocean) {
    for (const alias of region.aliases || []) {
      if (!alias || alias.length < 3) continue;
      if (!aliasRegex(alias).test(text)) continue;
      if (!best || alias.length > best.alias.length) best = { region, alias };
    }
  }
  const fuzzy = fuzzyRecord(question, ocean);
  if (fuzzy && (!best || covers(fuzzy.alias, best.alias))) {
    return { region: fuzzy.record, alias: fuzzy.alias, corrected: true, typed: fuzzy.typed };
  }
  return best;
}

/**
 * Sea ice is its own record, not a station and not a basin: NSIDC publishes the
 * extent of each hemisphere, so the case is the annual mean of twelve monthly
 * extents. Longest alias wins, so "arctic sea ice" beats "sea ice".
 */
export function resolveSeaIce(question, seaIce) {
  if (!seaIce?.length) return null;
  const text = String(question || "").toLowerCase();
  let best = null;
  for (const record of seaIce) {
    for (const alias of record.aliases || []) {
      if (!alias || alias.length < 3) continue;
      if (!aliasRegex(alias).test(text)) continue;
      if (!best || alias.length > best.alias.length) best = { record, alias };
    }
  }
  // "Antartic sea ice" matched only the word "sea ice" — the global record — so
  // the repair has to replace a generic exact alias, exactly as oceans do.
  const fuzzy = fuzzyRecord(question, seaIce, { maxEdits: 1 });
  if (fuzzy && (!best || covers(fuzzy.alias, best.alias))) {
    return { record: fuzzy.record, alias: fuzzy.alias, corrected: true, typed: fuzzy.typed };
  }
  return best;
}

// A named ice question still has to answer something when the record list is
// missing; the hemisphere is chosen from the words, then global.
export function defaultSeaIceRecord(seaIce, question) {
  if (!seaIce?.length) return null;
  const text = String(question || "").toLowerCase();
  const byId = (id) => seaIce.find((record) => record.id === id) || null;
  if (/\b(arctic|north pole|polar north|northern)\b/i.test(text)) return byId("arctic-sea-ice");
  if (/\b(antarctic|south pole|polar south|southern)\b/i.test(text)) return byId("antarctic-sea-ice");
  // "Antartic" and "artic" name a hemisphere without spelling it the way the
  // record list does; without this a misspelt hemisphere answered both poles.
  for (const window of typoWindows(question)) {
    if (editDistance(window.compact, "antarctic", 1) === 1) return byId("antarctic-sea-ice");
    if (editDistance(window.compact, "arctic", 1) === 1) return byId("arctic-sea-ice");
  }
  return byId("global-sea-ice") || seaIce[0] || null;
}

/**
 * Two measures ride on the same records: extent (how far the ice reaches) and
 * concentration (how much of the ice-covered area is ice, 100 × area ÷ extent).
 * They can move in opposite directions, which is why the case shows both.
 */
export function seaIceVariable(code = "SEAICE") {
  if (code === "SEAICECONC") {
    return {
      code: "SEAICECONC",
      label: "Sea ice concentration",
      short: "Concentration",
      units: "%",
      slope_units: "percentage points",
      source: "NSIDC Sea Ice Index (G02135) via NOAA PSL",
      kind: "ice",
      baseline: "100 × monthly ice area ÷ monthly extent, averaged to an annual mean",
      description:
        "Mean concentration of the ice-covered area: the share of that area that is actually ice, in percent.",
      keywords: "sea ice concentration ice cover fraction thickness arctic antarctic",
    };
  }
  return {
    code: "SEAICE",
    label: "Sea ice extent",
    short: "Extent",
    units: "10⁶ km²",
    slope_units: "million km²",
    source: "NSIDC Sea Ice Index (G02135) via NOAA PSL",
    kind: "ice",
    baseline: "absolute monthly extent, averaged to an annual mean",
    description:
      "Annual mean of the twelve monthly NSIDC sea ice extents for a hemisphere or both together.",
    keywords: "sea ice ice extent arctic antarctic polar freeze melt cryosphere",
  };
}

// "Concentration" asks a different question than "how far does the ice reach";
// the wording picks the measure, defaulting to extent, which is the headline.
export function seaIceVariableCode(question) {
  return /\bconcentrat|\bhow (dense|thick) |\bice fraction/i.test(String(question || ""))
    ? "SEAICECONC"
    : "SEAICE";
}

// Naming ice in a question must not end at the nearest land station: it used to
// answer "Arctic sea ice" with Tromsø air temperature. Ice now goes to the sea
// ice record, or to the basin it names when that record is unavailable.
const ICE_TERMS = /\b(sea[- ]ice|ice extent|ice cover|ice sheet|ice shelf|glacier|glaciers)\b/i;

/**
 * Whether the question is about ice, including a misspelt "sea ice".
 *
 * Without the repair, "Arctic see ice" never reached the ice record at all: the
 * station table carries an "arctic" alias, so the question answered Tromsø air
 * temperature. One letter in "sea ice" is a spelling, not a different question.
 */
function mentionsIce(question) {
  if (ICE_TERMS.test(question)) return true;
  return typoWindows(question).some(
    (window) => window.compact.length >= 5 && editDistance(window.compact, "seaice", 1) === 1
  );
}

/**
 * The basin under a point, using the same wrapped box test the build script used
 * (`(lon - start) % 360 <= span`), so a tap and a rebuild agree on membership.
 * The global aggregate matches every point and is therefore skipped.
 */
export function oceanRegionAt(lat, lon, ocean) {
  if (!ocean?.length) return null;
  for (const region of ocean) {
    if (region.family === "aggregate") continue;
    const [low, high] = region.lat_bounds || [];
    const [start, span] = region.lon_bounds || [];
    if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(start)) continue;
    if (lat < low || lat > high) continue;
    if ((((lon - start) % 360) + 360) % 360 <= span) return region;
  }
  return null;
}

export function pickIceRegion(question, ocean) {
  if (!ocean?.length) return null;
  const text = String(question || "").toLowerCase();
  const byId = (id) => ocean.find((region) => region.id === id) || null;
  if (/\b(arctic|north pole|polar north)\b/i.test(text)) return byId("arctic-ocean");
  if (/\b(antarctic|south pole|southern|polar south)\b/i.test(text)) return byId("southern-ocean");
  return byId("global-ocean") || ocean[0] || null;
}

export function parseTime(question) {
  const text = String(question || "");
  let start = 1990;
  let end = 2025;
  let note = "";

  const range = text.match(/(19|20)\d{2}\s*(?:-|–|to|through)\s*((19|20)\d{2})/i);
  if (range) {
    start = Number(range[0].match(/(19|20)\d{2}/)?.[0] || 1990);
    end = Number(range[2]);
  } else {
    const since = text.match(/\b(?:since|after|from|between)\s+((19|20)\d{2})/i);
    if (since) start = Number(since[1]);
  }

  if (start < 1990) {
    start = 1990;
    note = "The earliest available record starts in 1990.";
  }
  if (end > 2025) {
    end = 2025;
    note = "The latest complete record ends in 2025.";
  }
  if (start > end) {
    start = 1990;
    end = 2025;
    note = "The requested range was reversed; using 1990–2025.";
  }

  return { start, end, label: `${start}–${end}`, note };
}

export function chooseWindow(time, windows) {
  const start = Number(time?.start || 1990);
  if (start <= 1994) return windows.find((key) => key.startsWith("1990")) || windows[0];
  if (start <= 2006) return windows.find((key) => key.startsWith("2000")) || windows[windows.length - 1];
  return windows.find((key) => key.startsWith("2010")) || windows[windows.length - 1];
}

/* ------------------------------------------------------- spelling tolerance */

/** Levenshtein distance, abandoned as soon as it passes `limit`. */
export function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowBest) rowBest = current[j];
    }
    if (rowBest > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/** How many edits a word of this length may carry: one per five letters. */
export function typoLimit(length) {
  return length >= 10 ? 3 : length >= 7 ? 2 : length >= 5 ? 1 : 0;
}

/** Lowercase, accent-free, single-spaced, so "Reykjavík" meets "Reykjavik". */
function fold(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The climate vocabulary, grouped by the variable each group asks for. The
 * regexes are what runs; `repair` holds the ordinary spellings a mangled word
 * is matched against, because "precipitiation" has to find precipitation without
 * a rain word in it.
 */
const CLIMATE_TERMS = [
  {
    code: "PRECTOTCORR",
    label: "precipitation",
    words:
      /\b(rain|rainfall|raining|precip|precipitation|dry|drier|drying|drought|wet|wetter|monsoon|storm)\b/i,
    repair: ["precipitation", "rainfall", "drought", "monsoon"],
  },
  {
    code: "GWETROOT",
    label: "soil moisture",
    words: /\b(soil|moisture|wetness|root|agriculture|land)\b/i,
    repair: ["moisture", "wetness"],
  },
  {
    code: "ALLSKY_SFC_SW_DWN",
    label: "solar radiation",
    words: /\b(solar|sun|sunlight|radiation|sunshine|irradiance|cloud|cloudiness|bright)\b/i,
    repair: ["radiation", "sunshine", "cloudiness"],
  },
  {
    code: "T2M",
    label: "temperature",
    words: /\b(temperature|temp|warm|warming|warmed|heat|hot|cold|cool|degrees)\b/i,
    repair: ["temperature", "warming"],
  },
];

/**
 * One word of a question repaired to the climate word it nearly is.
 *
 * Only words of five letters or more are considered: "hot" and "sun" are short
 * enough that a one-edit neighbour is usually a different word, and a wrong
 * variable is a worse answer than a fallback.
 */
export function climateTypo(question) {
  const text = String(question || "");
  const folded = fold(text);
  let best = null;
  for (const term of CLIMATE_TERMS) {
    for (const word of term.repair) {
      for (const token of folded.split(" ")) {
        if (token.length < 6 || Math.abs(token.length - word.length) > typoLimit(word.length)) continue;
        const distance = editDistance(token, word, typoLimit(word.length));
        if (!distance || distance > typoLimit(word.length)) continue;
        const score = 1 - distance / Math.max(token.length, word.length);
        // The word shown back is the one that was matched, not the variable's
        // name: "drougt" was read as "drought", not as "precipitation".
        if (!best || score > best.score) {
          best = { code: term.code, typed: token, word, score };
        }
      }
    }
  }
  return best;
}

/**
 * The variable a question names, from the wording alone, with the correction it
 * had to make. Exported because the resolver (`worker/resolve.js`) reads the same
 * vocabulary for places the bundle does not hold, so a niche question and a
 * station question agree on the variable.
 */
export function readVariable(question) {
  const text = String(question || "").toLowerCase();
  for (const term of CLIMATE_TERMS) {
    if (term.words.test(text)) return { code: term.code, corrected: null };
  }
  const typo = climateTypo(question);
  if (typo) return { code: typo.code, corrected: { typed: typo.typed, word: typo.word } };
  return { code: null, corrected: null };
}

export function variableFromQuestion(question) {
  return readVariable(question).code;
}

function chooseVariable(question, place, ranked) {
  const top = ranked[0]?.id || "T2M";

  if (place.global || place.cells) {
    return { code: "GISTEMP", corrected: null };
  }

  const read = readVariable(question);
  if (read.code) return read;
  return { code: top === "GISTEMP" ? "T2M" : top, corrected: null };
}

function matchedTerms(question, variable) {
  const haystack = `${variable.label} ${variable.short} ${variable.description} ${variable.keywords}`.toLowerCase();
  return tokenize(question).filter((token) => haystack.includes(token)).slice(0, 4);
}

// The variable record stays GISTEMP, but over water GISTEMP reads ERSST sea
// surface temperature, so the label follows the case rather than the file.
export function oceanVariable(variable) {
  return {
    ...variable,
    label: "Sea surface temperature",
    short: "Sea surface temperature",
    description: "GISTEMP ocean cells, ERSST-based sea surface temperature.",
  };
}

export function planCase(question, { rag, points, variables, countries, ocean, seaIce }) {
  const clean = String(question || "").trim();
  if (!clean) return null;

  const ranked = rankVariables(clean, rag);
  const city = resolvePlace(clean, rag, points);
  const countryHit = resolveCountry(clean, countries);
  const oceanHit = resolveOcean(clean, ocean);
  const seaIceHit = resolveSeaIce(clean, seaIce);
  const iceQuestion = mentionsIce(clean);
  // Either signal is enough: "arctic ice" names a record without matching the
  // ice vocabulary, and "sea ice" names the concept without naming a region.
  const iceRecord =
    iceQuestion || seaIceHit ? seaIceHit?.record || defaultSeaIceRecord(seaIce, clean) : null;
  const iceRegion = iceQuestion && !iceRecord ? pickIceRegion(clean, ocean) : null;

  // A country name should answer the country question, not silently pick its
  // biggest city. A city name still wins when it is the more specific match.
  const useCountry =
    Boolean(countryHit) &&
    // A station the question really names beats a country it merely almost
    // spells; only an unresolved question may be repaired into a country.
    (!countryHit.corrected || !city.resolved) &&
    (!city.resolved || countryHit.alias.length >= (city.alias || "").length);
  // Likewise a basin beats a country word ("Indian Ocean" is not India), and a
  // sea-ice question is answered by the sea-ice record itself.
  const oceanAlias = iceRegion ? oceanHit?.alias || "sea ice" : oceanHit?.alias;
  const useOcean =
    iceRegion !== null ||
    (Boolean(oceanHit) &&
      (!oceanHit.corrected || !city.resolved) &&
      (!useCountry || oceanHit.alias.length > countryHit.alias.length) &&
      (!city.resolved || oceanHit.alias.length >= (city.alias || "").length));

  const region = iceRegion || oceanHit?.region || null;
  const place = iceRecord || (useOcean ? region : useCountry ? countryHit.country : city.place);
  if (!place) return null;

  const kind = iceRecord
    ? "seaice"
    : useOcean
      ? "ocean"
      : useCountry
        ? "country"
        : place.global
          ? "global"
          : "city";
  const resolved = Boolean(iceRecord) || useOcean || useCountry || city.resolved;
  const alias = iceRecord
    ? seaIceHit?.alias || place.name.toLowerCase()
    : useOcean
      ? oceanAlias || place.name.toLowerCase()
      : useCountry
        ? countryHit.alias
        : city.alias;

  const time = parseTime(clean);
  const iceCode = iceRecord ? seaIceVariableCode(clean) : null;
  const chosen = iceRecord ? { code: iceCode, corrected: null } : chooseVariable(clean, place, ranked);
  const code = chosen.code;
  const base = variables.find((item) => item.code === code) || variables[0];
  const variable = iceRecord ? seaIceVariable(iceCode) : useOcean ? oceanVariable(base) : base;
  const windowKey = chooseWindow(time, ["1990-2025", "2000-2025", "2010-2025"]);

  const terms = matchedTerms(clean, variable);
  const placePhrase = iceRecord
    ? seaIceHit?.corrected
      ? `"${seaIceHit.typed}" was read as ${place.name}, so this is the annual mean of its twelve monthly extents`
      : `"${alias}" is a hemisphere-scale sea ice record, so this is the annual mean of its twelve monthly extents`
    : useOcean
    ? oceanHit?.corrected
      ? `"${oceanHit.typed}" was read as ${place.name}, so this averages its ${place.cells} GISTEMP ocean cells by area (${place.extent})`
      : `"${alias}" is an ocean basin, so this averages its ${place.cells} GISTEMP ocean cells by area (${place.extent})`
    : place.global
      ? "no city was named, so the plan uses the global field"
      : useCountry
        ? countryHit.corrected
          ? `"${countryHit.typed}" was read as ${place.name}, so this is the mean of its ${place.stations} station${
              place.stations === 1 ? "" : "s"
            }`
          : `"${alias}" is a country, so this is the mean of its ${place.stations} station${
              place.stations === 1 ? "" : "s"
            }`
        : city.corrected
          ? `"${city.typed}" was read as ${place.name}${
              place.country ? `, ${place.country}` : ""
            }, which is one of the bundle's stations`
          : `${alias ? `"${alias}"` : "the named place"} resolves to ${place.name}`;
  // A repaired climate word is stated as the reading it is; "the closest
  // supported variable" would describe a guess the app did not have to make.
  const termPhrase = chosen.corrected
    ? `read "${chosen.corrected.typed}" as ${chosen.corrected.word}`
    : terms.length
      ? `matched ${terms.map((term) => `"${term}"`).join(", ")} to ${variable.short.toLowerCase()}`
      : `the closest supported variable is ${variable.short.toLowerCase()}`;

  const topScore = ranked[0]?.score || 0;
  const confidence = Math.max(0.42, Math.min(0.97, 0.56 + topScore * 0.65 - (resolved ? 0 : 0.08)));

  const iceNote = iceRecord
    ? "Extent is the area with at least 15% ice cover; concentration is ice area ÷ extent. Both are annual means, which average the seasonal cycle away."
    : iceQuestion
      ? "No sea-ice record is loaded here, so the case below is the named basin's sea surface temperature, which is the nearest supported record."
      : "";


  return {
    question: clean,
    // Whether a place, basin or record was actually named. A question that
    // matched nothing falls through to the global field with resolved: false,
    // which is the app's signal to ask the resolver for a coordinate.
    resolved,
    variable,
    place,
    time,
    windowKey,
    confidence,
    explanation: `${termPhrase}; ${placePhrase}; using the ${windowKey.replace("-", "–")} record.`,
    kind,
    cities: useCountry ? place.cities || [] : [],
    sources: iceRecord
      ? `${variable.source} · ${variable.label.toLowerCase()} · annual mean of 12 monthly values`
      : useOcean
      ? `${variable.source} · ${place.cells} ocean cells · ${place.extent}`
      : `${variable.source} · ${
          place.global
            ? "GISTEMP global field"
            : useCountry
              ? `${place.stations}-station mean, ${place.name}`
              : `${place.name}, ${place.country}`
        }`,
    alternatives: ranked
      .filter((item) => item.id !== code)
      .slice(0, 2)
      .map((item) => variables.find((variable) => variable.code === item.id))
      .filter(Boolean),
    note: [time.note, iceNote].filter(Boolean).join(" "),
    // A station the question only nearly spelled: the caller offers the station
    // rather than quietly answering from it, and keeps the typed word for the
    // explanation.
    corrected: iceRecord
      ? Boolean(seaIceHit?.corrected)
      : useOcean
        ? Boolean(oceanHit?.corrected)
        : useCountry
          ? Boolean(countryHit?.corrected)
          : Boolean(city.corrected),
    // Every word the app changed, in one list, so the popup can offer each of
    // them instead of only the place names. Only the place that actually answers
    // is listed: a country the question merely brushed past is not a reading.
    repairs: [
      iceRecord
        ? seaIceHit?.corrected && { kind: "ice record", typed: seaIceHit.typed, name: place.name }
        : useOcean
          ? oceanHit?.corrected && { kind: "ocean", typed: oceanHit.typed, name: place.name }
          : useCountry
            ? countryHit?.corrected && { kind: "country", typed: countryHit.typed, name: place.name }
            : city.corrected && { kind: "station", typed: city.typed, name: place.name },
      chosen.corrected && { kind: "climate word", typed: chosen.corrected.typed, name: chosen.corrected.word },
    ].filter(Boolean),
    candidates: city.candidates || [],
    variableCorrection: chosen.corrected || null,
  };
}
