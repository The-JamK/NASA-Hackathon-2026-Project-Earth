# Gates: Earth System Trend Detective — Signal & Noise

OWNS: whole project
Scope: a fresh, static web app with a Google-Earth-style 3D globe, real NASA/Meteomatics data bundles, deterministic trend statistics, local vector RAG for case plans, and a case-file UI.

Last verified: 2026-11-14

- [x] G1: The data build produces a bundle with at least 25 points, at least 2,000 global grid cells, and four variables, all from real cached sources.
  CHECK: uv run python scripts/verify_data.py
  EXPECT: data verified
  EVIDENCE: 688 points across 222 countries and territories · 14 featured · 6 live · 687 points with all four variables · 4,039 grid cells · 6 source checks ok · global 1990–2025 slope +0.2362 °C/decade.

- [x] G2: The statistics engine reproduces known-answer fixtures for OLS/HAC, Sen's slope, and Mann–Kendall within tolerance.
  CHECK: uv run --with pytest pytest -q
  EXPECT: passed
  EVIDENCE: 12 tests passed. pytest is not a declared dependency, so the check supplies it with `--with`; bare `uv run pytest` cannot find the module.

- [x] G3: The production frontend build succeeds.
  CHECK: npm run build
  EXPECT: built in
  EVIDENCE: built in 4.04s; CSS 15.97 kB; JS 1,955.52 kB (564.89 kB gzip).

- [x] G4: The dev server serves the built app and every required data asset returns HTTP 200.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: page, 3 globe textures, 14 context images and all JSON bundles returned 200; app verified.

- [x] G5: The local vector RAG returns the expected variables for nine golden questions.
  CHECK: node scripts/verify_rag.mjs
  EXPECT: rag verified
  EVIDENCE: 9 golden questions, time parsing and empty-input handling verified.

- [x] G6: No secrets, no pre-hackathon prototype code, and no unignored `.env` are present in the repo.
  CHECK: node scripts/verify_clean.mjs
  EXPECT: clean verified
  EVIDENCE: local `.env` is ignored; no tracked credentials; no prototype path references; ignore rules include `.env`, `node_modules`, `dist`, `data/cache`, `.DS_Store`.

- [x] G7: The case-file UI works at desktop and narrow viewport widths: globe renders, a point click opens a case, and the Ask box returns a plan.
  MANUAL: verified through the preview panel with console/network checks.
  EVIDENCE: WebGL canvas 2880×1800 at 1440×900; Nairobi case CASE-6CA4; Ask “Is the Sahel getting drier?” returned a 63% Niamey rainfall plan; global case counted 3,039 increasing / 78 decreasing / 922 not significant; 2000–2025 switch updated the verdict; 400, 700 and 800 px layouts checked; method dialog 720×702; preview clicks open and close cases after the loading layer is removed; console contained only Vite debug messages.

- [x] G8: The app works from the cached bundle with the network off for data (no live API required to render a case).
  CHECK: node scripts/verify_offline.mjs
  EXPECT: offline verified
  EVIDENCE: no external URLs in app source; 554 points, 4,039 grid cells, 36 global years and 14 context images all local. The check strips the landing page's outbound repository link and its inline SVG namespace URI, which are a link and a namespace rather than requests; it previously failed on them, so the oracle now states what it actually tests.

- [x] G9: A featured red-herring case presents a steep slope without a significance claim.
  CHECK: uv run python scripts/verify_data.py
  EXPECT: data verified
  EVIDENCE: McMurdo T2M +0.303 °C/decade, p = 0.060, verdict NOT PROVEN.

- [x] G10: Every featured point labels its actual imagery source, and at least ten serve real Sentinel-2 L2A pixels fetched through Planetary Computer's STAC/mosaic APIs with RGB band handling and recorded HTTP proof.
  CHECK: uv run python scripts/verify_sentinel.py
  EXPECT: sentinel verified
  EVIDENCE: 14/14 featured points use Sentinel-2 L2A mosaics; each has 9/9 HTTP 200 mosaic tiles. Unsigned visual COG returns HTTP 409 PublicAccessNotPermitted; SAS signing returns 200; signed Range GET returns 206; the COG is 3-band uint8 RGB with scale 1.0. `data/sentinel_report.json` records the item, URLs and statuses; no SAS token is stored.

