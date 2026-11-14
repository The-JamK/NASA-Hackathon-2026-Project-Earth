"""Deterministic trend statistics for the Case Files app.

The contract:
  annual means only
  OLS slope with Newey-West HAC standard errors
  L = max(1, floor(4 * (n/100) ** (2/9)))
  verdict at p < alpha with the sign of the slope
  95% interval from HAC SE with Student-t on n-2 df
  Sen's slope as a robust second opinion
  Mann-Kendall descriptive only
  below 20 annual observations -> exploratory, no significance claim

The browser never computes a verdict. Every number it displays comes from this
module (for points and the global grid) or from the same contract in the build
scripts.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

import numpy as np
from scipy import stats
from statsmodels.regression.linear_model import OLS
from statsmodels.stats.stattools import durbin_watson

MIN_YEARS = 20
DEFAULT_ALPHA = 0.05

VERDICT_INCREASING = "significant increasing"
VERDICT_DECREASING = "significant decreasing"
VERDICT_NONE = "no significant trend"
VERDICT_EXPLORATORY = "exploratory"


def hac_maxlag(n: int) -> int:
    if n < 1:
        raise ValueError(f"n must be at least 1, got {n}")
    return max(1, int(math.floor(4.0 * (n / 100.0) ** (2.0 / 9.0))))


def compute_trend(
    years: Sequence[float],
    values: Sequence[float],
    alpha: float = DEFAULT_ALPHA,
) -> dict[str, object] | None:
    """Return the contracted fit, or None when the series cannot support one."""
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must lie strictly between 0 and 1")

    x = np.asarray(years, dtype=float).ravel()
    y = np.asarray(values, dtype=float).ravel()
    if x.size != y.size:
        raise ValueError("years and values differ in length")
    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]
    n = int(x.size)
    if n < 3 or np.unique(x).size < 2 or float(np.ptp(y)) == 0.0:
        return None

    maxlag = min(hac_maxlag(n), max(1, n - 2))
    design = np.column_stack([np.ones(n), x])
    fit = OLS(y, design).fit(cov_type="HAC", cov_kwds={"maxlags": maxlag})

    slope = float(fit.params[1])
    covariance = np.asarray(fit.cov_params(), dtype=float)
    standard_error = float(math.sqrt(covariance[1, 1]))
    if not math.isfinite(standard_error) or standard_error <= 0.0:
        return None

    dof = n - 2
    t_statistic = slope / standard_error
    p_value = float(2.0 * stats.t.sf(abs(t_statistic), dof))
    t_critical = float(stats.t.ppf(1.0 - alpha / 2.0, dof))
    ci_low = (slope - t_critical * standard_error) * 10.0
    ci_high = (slope + t_critical * standard_error) * 10.0

    sen = float(stats.theilslopes(y, x, alpha=1.0 - alpha)[0]) * 10.0
    kendall = stats.kendalltau(x, y)
    tau = float(kendall.statistic)
    mk_p = float(kendall.pvalue)
    if math.isfinite(mk_p) and mk_p > 0.0:
        mk_z = float(stats.norm.isf(mk_p / 2.0)) * (1.0 if tau >= 0 else -1.0)
    else:
        mk_z = 0.0

    residuals = np.asarray(fit.resid, dtype=float)
    lag1 = float(np.corrcoef(residuals[:-1], residuals[1:])[0, 1]) if n > 2 else 0.0
    dw = float(durbin_watson(residuals))

    exploratory = n < MIN_YEARS
    if exploratory:
        verdict = VERDICT_EXPLORATORY
    elif p_value < alpha and slope > 0:
        verdict = VERDICT_INCREASING
    elif p_value < alpha and slope < 0:
        verdict = VERDICT_DECREASING
    else:
        verdict = VERDICT_NONE

    return {
        "n": n,
        "maxlag": maxlag,
        "alpha": alpha,
        "slope_per_decade": slope * 10.0,
        "intercept": float(fit.params[0]),
        "ci_low_per_decade": ci_low,
        "ci_high_per_decade": ci_high,
        "p_value": p_value,
        "r_squared": float(fit.rsquared),
        "sen_slope_per_decade": sen,
        "mk_tau": tau,
        "mk_z": mk_z,
        "mk_p": mk_p,
        "lag1_residual": lag1,
        "durbin_watson": dw,
        "verdict": verdict,
        "exploratory": exploratory,
    }


def benjamini_hochberg(p_values: Iterable[float], q: float = 0.05) -> tuple[np.ndarray, np.ndarray]:
    """Return BH adjusted q-values and the q <= threshold mask.

    NaN p-values are returned as NaN and never significant.
    """
    p = np.asarray(list(p_values), dtype=float)
    q_values = np.full(p.shape, np.nan, dtype=float)
    valid = np.isfinite(p)
    if not np.any(valid):
        return q_values, np.zeros(p.shape, dtype=bool)

    values = p[valid]
    order = np.argsort(values)
    ranked = values[order]
    m = ranked.size
    adjusted = np.empty(m, dtype=float)
    previous = 1.0
    for i in range(m - 1, -1, -1):
        value = min(previous, ranked[i] * m / (i + 1))
        adjusted[i] = value
        previous = value
    restored = np.empty(m, dtype=float)
    restored[order] = adjusted
    q_values[valid] = restored
    return q_values, q_values <= q


def annual_from_power(
    series: dict[str, object],
    start: int,
    end: int,
) -> list[tuple[int, float]]:
    """POWER monthly dictionary -> complete annual means.

    Drops the YYYY13 annual aggregate, maps -999 to NaN, and keeps a year only
    when all twelve months are finite.
    """
    by_year: dict[int, dict[int, float]] = {}
    for key, value in series.items():
        if len(key) != 6 or not key.isdigit():
            continue
        year, month = int(key[:4]), int(key[4:])
        if month == 13 or not (start <= year <= end):
            continue
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        number = float(value)
        if number <= -999.0 or not math.isfinite(number):
            continue
        by_year.setdefault(year, {})[month] = number

    annual: list[tuple[int, float]] = []
    for year in sorted(by_year):
        months = by_year[year]
        if len(months) == 12 and all(math.isfinite(v) for v in months.values()):
            annual.append((year, sum(months.values()) / 12.0))
    return annual


def series_array(
    annual: Sequence[tuple[int, float]],
    start: int,
    end: int,
) -> list[float | None]:
    """Project annual pairs onto a fixed year grid, using None for gaps."""
    lookup = {year: value for year, value in annual}
    return [round(lookup[year], 4) if year in lookup else None for year in range(start, end + 1)]
