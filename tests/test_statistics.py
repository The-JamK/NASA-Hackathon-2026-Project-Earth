from __future__ import annotations

import math

import numpy as np

from scripts.statistics import (
    annual_from_power,
    benjamini_hochberg,
    compute_trend,
    hac_maxlag,
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
    q_values, significant = benjamini_hochberg([0.01, 0.04, 0.03, 0.20], q=0.05)
    assert significant.tolist() == [True, False, False, False]
    assert np.all(np.isfinite(q_values))


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
