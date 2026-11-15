from __future__ import annotations

import math

import numpy as np

from scripts.statistics import (
    _rank_autocorrelation,
    annual_from_power,
    benjamini_hochberg,
    combined_verdict,
    compute_trend,
    hac_maxlag,
    hamed_rao_mk,
    series_array,
)


def test_hac_maxlag_contract() -> None:
    assert hac_maxlag(36) == 3
    assert hac_maxlag(56) == 3
    assert hac_maxlag(1) == 1


def test_perfect_linear_trend() -> None:
    years = list(range(1990, 2026))
    values = [10.0 + 0.05 * (year - 1990) for year in years]
    result = compute_trend(years, values)
    assert result is not None
    assert result["n"] == 36
    assert math.isclose(result["slope_per_decade"], 0.5, rel_tol=1e-12)
    assert result["verdict"] == "significant increasing"
    assert result["ci_low_per_decade"] <= result["slope_per_decade"] <= result["ci_high_per_decade"]


def test_constant_series_has_no_trend() -> None:
    assert compute_trend(list(range(1990, 2026)), [1.0] * 36) is None


def test_short_series_is_exploratory() -> None:
    years = list(range(2000, 2011))
    values = [1.0 + 0.02 * i for i in range(len(years))]
    result = compute_trend(years, values)
    assert result is not None
    assert result["n"] == 11
    assert result["verdict"] == "exploratory"
    assert result["exploratory"] is True


def test_bh_known_answer() -> None:
    # Hand-checked Benjamini-Hochberg for [0.01, 0.04, 0.03, 0.20] at q = 0.05.
    # Sorted ranks 1-4 give 0.04, 0.06, 0.0533, 0.20, and the step-up minimum
    # carries the smallest value back: 0.04, 0.0533, 0.0533, 0.20.
    q_values, significant = benjamini_hochberg([0.01, 0.04, 0.03, 0.20], q=0.05)
    expected = [0.04, 0.0533333333333333, 0.0533333333333333, 0.20]
    assert np.allclose(q_values, expected)
    assert significant.tolist() == [True, False, False, False]


def test_bh_empty_all_and_none_significant() -> None:
    q_values, significant = benjamini_hochberg([], q=0.05)
    assert q_values.size == 0
    assert significant.size == 0

    q_values, significant = benjamini_hochberg([0.001, 0.002, 0.003], q=0.05)
    assert np.allclose(q_values, [0.003, 0.003, 0.003])
    assert significant.tolist() == [True, True, True]

    q_values, significant = benjamini_hochberg([0.4, 0.6, 0.9], q=0.05)
    assert np.allclose(q_values, [0.9, 0.9, 0.9])
    assert significant.tolist() == [False, False, False]


def test_rank_autocorrelation_known_answer() -> None:
    # Ranks centred to [-2, -1, 0, 1, 2]: denominator 10, and the lagged dot
    # products give 4, -1 and -4, i.e. 0.4, -0.1 and -0.4.
    ranks = np.array([-2.0, -1.0, 0.0, 1.0, 2.0])
    assert math.isclose(_rank_autocorrelation(ranks, 1), 0.4, rel_tol=1e-12)
    assert math.isclose(_rank_autocorrelation(ranks, 2), -0.1, rel_tol=1e-12)
    assert math.isclose(_rank_autocorrelation(ranks, 3), -0.4, rel_tol=1e-12)


def test_hamed_rao_leaves_a_perfect_line_alone() -> None:
    # After removing the Sen slope a clean line has no residual persistence, so
    # the variance factor stays at 1 and the p-value is unchanged.
    result = hamed_rao_mk([1, 2, 3, 4, 5])
    assert result is not None
    assert math.isclose(result["variance_factor"], 1.0, rel_tol=1e-12)
    assert math.isclose(result["p_corrected"], result["p"], rel_tol=1e-12)


