// Saved places are the app's only stored state. A reader stars a place in its
// case file and the star outlives the page, so two places can be put side by
// side later. Nothing here touches the DOM or the network, and the storage is
// injected, so every rule below is testable in Node without a browser.
//
// Two rules the comparison must never break:
//   * a place with no record for the current variable is shown as missing, not
//     dropped, so a star never silently disappears from the comparison;
//   * two stations in one POWER cell share a series, so they are not independent
//     observations and the comparison says so rather than adding them.

export const STARS_KEY = "signal-noise:stars:v1";
export const MAX_STARS = 12;
export const KINDS = ["city", "country", "point", "ocean", "seaice"];

// The comparison reads in this order. A section exists only when a saved place of
// that kind exists, so a reader who only starred cities never meets an empty one.
export const KIND_GROUPS = [
  { kind: "city", label: "Cities" },
  { kind: "country", label: "Countries" },
  { kind: "point", label: "Grid points" },
  { kind: "ocean", label: "Ocean regions" },
  { kind: "seaice", label: "Sea ice" },
];

// NASA POWER answers per 0.5° x 0.625° cell. Two stars inside one bucket are
// probably sharing a series; the caveat is deliberately approximate, because the
// index carries coordinates rather than the cell each station was served from.
const CELL_LAT = 0.5;
const CELL_LON = 0.625;

const MAX_NAME = 120;

export function starKey(star) {
  return `${star?.kind}:${star?.id}`;
}

function text(value, limit = MAX_NAME) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

// A stored record reduced to what the app will trust, or null when unusable.
// Everything crossing storage is rebuilt here, so a hand-edited entry cannot
// smuggle an unknown kind or an object where a string belongs.
function cleanStar(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const kind = KINDS.includes(raw.kind) ? raw.kind : null;
  const id = text(raw.id);
  if (!kind || !id) return null;
  return {
    kind,
    id,
    name: text(raw.name) || id,
    country: text(raw.country),
    lat: finite(raw.lat),
    lon: finite(raw.lon),
    savedAt: text(raw.savedAt, 40),
  };
}

/**
 * Read whatever storage held. Returns `{ stars, repaired }`; `repaired` is true
 * when the stored text was not exactly what came back, so the caller can say so
 * once rather than throwing on a half-written value.
 */
export function parseStars(value) {
  if (!value) return { stars: [], repaired: false };
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { stars: [], repaired: true };
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.stars) ? parsed.stars : null;
  if (!list) return { stars: [], repaired: true };

  const stars = [];
  const seen = new Set();
  let repaired = false;
  for (const raw of list) {
    const star = cleanStar(raw);
    if (!star) {
      repaired = true;
      continue;
    }
    const key = starKey(star);
    if (seen.has(key) || stars.length >= MAX_STARS) {
      repaired = true;
      continue;
    }
    seen.add(key);
    stars.push(star);
  }
  return { stars, repaired };
}

/**
 * Load saved places. A storage that throws (private browsing, a blocked cookie
 * jar) or a null storage yields an empty list and `unavailable: true`, never a
 * throw: the app keeps working, it just cannot remember this visit.
 */
export function loadStars(storage) {
  if (!storage) return { stars: [], repaired: false, stored: false, unavailable: true };
  let value = null;
  try {
    value = storage.getItem(STARS_KEY);
  } catch {
    return { stars: [], repaired: false, stored: false, unavailable: true };
  }
  const parsed = parseStars(value);
  return { ...parsed, stored: value !== null, unavailable: false };
}

/** Write saved places. Returns false rather than throwing on quota or denial. */
export function saveStars(storage, stars) {
  if (!storage) return false;
  try {
    storage.setItem(STARS_KEY, JSON.stringify((stars || []).map(cleanStar).filter(Boolean)));
    return true;
  } catch {
    return false;
  }
}

export function isStarred(stars, kind, id) {
  const key = `${kind}:${id}`;
  return (stars || []).some((star) => starKey(star) === key);
}

/**
 * Add a place, or remove it when it is already saved. Never mutates `stars`.
 * Returns one of `added`, `removed`, `full` or `invalid`, so the caller can say
 * what happened instead of guessing from a length change.
 */
export function toggleStar(stars, star) {
  const list = Array.isArray(stars) ? stars : [];
  const clean = cleanStar(star);
  if (!clean) return { stars: list.slice(), changed: "invalid" };
  const key = starKey(clean);
  if (list.some((entry) => starKey(entry) === key)) {
    return { stars: list.filter((entry) => starKey(entry) !== key), changed: "removed" };
  }
  if (list.length >= MAX_STARS) return { stars: list.slice(), changed: "full" };
  return { stars: [...list, clean], changed: "added" };
}

function cellOf(star) {
  if (star?.kind !== "city" || star.lat === null || star.lon === null) return null;
  return `${Math.floor(star.lat / CELL_LAT)}:${Math.floor(star.lon / CELL_LON)}`;
}

export function sameCell(a, b) {
  const left = cellOf(a);
  return left !== null && left === cellOf(b);
}