- [x] G11: The production build works at the GitHub Pages repository subpath, not only at the domain root.
  CHECK: npm run build, then serve `dist` under `/NASA-Hackathon-2026-Project-Earth/`
  EXPECT: `./assets`, data, textures and point imagery all return 200; app opens a case
  EVIDENCE: built `dist/index.html` references `./assets/...`; local subpath test returned 200 for JS, CSS, `data/points.json`, all three globe textures and `data/imagery/nairobi-sentinel.jpg`; Nairobi case opened with a 640×360 image and no console errors. `.github/workflows/deploy.yml` publishes `dist` through GitHub Actions.

- [x] G12: A tapped coordinate resolves to the nearest station the bundle holds and to the nearest GISTEMP cell, both being the true minimum, with distance and bearing.
  CHECK: node scripts/verify_locate.mjs
  EXPECT: locate verified
  EVIDENCE: 24 assertions over 554 stations and 4,039 cells; nearest station and nearest cell equal a brute-force haversine minimum at the Sahara, London, Sydney, mid-Pacific, Kigali and Reykjavik taps; equatorial distance 1,113.19 km, symmetry, zero-distance, compass strings (E/S/N/NW), coordinate formatting, and null returns on an empty bundle and an empty grid.

- [x] G13: The app ships the tap recommendation instead of the map panel: `#recommendation` is served, `recommendAt`/`nearestCell` are wired, and no map panel, locate form, map canvas, `MapView` or Google Maps link remains.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: page, 554 points, 4,039 grid cells, 3 textures, 14 context images; output lines `recommendation: overlay element served and wired to the tap handler` and `chrome: …`; the check now fails on `#map-panel`, `#locate-form`, `#map-canvas`, `MapView` or any `google.com/maps` reference and passes.

- [x] G14: The production build succeeds with the tap recommendation and halo layer.
  CHECK: npm run build
  EXPECT: built in
  EVIDENCE: built in 6.67s on the final source; only the existing chunk-size warning.

- [x] G15: The recommendation needs no map service: no external URL and no fetch in the app source, and the overlay is computed from the cached bundle.
  CHECK: node scripts/verify_offline.mjs
  EXPECT: offline verified
  EVIDENCE: `index.html`, `src/main.js`, `src/rag.js`, `src/chart.js`, `src/style.css` and `src/geo.js` contain no external URL; `src/geo.js` performs no fetch; the only allowed outbound references remain the landing page's inline SVG namespace and repository link.

- [x] G16: In the browser the first tap on the world (no prior hover) puts a yellow marker on the tapped point, draws yellow dashed arcs with distance labels to the nearest station and the nearest cell, and shows a card whose Open and close actions work.
  MANUAL: verified in the Cloud browser at 1440×900 against the dev server.
  EVIDENCE: an un-hovered tap at (700, 430) resolved 15.55°N 3.34°E, nearest station Niamey 261 km SSW, nearest cell 15.0°N 5.0°E 189 km, and placed the card at (722, 448); a tap in the South Atlantic resolved 15.31°S 4.55°W with Accra 2,375 km NNE and cell 17.0°S 3.0°W 250 km, drawn as two dashed yellow arcs with `2,375 km` and `250 km` labels; Open on the station row rendered the Accra case and cleared the card and arcs; the × removed the card and the state; a second tap after closing produced a new recommendation; console showed only the expected `/api/live` 503 (no Meteomatics credentials). The map panel, locate form and Google Maps link are absent from the page.

- [x] G17: The work is pushed to `main` on GitHub.
  CHECK: git rev-parse HEAD and git rev-parse FETCH_HEAD agree after fetching `main`.
  EXPECT: identical hashes
  EVIDENCE: pushed `63cc511..3cd5c4e HEAD -> main`; `git rev-parse HEAD` and `FETCH_HEAD` both returned `3cd5c4eb52d168ba14783d206e75523fd7cb3099`.

