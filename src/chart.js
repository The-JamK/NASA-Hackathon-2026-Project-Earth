import * as d3 from "d3";

const VERDICT_COLOR = {
  "significant increasing": "#ff6b4a",
  "significant decreasing": "#4f93d6",
  "no significant trend": "#6b7a88",
  exploratory: "#c9a227",
};

export function trendColor(trend) {
  if (!trend) return "#6b7a88";
  if (trend.significant === true && trend.slope > 0) return "#ff6b4a";
  if (trend.significant === true && trend.slope < 0) return "#4f93d6";
  if (trend.verdict) return VERDICT_COLOR[trend.verdict] || "#6b7a88";
  return trend.slope > 0 ? "#ff6b4a" : "#4f93d6";
}

// Two measures on one record have different units (10⁶ km² and %), so they share
// this chart only as indices: each series is divided by its own first value and
// scaled to 100. A second y-axis would let the two scales be chosen freely, which
// can invent a divergence that the data does not have; indexing cannot.
export function renderCompareChart(container, { years, series, xLabel }) {
  if (!container) return;
  const drawn = series
    .map((entry) => {
      const pairs = years
        .map((year, index) => ({ year: Number(year), value: entry.values[index] }))
        .filter((pair) => Number.isFinite(pair.year) && Number.isFinite(pair.value));
      if (pairs.length < 3) return null;
      const base = pairs[0].value;
      if (!base) return null;
      return {
        ...entry,
        pairs: pairs.map((pair) => ({ year: pair.year, value: (100 * pair.value) / base })),
        baseYear: pairs[0].year,
      };
    })
    .filter(Boolean);

  if (!drawn.length) {
    container.innerHTML = `<div class="warn-note">No complete annual series for this window.</div>`;
    return;
  }

  const width = 360;
  const height = 172;
  const pad = { top: 14, right: 8, bottom: 20, left: 34 };
  const all = drawn.flatMap((entry) => entry.pairs);
  const firstYear = d3.min(all, (pair) => pair.year);
  const lastYear = d3.max(all, (pair) => pair.year);

  const x = d3.scaleLinear().domain([firstYear, lastYear]).range([pad.left, width - pad.right]);
  const y = d3
    .scaleLinear()
    .domain(d3.extent(all, (pair) => pair.value))
    .nice()
    .range([height - pad.bottom, pad.top]);

  const horizontalTicks = y.ticks(3);
  const grid = horizontalTicks
    .map(
      (tick) =>
        `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/>`
    )
    .join("");
  const valueTicks = horizontalTicks
    .map(
      (tick) =>
        `<text class="axis-label" x="${pad.left - 5}" y="${y(tick) + 2.5}" text-anchor="end">${d3.format(
          ".3~f"
        )(tick)}</text>`
    )
    .join("");

  const baseline =
    y.domain()[0] <= 100 && y.domain()[1] >= 100
      ? `<line class="zero-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(100)}" y2="${y(
          100
        )}"/>`
      : "";

  const paths = drawn
    .map((entry) => {
      const d =
        "M" + entry.pairs.map((pair) => `${x(pair.year).toFixed(1)},${y(pair.value).toFixed(1)}`).join("L");
      return `<path class="measure-line ${entry.active ? "active" : ""}" d="${d}" stroke="${
        entry.color
      }" fill="none"${entry.active ? "" : ` opacity="0.55"`}/>`;
    })
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img"
         aria-label="${drawn.map((entry) => entry.label).join(" and ")} from ${firstYear} to ${lastYear}, indexed to ${firstYear} = 100">
      ${grid}
      ${baseline}
      ${paths}
      ${valueTicks}
      <text class="axis-label" x="${pad.left}" y="${height - 5}">${firstYear}</text>
      <text class="axis-label" x="${width - pad.right}" y="${height - 5}" text-anchor="end">${lastYear}</text>
      <text class="axis-label" x="${pad.left}" y="9">index, ${firstYear} = 100</text>
      <text class="axis-label" x="${width - pad.right}" y="9" text-anchor="end">${xLabel || ""}</text>
    </svg>`;
}

export function renderSeriesChart(container, { years, values, trend, variable, xLabel, yLabel }) {
  if (!container) return;
  const pairs = years
    .map((year, index) => ({ year: Number(year), value: values[index] }))
    .filter((pair) => Number.isFinite(pair.year) && Number.isFinite(pair.value));

  if (pairs.length < 3 || !trend) {
    container.innerHTML = `<div class="warn-note">No complete annual series for this window.</div>`;
    return;
  }

  const width = 360;
  const height = 172;
  const pad = { top: 12, right: 8, bottom: 20, left: 34 };
  const color = trendColor(trend);

  const meanYear = d3.mean(pairs, (pair) => pair.year);
  const meanValue = d3.mean(pairs, (pair) => pair.value);
  const lowSlope = (trend.ci_low_per_decade || 0) / 10;
  const highSlope = (trend.ci_high_per_decade || 0) / 10;
  const lowAt = pairs.map((pair) => meanValue + lowSlope * (pair.year - meanYear));
  const highAt = pairs.map((pair) => meanValue + highSlope * (pair.year - meanYear));

  const x = d3.scaleLinear().domain(d3.extent(pairs, (pair) => pair.year)).range([pad.left, width - pad.right]);
  const y = d3
    .scaleLinear()
    .domain([
      Math.min(d3.min(pairs, (pair) => pair.value), d3.min(lowAt), d3.min(highAt)),
      Math.max(d3.max(pairs, (pair) => pair.value), d3.max(lowAt), d3.max(highAt)),
    ])
    .nice()
    .range([height - pad.bottom, pad.top]);

  const top = highAt.map((value, index) => [x(pairs[index].year), y(value)]);
  const bottom = lowAt.map((value, index) => [x(pairs[index].year), y(value)]).reverse();
  const bandPath =
    "M" + top.map((point) => point.join(",")).join("L") +
    "L" + bottom.map((point) => point.join(",")).join("L") + "Z";

  const startFit = meanValue + (trend.slope_per_decade / 10) * (pairs[0].year - meanYear);
  const endFit = meanValue + (trend.slope_per_decade / 10) * (pairs[pairs.length - 1].year - meanYear);

  const horizontalTicks = y.ticks(3);
  const grid = horizontalTicks
    .map((tick) => `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/>`)
    .join("");

  const zeroLine =
    y.domain()[0] <= 0 && y.domain()[1] >= 0
      ? `<line class="zero-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}"/>`
      : "";

  const points = pairs
    .map(
      (pair) =>
        `<circle class="pt" cx="${x(pair.year).toFixed(1)}" cy="${y(pair.value).toFixed(1)}" r="1.9" fill="${color}"/>`
    )
    .join("");

  const valueTicks = horizontalTicks
    .map(
      (tick) =>
        `<text class="axis-label" x="${pad.left - 5}" y="${y(tick) + 2.5}" text-anchor="end">${d3.format(".2~f")(tick)}</text>`
    )
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img"
         aria-label="${variable?.label || "Annual series"} from ${pairs[0].year} to ${pairs[pairs.length - 1].year}">
      ${grid}
      ${zeroLine}
      <path class="band" d="${bandPath}" fill="${color}"/>
      <line class="fit" x1="${x(pairs[0].year)}" y1="${y(startFit)}"
            x2="${x(pairs[pairs.length - 1].year)}" y2="${y(endFit)}" stroke="${color}"/>
      ${points}
      ${valueTicks}
      <text class="axis-label" x="${pad.left}" y="${height - 5}">${pairs[0].year}</text>
      <text class="axis-label" x="${width - pad.right}" y="${height - 5}" text-anchor="end">${
        pairs[pairs.length - 1].year
      }</text>
      <text class="axis-label" x="${pad.left}" y="9">${yLabel || variable?.units || ""}</text>
      <text class="axis-label" x="${width - pad.right}" y="9" text-anchor="end">${xLabel || ""}</text>
    </svg>`;
}