function num(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * One row per saved place, sorted by slope with the places that carry no record
 * last and in the order they were saved. `trendFor(star)` supplies the record
 * for the variable and window being compared; it may return a summary, which has
 * a slope and no interval.
 */
export function compareRows(stars, trendFor) {
  const rows = (stars || []).map((star, index) => {
    const trend = typeof trendFor === "function" ? trendFor(star) : null;
    const slope = num(trend?.slope_per_decade);
    return {
      key: starKey(star),
      index,
      kind: star.kind,
      name: star.name,
      country: star.country || null,
      lat: star.lat,
      lon: star.lon,
      slope,
      low: num(trend?.ci_low_per_decade),
      high: num(trend?.ci_high_per_decade),
      n: num(trend?.n),
      p: num(trend?.p_value),
      verdict: trend?.verdict || null,
      significant: trend?.significant === true,
      exploratory: trend?.exploratory === true,
      // A summary record carries the slope and the sample size but no interval.
      hasInterval: num(trend?.ci_low_per_decade) !== null && num(trend?.ci_high_per_decade) !== null,
      missing: slope === null,
      sharesCell: false,
      delta: null,
    };
  });

  const cells = new Map();
  for (const row of rows) {
    const cell = cellOf(row);
    if (cell === null) continue;
    cells.set(cell, (cells.get(cell) || 0) + 1);
  }
  for (const row of rows) {
    const cell = cellOf(row);
    row.sharesCell = cell !== null && (cells.get(cell) || 0) > 1;
  }

  // The first place saved is the reference the delta column is measured from, so
  // the number a reader sees does not move when the sort order does.
  const base = rows.find((row) => row.index === 0) || null;
  if (base) base.delta = 0;
  for (const row of rows) {
    if (row === base || base === null || base.slope === null || row.slope === null) continue;
    row.delta = row.slope - base.slope;
  }

  rows.sort((a, b) => {
    if (a.missing !== b.missing) return a.missing ? 1 : -1;
    const left = a.slope ?? 0;
    const right = b.slope ?? 0;
    if (left !== right) return right - left;
    return a.index - b.index;
  });
  return rows;
}

/**
 * The comparison as CSV, reusing the case export's quoting and BOM so a saved
 * comparison opens in Excel the same way a case does. Empty cells are honest:
 * a missing interval stays empty rather than being filled with the slope.
 */
export function starsToCsv(rows, { variable, windowKey } = {}) {
  const header = [
    "place",
    "kind",
    "country",
    "variable",
    "window",
    "slope_per_decade",
    "ci_low_per_decade",
    "ci_high_per_decade",
    "n",
    "verdict",
    "delta_vs_first_saved_per_decade",
    "shares_power_cell",
  ];
  const body = (rows || []).map((row) => [
    row.name,
    row.kind,
    row.country || "",
    variable || "",
    windowKey || "",
    row.slope ?? "",
    row.hasInterval ? row.low : "",
    row.hasInterval ? row.high : "",
    row.n ?? "",
    row.verdict || "",
    row.delta ?? "",
    row.sharesCell ? "yes" : "",
  ]);
  return [header, ...body];
}

/* ----------------------------------------------------------- the sections */

/** Saved places split into the sections the dialog draws, in a fixed order. */
export function groupStars(stars) {
  return KIND_GROUPS.map((group) => ({
    ...group,
    stars: (stars || []).filter((star) => star.kind === group.kind),
  })).filter((group) => group.stars.length > 0);
}

/**
 * The variables the whole saved set can show, in the app's own order. A variable
 * is offered when at least one place carries it, and the count says how many do,
 * so a reader can see before switching that a place will go missing.
 */
export function variablesAcross(records, variables) {
  const counts = new Map();
  for (const record of records) {
    for (const code of Object.keys(record?.series || {})) {
      if (Array.isArray(record.series[code]) && record.series[code].some(Number.isFinite)) {
        counts.set(code, (counts.get(code) || 0) + 1);
      }
    }
  }
  const known = new Map((variables || []).map((variable) => [variable.code, variable]));
  const ordered = [];
  for (const variable of variables || []) {
    if (counts.has(variable.code)) ordered.push({ ...variable, places: counts.get(variable.code) });
  }
  // A code the app does not describe still gets a row rather than disappearing.
  for (const [code, places] of counts) {
    if (!known.has(code)) ordered.push({ code, label: code, short: code, units: "", places });
  }
  return ordered;
}

/**
 * One place's series for one variable inside one window, as year/value pairs.
 * Each dataset has its own year axis (the sea-ice record starts earlier than the
 * station bundle), so the axis travels with the record instead of being assumed.
 */
export function seriesFor(record, code, windowKey) {
  const values = record?.series?.[code];
  const years = record?.years;
  if (!Array.isArray(values) || !Array.isArray(years)) return [];
  const [start, end] = String(windowKey || "")
    .split("-")
    .map(Number);
  const pairs = [];
  years.forEach((year, index) => {
    const value = values[index];
    if (!Number.isFinite(year) || !Number.isFinite(value)) return;
    if (Number.isFinite(start) && year < start) return;
    if (Number.isFinite(end) && year > end) return;
    pairs.push({ year, value });
  });
  return pairs;
}

/**
 * The dialog's content: sections in order, each with its rows and the series the
 * chart should draw. A place with no series for this variable keeps its row and
 * is marked missing, so switching variable never makes a saved place vanish.
 */
export function sectionsFor(stars, recordsByKey, { code, windowKey, variables } = {}) {
  return groupStars(stars).map((group) => {
    const rows = compareRows(group.stars, (star) =>
      recordTrend(recordsByKey?.get?.(starKey(star)) || null, code, windowKey)
    );
    const lines = [];
    const index = new Map((stars || []).map((star, position) => [starKey(star), position]));
    for (const row of rows) {
      const record = recordsByKey?.get?.(row.key) || null;
      const pairs = seriesFor(record, code, windowKey);
      row.points = pairs.length;
      if (pairs.length < 3) continue;
      lines.push({ key: row.key, label: row.name, pairs, slot: index.get(row.key) ?? 0 });
    }
    const variable = (variables || []).find((entry) => entry.code === code) || null;
    return {
      kind: group.kind,
      label: group.label,
      rows,
      lines,
      units: variable?.units || "",
      variable: variable?.short || code || "",
    };
  });
}

function recordTrend(record, code, windowKey) {
  if (!record || !code) return null;
  return record?.trends?.[code]?.[windowKey] || null;
}