- [x] G18: The tagline “Ask the planet. Get the evidence.”, the dot inside the wordmark, the intake label and the “Case board” wording are gone from both pages and from main.js, and the wordmark reads GAUSSIAN FRONTIERS.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: output lines `chrome: tagline, brand dot, Intake label and case board wording removed` and `case layout: narrative paragraph above the verdict block`; rendered brand text is `GAUSSIAN FRONTIERS`; the landing title is `Signal & Noise — NASA Space Apps 2026`. The landing page's only h1 was that sentence, so the page label now carries it at the kicker's size (9 px, accent) — the hero renders identically to before.

- [x] G19: With no case open the right-hand panel is not rendered; opening a case shows it.
  MANUAL: verified in the Cloud browser at 1440×900 against the dev server.
  EVIDENCE: on load the case panel's computed `display` was `none` and its text was empty; `#featured-grid` and the “How a case works” block are gone from the page; locating Nairobi set `display: block` and rendered the case; “Case board” appears in no state.

- [x] G20: In an open case the narrative paragraph sits after the Temperature/Rainfall/Soil/Solar and Window buttons and before the verdict stamp, above the chart and the facts, with its styling unchanged.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: source-order assertion reports `case layout: narrative paragraph above the verdict block`; measured DOM order in the browser was case-head, place-title, place-sub, live-chip, imagery, var-chips, window-row, narrative, verdict, chart, facts; the paragraph keeps `.narrative` (12 px, `#c4d0da`).

- [x] G21: The production build succeeds after the chrome changes.
  CHECK: npm run build
  EXPECT: built in
  EVIDENCE: built in 6.81s; only the existing chunk-size warning.

- [x] G22: The chrome changes are pushed to `main` after the localhost check.
  CHECK: git rev-parse HEAD and git rev-parse FETCH_HEAD agree after fetching `main`.
  EXPECT: identical hashes
  EVIDENCE: pushed `a5c2b6a..acdabc2 HEAD -> main` after the browser checks; HEAD and FETCH_HEAD both returned `acdabc2` for the feature commit, and the ledger follow-up advanced `main` afterwards.

- [x] G23: The tap recommendation and its ledger are pushed to `main` on GitHub.
  CHECK: git rev-parse HEAD and git rev-parse FETCH_HEAD agree after fetching `main`.
  EXPECT: identical hashes
  EVIDENCE: pushed `d73057e..ea41331 HEAD -> main`; `git rev-parse HEAD` and `FETCH_HEAD` both returned `ea41331` for the feature commit, and the ledger follow-up advanced `main` afterwards.

- [x] G24: Grid-cell p-values are corrected with Benjamini–Hochberg at q = 0.05, every count uses the adjusted q, and the function matches a hand-checked answer plus the empty, all-significant and none-significant edges.
  CHECK: uv run --with pytest pytest -q
  EXPECT: passed
  EVIDENCE: the known answer returns q = [0.04, 0.0533, 0.0533, 0.20] and one discovery for p = [0.01, 0.04, 0.03, 0.20]; the edge test covers empty input, q = 0.003 for [0.001, 0.002, 0.003] and q = 0.9 for [0.4, 0.6, 0.9] with no discoveries. The shipped grid moves 1990–2025 from 3,100 / 81 / 858 raw to 3,039 / 78 / 922 adjusted, and `verify_data.py` pins the adjusted counts.

- [x] G25: Mann–Kendall carries the Hamed–Rao (1998) variance correction, is tested against known answers, and leaves a clean line alone while widening an autocorrelated one.
  CHECK: uv run --with pytest pytest -q
  EXPECT: passed
  EVIDENCE: rank autocorrelation returns 0.4 / −0.1 / −0.4 on a linear rank vector; a perfect line keeps factor 1.000 and an unchanged p; an AR(1) series with φ = 0.85 gives factor > 1.5 and a larger corrected p; 60 i.i.d. draws stay inside factor 0.5–1.5 and a p ratio of 0.3–3.0. On the real bundles Nairobi and Niamey rainfall keep factor 1.00 and McMurdo is 1.07 (p 0.0283 → 0.0348). Correction is estimated on the Sen-detrended series, because ranking the raw trended series over-corrected and flipped Nairobi.

