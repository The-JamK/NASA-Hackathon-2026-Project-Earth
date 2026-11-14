# The two-minute demo

Every number below is read from the shipped bundle for 1990–2025; nothing is
memorised from an earlier build. `node scripts/verify_red_herring.mjs` fails if
the twist stops being a twist.

Open `app.html`. The globe is draggable; the ask box and chips are on the left.

| Time | Do | Say |
| --- | --- | --- |
| 0:00 | Stand on the landing page | "Every trend is a claim. We test it." |
| 0:08 | Open the app | "Anyone can draw a line. We start where the line ends: is it real, how fast, and what would change our mind?" |
| 0:15 | Click **Is the Sahel getting drier?** | "The intake reads the question and proposes a case — Niamey rainfall, 63% match. It proposes; it does not compute." |
| 0:22 | **Run this case** | "One straight line over annual means, HAC errors, and a second test that must agree: +0.104 mm per decade, CI 0.061 to 0.148, n = 36, p < 0.001. Significant wetting." |
| 0:35 | Click **Is Nairobi warming?** | "Same contract, different variable: +0.313 °C per decade, CI 0.236 to 0.390, Mann–Kendall p < 0.001. Both tests agree, so it gets a verdict." |
| 0:48 | Type **Is France warming?** and run | "France is a country, not a city: this is the mean of its 3 stations — +0.433 °C per decade, and it survives Benjamini–Hochberg across all 222 country averages." |
| 1:02 | Click **Global** | "The whole field: +0.236 °C per decade, and of 4,039 GISTEMP cells, 3,039 are significant increases, 78 decreases, 922 not proven after FDR correction." |
| 1:18 | Click **Steep, but not proven · McMurdo** | "Now the hard part. McMurdo is +0.303 °C per decade — steeper than the global trend, and seventh steepest of the featured cases. HAC p = 0.060. The interval crosses zero. **NOT PROVEN.**" |
| 1:36 | Open **Show your work**, then the method dialog | "This is what we refuse to do: call that a trend. AI wrote every sentence you just read. It did not compute a single number." |
| 1:50 | Close | "Every trend is a claim. The data decides the verdict." |

## What the twist depends on

The chip is derived, not hard-coded: it opens the steepest featured case whose
verdict is *not proven*. Today that is McMurdo, and the check enforces that it is
still steeper than the median featured case (0.303 vs 0.286 °C/decade). If a data
rebuild changes that, `verify_red_herring.mjs` fails instead of the demo.

## If a judge asks about the ocean

Do not hunt for dots on the water: ask. **"Is the Pacific warming?"** plans
Tropical Pacific, 314 ocean cells, area-weighted sea surface temperature —
+0.069 °C per decade, 95% CI −0.015 to +0.153, HAC p = 0.105, **NOT PROVEN**. It
is the same contract as a city, and the second honest counter-example: the
Tropical Pacific is warming more slowly than the global mean and this record
cannot separate that from scatter. The **Ocean** layer shows the same field
filtered to water (2,672 of 4,039 cells) if they want to see the basin itself.
The Arctic Ocean is the other end of the scale at +0.816 °C per decade.

## If a judge asks about sea ice

Ice is the cleanest pair the app has. **"Is the Arctic sea ice shrinking?"**
opens Arctic sea ice — annual mean of twelve monthly extents — at −0.54 million
km² per decade, HAC p = 1.4e-12, **PROVEN**. Then click **Antarctic sea ice** in
the case panel: −0.23 million km² per decade, 95% CI −0.54 to +0.08, p = 0.136,
**NOT PROVEN**. Same record family, same window, opposite verdicts; that is the
whole point. Say plainly that the annual mean averages the seasonal cycle away
and that extent is not concentration.

Then switch the measure to **Concentration** in the same case: +0.38 percentage
points per decade, HAC p = 0.017 but Mann–Kendall p = 0.086, so still **NOT
PROVEN** — the ice that remains is a little more concentrated, but this record
will not let you claim it. Extent says how far the ice reaches; concentration
says how much of that area is ice. Point at the chart while you say it: both
lines are on it, indexed to 1990 = 100 — the blue extent line falls away, the
amber concentration line drifts up a few percent. Two measures, three verdicts,
one record.

## If the network is off

The globe, every case and the twist come from the cached bundle
(`verify_offline.mjs`). Only the **Live** chip needs the proxy; without it the
chip reads **Snapshot** with its observation time, which is the honest label. Say
so rather than hiding it.

## Rehearsal

Not yet rehearsed end to end with a stopwatch — that is gate G48 in `GATES.md` and
is the one item still open. Run this list twice against the deployed URL before
the two minutes are claimed.