def test_hamed_rao_inflates_p_for_autocorrelated_series() -> None:
    rng = np.random.default_rng(7)
    n = 60
    values = np.empty(n)
    values[0] = rng.normal()
    for i in range(1, n):
        values[i] = 0.85 * values[i - 1] + rng.normal()

    result = hamed_rao_mk(values)
    assert result is not None
    assert result["variance_factor"] > 1.5
    assert result["p_corrected"] > result["p"]


def test_hamed_rao_stays_close_to_iid_for_independent_series() -> None:
    rng = np.random.default_rng(11)
    result = hamed_rao_mk(rng.normal(size=60))
    assert result is not None
    # Independent draws should leave the variance factor near 1; the bound is
    # generous because a single sample still has sampling noise.
    assert 0.5 < result["variance_factor"] < 1.5
    assert 0.3 < result["p_corrected"] / result["p"] < 3.0


def test_combined_verdict_requires_both_tests_and_agreement() -> None:
    assert combined_verdict(False, 0.01, 0.2, 0.01, 0.4) == "significant increasing"
    assert combined_verdict(False, 0.01, -0.2, 0.01, -0.4) == "significant decreasing"
    # HAC significant, corrected Mann-Kendall not: not proven.
    assert combined_verdict(False, 0.01, 0.2, 0.20, 0.4) == "no significant trend"
    # McMurdo's shape: HAC p above 5%, corrected Mann-Kendall below it.
    assert combined_verdict(False, 0.06, 0.3, 0.02, 0.25) == "no significant trend"
    # Both significant but pointing opposite ways: not proven.
    assert combined_verdict(False, 0.01, 0.2, 0.01, -0.4) == "no significant trend"
    # Short records stay exploratory no matter what the tests say.
    assert combined_verdict(True, 0.001, 0.2, 0.001, 0.4) == "exploratory"
    # A missing correction cannot promote a case.
    assert combined_verdict(False, 0.001, 0.2, None, 0.4) == "no significant trend"


def test_power_parser_drops_annual_aggregate_and_incomplete_years() -> None:
    series = {}
    for month in range(1, 13):
        series[f"202001"] = 10.0
        series[f"202002"] = 10.0
        series[f"202003"] = 10.0
        series[f"202004"] = 10.0
        series[f"202005"] = 10.0
        series[f"202006"] = 10.0
        series[f"202007"] = 10.0
        series[f"202008"] = 10.0
        series[f"202009"] = 10.0
        series[f"202010"] = 10.0
        series[f"202011"] = 10.0
        series[f"202012"] = 10.0
    series["202013"] = 999.0
    series["202101"] = 12.0
    annual = annual_from_power(series, 2020, 2021)
    assert annual == [(2020, 10.0)]
    assert series_array(annual, 2020, 2021) == [10.0, None]


def test_shipped_values_reproduce_the_published_trend() -> None:
    """A published trend must be re-derivable from the published series.

    The build rounds a series before serialising it. If the fit used the
    unrounded values, a reader recomputing from the bundle gets a different Sen
    slope, Kendall tau and Hamed-Rao p — which is how jeddah / GWETROOT /
    1990-2025 shipped as significant on a p-value its own series does not
    reproduce.
    """
    import numpy as np

    from scripts.statistics import SHIP_DIGITS_POINT, compute_trend, shipped

    years = np.arange(1990, 2026, dtype=float)
    raw = 0.5 + 0.001 * (years - 1990) + np.sin(years) * 0.3
    published = shipped(list(raw), SHIP_DIGITS_POINT)

    from_raw = compute_trend(years, raw)
    from_published = compute_trend(years, np.array(published, dtype=float))

    # Not a formality: rounding moves the rank statistics, so the two fits differ.
    assert from_raw != from_published
    assert from_raw["sen_slope_per_decade"] != from_published["sen_slope_per_decade"]

    # And re-shipping what already shipped is a no-op, which is what makes the
    # offline refit pass idempotent.
    twice = compute_trend(years, np.array(shipped(published), dtype=float))
    assert twice == from_published