- [x] G26: A point is significant only when the HAC OLS test and the corrected Mann–Kendall agree at 5% in direction, and short records stay exploratory.
  CHECK: uv run --with pytest pytest -q; uv run python scripts/verify_data.py
  EXPECT: passed; data verified
  EVIDENCE: seven verdict cases pass, including McMurdo's shape (HAC 0.06, MK 0.02 → not proven), a direction conflict and a missing correction. Backfilling 537 stored point trends moves 27 to not proven (22 increasing, 5 decreasing); `verify_data.py` now fails if a stored verdict claims a trend without both tests. Global verdicts stay significant increasing for 1990–2025 and 2000–2025, and the grid-cell counts stay BH-based.

- [x] G27: The red-herring case is described as steep but not proven at the 5% level, not as noise.
  CHECK: grep -rin "noise" over the source, docs and scripts
  EXPECT: no claim that a steep line is noise
  EVIDENCE: MISSION.md now reads "A red-herring case is steep but not proven at the 5% level." The other hits (app.html "distinguishable from noise", main.js "cannot separate one from noise", a test comment) are statements about separating a slope from scatter. McMurdo still renders NOT PROVEN at HAC p 0.060 with corrected MK p 0.035, so nothing was tuned to keep the story.

- [x] G28: Both pages, the docs and the method dialog name the product Signal & Noise, the old name is gone, and the ampersand is escaped in HTML.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: rendered titles are `Signal &amp; Noise — NASA Space Apps 2026` and `Signal &amp; Noise — Gaussian Frontiers`; the landing kicker and both footers read Signal & Noise. verify_app now fails if either page lacks `Signal &amp; Noise` or still matches /case files/i, and `grep -ri "case files"` returns only that guard. The repository name, folder, `base "./"`, asset and data paths, worker names and `case-files-*` user agents are unchanged, as are generic "case file" phrases and CASE- ids.

- [x] G29: Every country and territory contributes its three largest populated places, conurbations are not duplicated, and a point ships only with all four NASA POWER variables.
  CHECK: uv run python scripts/build_data.py --skip-grid --skip-imagery; uv run python scripts/verify_data.py
  EXPECT: data verified
  EVIDENCE: Natural Earth populated places (7,342 rows, public domain) ranked by `POP_MAX` per `ADM0NAME`: 568 candidates across 228 units, 64 of which hold fewer than three places. 53 candidates matched the curated 45 (same name or <15 km), 14 conurbations were merged (Giza/Cairo 6.1 km, Piraeus/Athens 4.5 km, Callao/Lima 10.4 km) and 6 were dropped for a masked root-zone soil moisture series (Majuro, Funafuti, Malé, Atafu, Esperanza Base, Casey Station). Result after the sparse-region passes in G31, G33 and G34: 45 curated + 509 top-city + 134 sparse = 688 points, 687 with four variables and McMurdo with three. `points.json` is 5.9 MB, `rag_index.json` 73 KB with 684 places, 14 Sentinel-2 mosaics, and 6 Meteomatics snapshots carried from `data/cache`. Earthdata could not be re-authenticated because every value in the local `.env` is empty, so `sources.json` keeps the earlier verification and says so in the detail line.

- [x] G30: The expanded bundle and its pipeline are pushed to `main` on GitHub.
  CHECK: git rev-parse HEAD and git rev-parse origin/main agree after fetching `main`.
  EXPECT: identical hashes
  EVIDENCE: pushed `c78898d..62dc704 HEAD -> main`; `git rev-parse HEAD` and `origin/main` both returned `62dc704dd619c6dd7c2305f5e87dcfad7923f404`. The ledger follow-up advanced `main` afterwards.

- [x] G31: Regions the per-country rule leaves thin gain the largest city that no existing point covers within 500 km, so station density follows land area rather than country count.
  CHECK: uv run python scripts/build_data.py --skip-grid --skip-imagery; uv run python scripts/verify_data.py
  EXPECT: data verified
  EVIDENCE: `fill_sparse_regions` scans Natural Earth's 7,342 places for Russia, northern China (lat ≥ 35), the Sahara belt (lat ≥ 15), North America, South America and Australia and accepts a place only when it is at least 500 km from every existing or newly accepted station and holds at least 20,000 people. Result: across the six original regions 109 were added — North America 29, South America 29, Russia 25, northern China 11, Australia 8, North Africa 7 — taking Russia from 3 to 28 stations, northern China from 1 to 12, North Africa from 23 to 30, North America from 67 to 96, South America from 37 to 66 and Australia from 4 to 12 (Darwin and Adelaide included), while Europe and the Mediterranean stay at 126.

