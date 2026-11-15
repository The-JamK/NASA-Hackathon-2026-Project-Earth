"""Deterministic trend statistics for the Signal & Noise app.

The contract:
  annual means only
  OLS slope with Newey-West HAC standard errors
  L = max(1, floor(4 * (n/100) ** (2/9)))
  verdict at p < alpha with the sign of the slope
  95% interval from HAC SE with Student-t on n-2 df
  Sen's slope as a robust second opinion
  Mann-Kendall with the Hamed-Rao (1998) autocorrelation correction
  a trend is significant only when HAC OLS and corrected Mann-Kendall agree
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

# A trend must be reproducible from the numbers that ship. A build rounds a
# series to these precisions before it fits it, and `scripts/refit_bundle.py`
# enforces the same rule on the published files, so a reader can re-derive every
# published p-value from the published series instead of from values the bundle
# never contained.
SHIP_DIGITS_POINT = 4
SHIP_DIGITS_GRID = 3

VERDICT_INCREASING = "significant increasing"
VERDICT_DECREASING = "significant decreasing"
VERDICT_NONE = "no significant trend"
VERDICT_EXPLORATORY = "exploratory"


def hac_maxlag(n: int) -> int:
    if n < 1:
        raise ValueError(f"n must be at least 1, got {n}")
    return max(1, int(math.floor(4.0 * (n / 100.0) ** (2.0 / 9.0))))


def _rank_autocorrelation(ranks: np.ndarray, lag: int) -> float:
    """Lag-`lag` autocorrelation of a ranked series.

    Uses the standard estimator with the full-series denominator, which is the
    form Hamed and Rao (1998) use for the variance correction.
    """
    centered = ranks - ranks.mean()
    denominator = float(np.dot(centered, centered))
    if denominator <= 0.0 or lag <= 0 or lag >= ranks.size:
        return 0.0
    return float(np.dot(centered[:-lag], centered[lag:]) / denominator)


def hamed_rao_mk(values: Sequence[float]) -> dict[str, float] | None:
    """Mann-Kendall with the Hamed & Rao (1998) variance correction.

    The i.i.d. Mann-Kendall variance of S is
        Var(S) = n (n - 1) (2n + 5) / 18
    and positive autocorrelation inflates the true variance. Hamed and Rao scale
    it by n / n*:

        n/n* = 1 + 2 / (n (n-1) (n-2)) * sum_{i=1}^{n-1} (n-i)(n-i-1)(n-i-2) rho_i

    where rho_i is the lag-i autocorrelation of the ranks. Z is rescaled by
    1 / sqrt(n/n*), so a positively autocorrelated record gets a smaller |Z| and
    a larger p-value than the standard test would give.

    The autocorrelation is estimated on the Sen-detrended series, as Hamed and
    Rao specify: a monotone trend is itself highly autocorrelated, so ranking the
    raw series would count the trend as persistence and over-correct it.

    Returns None when fewer than three finite values are supplied.
    """
    y = np.asarray(values, dtype=float).ravel()
    y = y[np.isfinite(y)]
    n = int(y.size)
    if n < 3:
        return None

    s = 0.0
    for i in range(n - 1):
        s += float(np.sum(np.sign(y[i + 1 :] - y[i])))
    variance = n * (n - 1) * (2 * n + 5) / 18.0
    if variance <= 0.0:
        return None

    if s > 0.0:
        z = (s - 1.0) / math.sqrt(variance)
    elif s < 0.0:
        z = (s + 1.0) / math.sqrt(variance)
    else:
        z = 0.0

    steps = np.arange(n, dtype=float)
    detrended = y - stats.theilslopes(y, steps)[0] * steps
    spread = float(np.ptp(y))
    factor = 1.0
    if n > 3 and float(np.ptp(detrended)) > 1e-12 * max(1.0, spread):
        ranks = stats.rankdata(detrended, method="average")
        total = 0.0
        for lag in range(1, n - 1):
            weight = (n - lag) * (n - lag - 1) * (n - lag - 2)
            if weight:
                total += weight * _rank_autocorrelation(ranks, lag)
        factor = max(1.0, 1.0 + (2.0 / (n * (n - 1) * (n - 2))) * total)
    # The correction may widen the variance, never narrow it, so a negative
    # sample autocorrelation cannot make the test more liberal.
    factor = max(factor, 1.0)

    z_corrected = z / math.sqrt(factor)
    return {
        "n": float(n),
        "s": s,
        "z": z,
        "p": float(2.0 * stats.norm.sf(abs(z))),
        "variance_factor": factor,
        "z_corrected": z_corrected,
        "p_corrected": float(2.0 * stats.norm.sf(abs(z_corrected))),
    }


def combined_verdict(
    exploratory: bool,
    p_value: float,
    slope: float,
    mk_p_corrected: float | None,
    mk_tau: float | None,
    alpha: float = DEFAULT_ALPHA,
) -> str:
    """The verdict contract: both tests must agree on a significant trend.

    A point is only significant when the HAC OLS test and the autocorrelation
    corrected Mann-Kendall test are both significant at alpha and their
    directions agree. Anything else is "no significant trend", and short series
    stay exploratory regardless of the tests.
    """
    if exploratory:
        return VERDICT_EXPLORATORY
    if mk_p_corrected is None or not math.isfinite(mk_p_corrected):
        return VERDICT_NONE
    if p_value >= alpha or mk_p_corrected >= alpha:
        return VERDICT_NONE
    if slope == 0.0 or mk_tau is None or not math.isfinite(mk_tau) or mk_tau == 0.0:
        return VERDICT_NONE
    if (slope > 0.0) != (mk_tau > 0.0):
        return VERDICT_NONE
    return VERDICT_INCREASING if slope > 0.0 else VERDICT_DECREASING


def shipped(
    values: Sequence[float | None], digits: int = SHIP_DIGITS_POINT
) -> list[float | None]:
    """The values as they will be serialised, ready to be fitted."""
    out: list[float | None] = []
    for value in values:
        if value is None or not math.isfinite(float(value)):
            out.append(None)
        else:
            out.append(round(float(value), digits))
    return out


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

    corrected = hamed_rao_mk(y)
    mk_p_corrected = corrected["p_corrected"] if corrected else None
    mk_z_corrected = corrected["z_corrected"] if corrected else None
    mk_variance_factor = corrected["variance_factor"] if corrected else None

    residuals = np.asarray(fit.resid, dtype=float)
    lag1 = float(np.corrcoef(residuals[:-1], residuals[1:])[0, 1]) if n > 2 else 0.0
    dw = float(durbin_watson(residuals))

    exploratory = n < MIN_YEARS
    verdict = combined_verdict(exploratory, p_value, slope, mk_p_corrected, tau, alpha)

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
        "mk_p_corrected": mk_p_corrected,
        "mk_z_corrected": mk_z_corrected,
        "mk_variance_factor": mk_variance_factor,
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
    return [
        round(lookup[year], SHIP_DIGITS_POINT) if year in lookup else None
        for year in range(start, end + 1)
    ]
