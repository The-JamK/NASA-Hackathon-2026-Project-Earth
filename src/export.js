// A verdict is only worth as much as the numbers behind it, so every case can
// hand those over: the annual means the fit was computed from, and the statistics
// with their method and source. Both files are plain CSV, openable in Excel,
// R, pandas, prefixed with a UTF-8 BOM and written with CRLF so Excel reads
// "°C", "−0.54" and "Benjamini–Hochberg" instead of mojibake.

const BOM = "\uFEFF";

function cell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  return BOM + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

// The fitted line the chart draws: y = intercept + (slope per decade / 10) × year.
export function fitAt(trend, year) {
  if (!trend) return null;
  if (!Number.isFinite(trend.intercept) || !Number.isFinite(trend.slope_per_decade)) return null;
  return trend.intercept + (trend.slope_per_decade / 10) * year;
}

// One row per year the case used, with the fit and the residual, so a reader can
// refit the slope themselves and check the serial correlation the HAC errors assume
// away. No per-year confidence band: the stored interval is for the slope, and
// turning it into a band would invent an uncertainty the bundle does not carry.
export function seriesRows(years, values, trend) {
  const rows = [["year", "value", "fit", "residual"]];
  years.forEach((year, index) => {
    const value = values[index];
    const hasValue = Number.isFinite(value);
    const fit = hasValue ? fitAt(trend, year) : null;
    rows.push([
      year,
      hasValue ? value : "",
      fit === null ? "" : fit,
      hasValue && fit !== null ? value - fit : "",
    ]);
  });
  return rows;
}

export function reportRows({ title, detail, variable, trend, windowKey, years, values, source }) {
  const rows = [["field", "value"]];
  // Numbers keep full precision; a non-finite statistic becomes an empty cell rather
  // than the string "NaN", which would poison a spreadsheet column.
  const add = (field, value) => {
    if (value === null || value === undefined) rows.push([field, ""]);
    else if (typeof value === "number" && !Number.isFinite(value)) rows.push([field, ""]);
    else rows.push([field, value]);
  };

  add("case", title);
  add("detail", detail);
  add("variable", variable?.label ?? "");
  add("units", variable?.units ?? "");
  add("slope_units", variable?.slope_units || variable?.units || "");
  add("source", source || variable?.source || "");
  add("window", windowKey);
  add("first_year", years[0]);
  add("last_year", years[years.length - 1]);
  add("years_in_window", years.length);
  add("annual_means_used", trend?.n ?? 0);
  add(
    "annual_means_with_values",
    years.filter((_, index) => Number.isFinite(values[index])).length
  );

  add("model", "value = intercept + slope_per_decade / 10 * year");
  add("intercept", trend?.intercept);
  add("slope_per_decade", trend?.slope_per_decade);
  add("ci_low_per_decade", trend?.ci_low_per_decade);
  add("ci_high_per_decade", trend?.ci_high_per_decade);
  add("alpha", trend?.alpha);
  add("hac_maxlag", trend?.maxlag);
  add("p_value", trend?.p_value);
  add("q_value", trend?.q_value);
  add(
    "family",
    Number.isFinite(trend?.q_value)
      ? "Benjamini–Hochberg across the bundle's records"
      : trend
        ? "not in a multiple-comparison family"
        : ""
  );
  add("significant", trend?.significant);
  add("verdict", trend?.verdict);
  add("exploratory", trend?.exploratory);

  add("r_squared", trend?.r_squared);
  add("sen_slope_per_decade", trend?.sen_slope_per_decade);
  add("mk_tau", trend?.mk_tau);
  add("mk_z", trend?.mk_z);
  add("mk_p", trend?.mk_p);
  add("mk_p_hamed_rao", trend?.mk_p_corrected);
  add("mk_z_hamed_rao", trend?.mk_z_corrected);
  add("mk_variance_factor", trend?.mk_variance_factor);
  add("lag1_residual", trend?.lag1_residual);
  add("durbin_watson", trend?.durbin_watson);

  add("method", "OLS with Newey–West (HAC) standard errors; Hamed–Rao corrected Mann–Kendall");
  add(
    "verdict_rule",
    "significant needs HAC p < alpha and Mann–Kendall agreeing in direction; under 20 annual means a case is exploratory"
  );
  add("claim", "trend detection only; no causal attribution");
  add("exported_at", new Date().toISOString());
  return rows;
}

export function caseSlug({ title, variable, windowKey }) {
  const base = `${title || "case"} ${variable?.short || variable?.code || ""} ${windowKey || ""}`;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "case";
}

export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