- [x] G33: The rule also covers Southeast Asia, the Middle East and the Indian interior, and no station is named after its own country.
  CHECK: uv run python scripts/build_data.py --skip-grid --skip-imagery; uv run python scripts/verify_data.py
  EXPECT: data verified
  EVIDENCE: The same 500 km / 20,000-person rule added 21 more stations — Southeast Asia 12 (Makassar, Pontianak, Samarinda, Banda Aceh, Manado, Bengkulu, Ambon, Jayapura, Biak, Kota Waingapu, Merauke, Puerto Princesa), India 6 (Amaravati, Nagpur, Mangalore, Udaipur, Berhampur, Port Blair) and the Middle East 3 (Zahedan, Hail, Ash Shihr). Southeast Asia's worst gap falls from 1,421 km to 664 km across 26 → 38 stations; India's mean nearest-neighbour distance falls from 1,200 km to 640 km across 3 → 9 stations; the Middle East is already dense (40 → 43 stations, worst gap 845 → 736 km). Bundle is 684 points, 683 with all four variables, 222 countries.
  NOTE: Natural Earth labels Hail, Saudi Arabia, with `NAME_EN` of "Saudi Arabia", which had put a station named after the country on the map. `_record` now falls back to `NAME` when `NAME_EN` duplicates the country, so Hail appears under its own name; the earlier flat "name equals country" filter was reverted because it also deleted Monaco, Luxembourg and Djibouti City, dropping three countries from the bundle.

- [x] G34: The rule extends to Central Asia, the Amazon interior and the Sahel, and the remaining thin regions are reported by spacing rather than station count.
  CHECK: uv run python scripts/build_data.py --skip-grid --skip-imagery; uv run python scripts/verify_data.py
  EXPECT: data verified
  EVIDENCE: Central Asia (Kazakhstan, Kyrgyzstan, Tajikistan, Turkmenistan, Uzbekistan) gained 3 stations — Oskemen, Atyrau, Baikonur — taking it 15 → 18; the Sahel belt (10–18°N from Senegal to Sudan) gained 1, Nyala, taking it 17 → 18 and cutting its worst nearest-neighbour gap from 1,926 km to 914 km; the Amazon interior (basin countries, 16°S–6°N, 75–44°W) needed none, because the South America pass had already left every settlement of 20,000-plus within 500 km of a station and the 945 km worst gap falls over unpopulated forest. Central Asia's worst gap stays large (785 → 866 km) for the same reason the rule is defined that way: a station is only placed where nothing is within 500 km, so a desert filling point is itself remote.
- [x] G35: A country name reaches that country's principal station from every spelling, not the global field.
  CHECK: uv run python scripts/build_data.py --skip-grid --skip-imagery; node scripts/verify_rag.mjs
  EXPECT: rag verified
  EVIDENCE: All 688 stations now carry their country name as an alias, and `COUNTRY_SPELLINGS` stamps usa/us, uae and uk/britain on the stations of those countries. `resolvePlace` breaks ties by alias length, then the hand-curated flag, then population, so "United States", "USA" and "US" all resolve to Los Angeles (the largest hand-curated US case), "UAE" to Dubai and "UK" to London, while city questions are unchanged (Yakutsk → Yakutsk, Nairobi → Nairobi, Delhi → Delhi). Before this, "Is the United States warming?" fell through to the global GISTEMP field because the retrieval index knew the country only as "usa" and "us".
  NOTE: The tie-break matters. With the country alias on every station, a country query matches 22 US entries; without an ordering rule the winner was whichever entry came first in the index.

  NOTE: Spacing is the honest metric here, not counts. Adding stations can raise the mean nearest-neighbour distance whenever the new station is the remote one being added, which is why these three regions are reported with median and worst gap alongside the mean. Bundle is 688 points, 687 with all four variables, 222 countries.

