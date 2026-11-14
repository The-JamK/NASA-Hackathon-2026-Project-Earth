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
  candidates.sort((a, b) => b.alias.length - a.alias.length);

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

function chooseVariable(question, place, ranked) {
  const text = question.toLowerCase();
  const top = ranked[0]?.id || "T2M";

  if (place.global) {
    if (/\b(global|planet|world|earth|map|everywhere|places)\b/i.test(text)) return "GISTEMP";
    if (top === "GISTEMP") return "GISTEMP";
    return "GISTEMP";
  }

  if (/\b(rain|rainfall|raining|precip|precipitation|dry|drier|drying|drought|wet|wetter|monsoon|storm)\b/i.test(text)) {
    return "PRECTOTCORR";
  }
  if (/\b(soil|moisture|wetness|root|agriculture|land)\b/i.test(text)) return "GWETROOT";
  if (/\b(solar|sun|sunlight|radiation|sunshine|irradiance|cloud|cloudiness|bright)\b/i.test(text)) {
    return "ALLSKY_SFC_SW_DWN";
  }
  if (/\b(temperature|temp|warm|warming|warmed|heat|hot|cold|cool|degrees)\b/i.test(text)) return "T2M";
  return top === "GISTEMP" ? "T2M" : top;
}

function matchedTerms(question, variable) {
  const haystack = `${variable.label} ${variable.short} ${variable.description} ${variable.keywords}`.toLowerCase();
  return tokenize(question).filter((token) => haystack.includes(token)).slice(0, 4);
}

export function planCase(question, { rag, points, variables }) {
  const clean = String(question || "").trim();
  if (!clean) return null;

  const ranked = rankVariables(clean, rag);
  const { place, resolved, alias } = resolvePlace(clean, rag, points);
  const time = parseTime(clean);
  const code = chooseVariable(clean, place, ranked);
  const variable = variables.find((item) => item.code === code) || variables[0];
  const windowKey = chooseWindow(time, ["1990-2025", "2000-2025", "2010-2025"]);

  const terms = matchedTerms(clean, variable);
  const placePhrase = place.global
    ? "no city was named, so the plan uses the global field"
    : `${alias ? `"${alias}"` : "the named place"} resolves to ${place.name}`;
  const termPhrase = terms.length
    ? `matched ${terms.map((term) => `"${term}"`).join(", ")} to ${variable.short.toLowerCase()}`
    : `the closest supported variable is ${variable.short.toLowerCase()}`;

  const topScore = ranked[0]?.score || 0;
  const confidence = Math.max(0.42, Math.min(0.97, 0.56 + topScore * 0.65 - (resolved ? 0 : 0.08)));

  return {
    question: clean,
    variable,
    place,
    time,
    windowKey,
    confidence,
    explanation: `${termPhrase}; ${placePhrase}; using the ${windowKey.replace("-", "–")} record.`,
    sources: `${variable.source} · ${place.global ? "GISTEMP global field" : `${place.name}, ${place.country}`}`,
    alternatives: ranked
      .filter((item) => item.id !== code)
      .slice(0, 2)
      .map((item) => variables.find((variable) => variable.code === item.id))
      .filter(Boolean),
    note: time.note,
  };
}
