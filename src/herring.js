/**
 * The demo's twist, derived rather than hard-coded.
 *
 * MISSION.md asks for a red-herring case that is steep but not proven. Picking
 * it by name would rot: a data rebuild could make McMurdo significant and the
 * story would break on stage. So the case is chosen from the shipped bundle by
 * the property the demo needs — a featured record with a real slope that both
 * tests refuse to call at the 5% level — and the steepest such record wins.
 */

import { trendOf } from "./bundle.js";

const DEFAULT_VARIABLE = "T2M";

export function deriveSteepUnproven(points, windowKey, variable = DEFAULT_VARIABLE) {
  if (!Array.isArray(points) || !windowKey) return null;

  let best = null;
  for (const point of points) {
    if (!point?.featured) continue;
    const trend = trendOf(point, variable, windowKey);
    if (!trend || trend.exploratory) continue;
    // A verdict needs both tests; this entry only makes sense where the app
    // itself would stamp NOT PROVEN.
    if (trend.verdict !== "no significant trend") continue;
    if (!(Number(trend.p_value) >= 0.05)) continue;

    const slope = Math.abs(Number(trend.slope_per_decade));
    if (!Number.isFinite(slope) || slope <= 0) continue;
    if (!best || slope > best.slope) best = { point, trend, slope };
  }

  return best;
}