- [x] G32: Generated points use the hand-curated country names, so one country is never listed twice and no Natural Earth typo reaches the interface.
  CHECK: uv run python scripts/build_data.py --skip-grid --skip-imagery; python -c "import json; p=json.load(open('public/data/points.json'))['points']; print(len({x['country'] for x in p}))"
  EXPECT: 222
  EVIDENCE: Before the alias table the bundle reported 225 countries, with the United States split across `United States` (5 curated) and `United States of America` (17 generated), the UAE across `UAE` and `United Arab Emirates`, and New Zealand listed as `Necw Zealand`. `COUNTRY_ALIASES` maps those three onto the curated spelling; country count is 222, the 22 US points share one label, and filtering or asking about a country returns all of its stations.

## Status

- [x] G36: Every country in the bundle has a country-average record: a mean annual series, trends for every variable and window, and its stations accounted for.
  CHECK: uv run python scripts/verify_countries.py
  EXPECT: countries verified
  EVIDENCE: `build_countries` groups the 688 stations into 222 countries, averages each annual value across that country's stations, and runs the same estimator at country scale with Benjamini–Hochberg applied across the 222 averages. The verifier recomputes every mean value from the member stations and requires it to sit inside the station range: `countries: 222 · stations: 688 · 175 averaged over several stations`. Antarctica carries three variables rather than four because McMurdo has no root-zone soil moisture, and the checker requires exactly the variables its stations carry.

- [x] G37: A country question plans a country-average case and offers that country's cities, while city and global questions keep their current plans.
  CHECK: node scripts/verify_country_plan.mjs
  EXPECT: country plan verified
  EVIDENCE: `resolveCountry` matches country names and short spellings with word boundaries and prefers the longer match, so "Is France warming?" plans the country average even though Paris carries a "france" alias, while Nairobi, Delhi, London, Yakutsk and the Sahel question still plan their city cases and "Is the world warming?" still plans the global field. The runner plans all 222 countries: `country plans: 222 · city regressions: 5 · global: 1 · aliases: 226`.

- [x] G38: The plan card lists the country's cities and the country case renders its station count (manual browser check).
  CHECK: manual
  EXPECT: the country plan shows an average line plus clickable city suggestions, and opening it renders a case with the station count.
  EVIDENCE: On the dev server, "Is France warming?" produced a plan card reading `France average · France · 3 stations · 1990–2025 · °C` with Paris, Lyon and Marseille as chips; clicking a chip re-planned that city (Paris, city case). "Is India warming?" opened a country case headed `COUNTRY AVERAGE · 9 STATIONS · ASIA` with the mean series, `Stations averaged 9`, and eight city chips. Clicking Paris opened the city case. Screenshot captured at the India country average: +0.037 °C per decade, `NOT PROVEN`.

- [x] G39: The full check suite still passes with country averages in the bundle.
  CHECK: bash scripts/verify_all.sh
  EXPECT: all checks passed
  EVIDENCE: Ran `bash scripts/verify_all.sh`; every check passed and the run ended with `all checks passed`. The new bundle is 688 points, 222 country averages, 4,039 grid cells, 620 city suggestions, with `countries.json` 2.0 MB made from the same station series.

- [x] G40: The country-average feature is pushed, deployed and resolves on the live site.
  CHECK: bash scripts/verify_live.sh
  EXPECT: live verified
  EVIDENCE: Pushed and confirmed with `bash scripts/verify_live.sh`: `points.json`, `rag_index.json` and `countries.json` all match `dist`, and the deployed bundle plans all 222 country averages plus the city spot checks (`live plan verified`).

- [x] G41: The globe skin is a genuinely higher-resolution map, and the build cannot quietly ship a smaller one.
  CHECK: node scripts/verify_textures.mjs
  EXPECT: textures verified
  EVIDENCE: The texture was the three-globe example image at 4096×2048 (1.46 MB). It is now NASA GIBS Blue Marble shaded relief and bathymetry at 8192×4096 (3.12 MB), which is 30 texels per degree at the equator and twice the linear detail of the old file. `verify_textures.mjs` parses the JPEG and PNG headers and requires 2:1 equirectangular images of at least 8192×4096, 2048×1024 and 4096×2048; it is wired into `scripts/verify_all.sh`, so the suite reports `textures verified` before `all checks passed`. Visual check on the dev server: coastlines, terrain and bathymetry are visibly sharper with no WebGL or console texture errors.

MET: 41
UNMET: 0
ABANDONED: 0
