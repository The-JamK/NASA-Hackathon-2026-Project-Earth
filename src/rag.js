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

  return { place: { global: true, name: "Global", lat: 0, lon: 0 }, resolved: false, alias: null };
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

/**
 * The variable a question names, from the wording alone. Exported because the
 * resolver (`worker/resolve.js`) reads the same vocabulary for places the bundle
 * does not hold, so a niche question and a station question agree on the variable.
 */
export function variableFromQuestion(question) {
  const text = String(question || "").toLowerCase();
  if (/\b(rain|rainfall|raining|precip|precipitation|dry|drier|drying|drought|wet|wetter|monsoon|storm)\b/i.test(text)) {
    return "PRECTOTCORR";
  }
  if (/\b(soil|moisture|wetness|root|agriculture|land)\b/i.test(text)) return "GWETROOT";
  if (/\b(solar|sun|sunlight|radiation|sunshine|irradiance|cloud|cloudiness|bright)\b/i.test(text)) {
    return "ALLSKY_SFC_SW_DWN";
  }
  if (/\b(temperature|temp|warm|warming|warmed|heat|hot|cold|cool|degrees)\b/i.test(text)) return "T2M";
  return null;
}

function chooseVariable(question, place, ranked) {
  const top = ranked[0]?.id || "T2M";

  if (place.global || place.cells) {
    return "GISTEMP";
  }

  return variableFromQuestion(question) || (top === "GISTEMP" ? "T2M" : top);
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
  const iceQuestion = ICE_TERMS.test(clean);
  // Either signal is enough: "arctic ice" names a record without matching the
  // ice vocabulary, and "sea ice" names the concept without naming a region.
  const iceRecord =
    iceQuestion || seaIceHit ? seaIceHit?.record || defaultSeaIceRecord(seaIce, clean) : null;
  const iceRegion = iceQuestion && !iceRecord ? pickIceRegion(clean, ocean) : null;

  // A country name should answer the country question, not silently pick its
  // biggest city. A city name still wins when it is the more specific match.
  const useCountry =
    Boolean(countryHit) && (!city.resolved || countryHit.alias.length >= (city.alias || "").length);
  // Likewise a basin beats a country word ("Indian Ocean" is not India), and a
  // sea-ice question is answered by the sea-ice record itself.
  const oceanAlias = iceRegion ? oceanHit?.alias || "sea ice" : oceanHit?.alias;
  const useOcean =
    iceRegion !== null ||
    (Boolean(oceanHit) &&
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
  const code = iceRecord ? iceCode : chooseVariable(clean, place, ranked);
  const base = variables.find((item) => item.code === code) || variables[0];
  const variable = iceRecord ? seaIceVariable(iceCode) : useOcean ? oceanVariable(base) : base;
  const windowKey = chooseWindow(time, ["1990-2025", "2000-2025", "2010-2025"]);

  const terms = matchedTerms(clean, variable);
  const placePhrase = iceRecord
    ? `"${alias}" is a hemisphere-scale sea ice record, so this is the annual mean of its twelve monthly extents`
    : useOcean
    ? `"${alias}" is an ocean basin, so this averages its ${place.cells} GISTEMP ocean cells by area (${place.extent})`
    : place.global
      ? "no city was named, so the plan uses the global field"
      : useCountry
        ? `"${alias}" is a country, so this is the mean of its ${place.stations} station${
            place.stations === 1 ? "" : "s"
          }`
        : `${alias ? `"${alias}"` : "the named place"} resolves to ${place.name}`;
  const termPhrase = terms.length
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
  };
}
