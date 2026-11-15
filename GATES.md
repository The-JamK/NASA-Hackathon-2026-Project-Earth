# Gates: Earth System Trend Detective — Signal & Noise

OWNS: whole project
Scope: a fresh, static web app with a Google-Earth-style 3D globe, real NASA/Meteomatics data bundles, deterministic trend statistics, local vector RAG for case plans, and a case-file UI.

Last verified: 2026-11-14

- [x] G1: The data build produces a bundle with at least 25 points, at least 2,000 global grid cells, and four variables, all from real cached sources.
  CHECK: uv run python scripts/verify_data.py
  EXPECT: data verified
  EVIDENCE: 708 points across 222 countries and territories · 14 featured · 6 live · 696 points with all four variables · 4,039 grid cells · 6 source checks ok · global 1990–2025 slope +0.2362 °C/decade.

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
  EVIDENCE: Natural Earth populated places (7,342 rows, public domain) ranked by `POP_MAX` per `ADM0NAME`: 568 candidates across 228 units, 64 of which hold fewer than three places. 53 candidates matched the curated 45 (same name or <15 km), 14 conurbations were merged (Giza/Cairo 6.1 km, Piraeus/Athens 4.5 km, Callao/Lima 10.4 km) and 6 were dropped for a masked root-zone soil moisture series (Majuro, Funafuti, Malé, Atafu, Esperanza Base, Casey Station). Result after the sparse-region passes in G31, G33, G34 and the polar list in G43: 65 curated + 509 top-city + 134 sparse = 708 points, 696 with four variables and twelve with three. `points.json` is 6.1 MB, `rag_index.json` 101 KB with 708 places, 14 Sentinel-2 mosaics, and 6 Meteomatics snapshots carried from `data/cache`. Earthdata could not be re-authenticated because every value in the local `.env` is empty, so `sources.json` keeps the earlier verification and says so in the detail line.

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
  EVIDENCE: All 708 stations now carry their country name as an alias, and `COUNTRY_SPELLINGS` stamps usa/us, uae and uk/britain on the stations of those countries. `resolvePlace` breaks ties by alias length, then the hand-curated flag, then population, so "United States", "USA" and "US" all resolve to Los Angeles (the largest hand-curated US case), "UAE" to Dubai and "UK" to London, while city questions are unchanged (Yakutsk → Yakutsk, Nairobi → Nairobi, Delhi → Delhi). Before this, "Is the United States warming?" fell through to the global GISTEMP field because the retrieval index knew the country only as "usa" and "us".
  NOTE: The tie-break matters. With the country alias on every station, a country query matches 22 US entries; without an ordering rule the winner was whichever entry came first in the index.

  NOTE: Spacing is the honest metric here, not counts. Adding stations can raise the mean nearest-neighbour distance whenever the new station is the remote one being added, which is why these three regions are reported with median and worst gap alongside the mean. Bundle is 708 points, 696 with all four variables, 222 countries.

- [x] G32: Generated points use the hand-curated country names, so one country is never listed twice and no Natural Earth typo reaches the interface.
  CHECK: uv run python scripts/build_data.py --skip-grid --skip-imagery; python -c "import json; p=json.load(open('public/data/points.json'))['points']; print(len({x['country'] for x in p}))"
  EXPECT: 222
  EVIDENCE: Before the alias table the bundle reported 225 countries, with the United States split across `United States` (5 curated) and `United States of America` (17 generated), the UAE across `UAE` and `United Arab Emirates`, and New Zealand listed as `Necw Zealand`. `COUNTRY_ALIASES` maps those three onto the curated spelling; country count is 222, the 22 US points share one label, and filtering or asking about a country returns all of its stations.

## Status

- [x] G36: Every country in the bundle has a country-average record: a mean annual series, trends for every variable and window, and its stations accounted for.
  CHECK: uv run python scripts/verify_countries.py
  EXPECT: countries verified
  EVIDENCE: `build_countries` groups the 708 stations into 222 countries, averages each annual value across that country's stations, and runs the same estimator at country scale with Benjamini–Hochberg applied across the 222 averages. The verifier recomputes every mean value from the member stations and requires it to sit inside the station range: `countries: 222 · stations: 708 · 176 averaged over several stations`. Antarctica carries three variables rather than four because McMurdo has no root-zone soil moisture, and the checker requires exactly the variables its stations carry.

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
  EVIDENCE: Ran `bash scripts/verify_all.sh`; every check passed and the run ended with `all checks passed`. The new bundle is 708 points, 222 country averages, 4,039 grid cells, 629 city suggestions, with `countries.json` 2.0 MB made from the same station series.

- [x] G40: The country-average feature is pushed, deployed and resolves on the live site.
  CHECK: bash scripts/verify_live.sh
  EXPECT: live verified
  EVIDENCE: Pushed and confirmed with `bash scripts/verify_live.sh`: `points.json`, `rag_index.json` and `countries.json` all match `dist`, and the deployed bundle plans all 222 country averages plus the city spot checks (`live plan verified`).

- [x] G41: The globe skin is a genuinely higher-resolution map, and the build cannot quietly ship a smaller one.
  CHECK: node scripts/verify_textures.mjs
  EXPECT: textures verified
  EVIDENCE: The texture was the three-globe example image at 4096×2048 (1.46 MB). It is now NASA GIBS Blue Marble shaded relief and bathymetry at 8192×4096 (3.12 MB), which is 30 texels per degree at the equator and twice the linear detail of the old file. `verify_textures.mjs` parses the JPEG and PNG headers and requires 2:1 equirectangular images of at least 8192×4096, 2048×1024 and 4096×2048; it is wired into `scripts/verify_all.sh`, so the suite reports `textures verified` before `all checks passed`. Visual check on the dev server: coastlines, terrain and bathymetry are visibly sharper with no WebGL or console texture errors.

- [x] G42: The relief shading is a higher-resolution map than the skin it sits on and costs no more to download.
  CHECK: node scripts/verify_textures.mjs
  EXPECT: textures verified
  EVIDENCE: The bump map was a 2048×1024 PNG (0.38 MB) at 15 texels per degree while the skin had moved to 30. It is now ASTER GDEM greyscale shaded relief at 4096×2048 JPEG (0.36 MB), so the shading matches the skin and the download is 20 KB smaller. `verify_textures.mjs` requires at least 4096×2048 for this file and still enforces the 2:1 equirectangular aspect; the suite reports `textures verified` and `all checks passed`. Visual check on the dev server: terrain relief reads cleanly with no double-shadowing artefacts.

- [x] G43: Both polar belts carry a real network instead of a token station.
  CHECK: uv run python scripts/verify_data.py && node scripts/verify_country_plan.mjs
  EXPECT: data verified
  EVIDENCE: The Arctic had 7 stations above 66.5°N and Antarctica exactly one, McMurdo. Ten Arctic sites were added roughly 1,000 km apart — Utqiaġvik, Inuvik, Cambridge Bay, Resolute, Ittoqqortoormiit, Nord (81.6°N), Khatanga, Tiksi, Pevek, Srednekolymsk — taking the Arctic to 17, and ten Antarctic research stations — Vostok, Concordia, Casey, Dumont d'Urville, Davis, Mawson, Syowa, Neumayer, Halley, Rothera — taking Antarctica to 11. Natural Earth was not usable here: it has no Antarctic settlements and its Arctic villages are below the 20,000-person fill rule, so both belts are explicit entries in the curated table with a continuous NASA POWER record, which the build verifies.
  NOTE: All ten Antarctic stations return three of the four variables, because MERRA-2 masks root-zone soil moisture over ice; that is why the bundle now has 12 three-variable stations rather than one. Some polar trends are negative and significant — Cambridge Bay −0.60, Nord −0.61, Resolute −0.40 °C/decade — and those are the reanalysis values for this 1990–2025 window, checked against the raw annual series rather than assumed to be an artefact.

- [x] G44: The live proxy is asked for one station at a time, so one open case costs one upstream query, and every failure path is labelled.
  CHECK: node scripts/verify_live_proxy.mjs
  EXPECT: live proxy verified
  EVIDENCE: The app fetched `/api/live` with no `ids`, so the Worker selected all 708 points and sent 29 Meteomatics queries per cold cache (25 coordinates each) against a ~1,000/day allowance, returning 708 readings to every visitor. `refreshLiveReadings` is now `refreshLiveForCase`: it asks for `?ids=<one station>`, memoises per id, and only re-asks while that case is open. Readings live in a separate map, so a failed refresh falls back to the labelled build snapshot instead of a stale reading wearing a Live badge. The verifier runs the shared handler against a stub upstream and checks 1 point = 1 query, one reading back, the upstream URL carrying the hour and the coordinate, cache hit on repeat, 3 queries for 60 coordinates, and 503/502/504/405/400. In the browser, opening McMurdo issued exactly `GET /api/live?ids=mcmurdo` → 503 (no credentials).

- [x] G45: The first case no longer waits for the bundles it does not need.
  CHECK: node scripts/verify_firstload.mjs
  EXPECT: first load verified
  EVIDENCE: `init()` awaited 11.3 MB raw / ~2.7 MB gzip of JSON (points 5.8 MB, grid 3.3 MB, countries 2.0 MB) before the loading overlay lifted. `ensureGrid()` and `ensureCountries()` now load the trend field and the country averages on first use, one fetch each. The critical path is variables + points + rag_index + sources + app.js = 2,145 kB gzip, and the check fails if either deferred bundle returns to the init `Promise.all` or gains a second fetch. Browser evidence from the network log: on load only `variables.json`, `points.json`, `rag_index.json` and `sources.json` were fetched — no `grid.json`, no `countries.json`, no `/api/live`; `countries.json` appeared only after asking "Is France warming?", which planned `France average · 3 stations`.

- [x] G46: The red-herring twist is derived from the bundle and reachable in one click.
  CHECK: node scripts/verify_red_herring.mjs
  EXPECT: red herring verified
  EVIDENCE: `src/herring.js` picks the steepest featured case whose verdict is "no significant trend" with HAC p ≥ 0.05, so a rebuild cannot leave the demo pointing at a case that has become significant. The check requires a featured, non-exploratory record with n ≥ 20, and requires it to sit in the steeper half of the featured cases (McMurdo 0.303 °C/decade, p 0.060, n 36, ranked 7 of 14 against a median of 0.286) — just below five significant cases at 0.305–0.347, which is the story. It also asserts the chip is wired (`deriveSteepUnproven`, `data-open-point`, `renderSuggestions`, `#suggestions`). In the browser the fifth chip reads `Steep, but not proven · McMurdo` and opens CASE-2489 showing NOT PROVEN, +0.30 °C/decade, 95% CI −0.01 to +0.62, HAC p 0.060, MK p 0.035.

- [x] G47: The full suite also checks the deployed app, so a stale build cannot pass every gate.
  CHECK: bash scripts/verify_all.sh
  EXPECT: all checks passed
  EVIDENCE: `verify_all.sh` now runs `verify_live_proxy.mjs`, `verify_red_herring.mjs` and `verify_firstload.mjs`, and ends with `verify_live.sh` (bundle hashes for points/rag_index/countries plus all 222 country plans) so deployment drift fails the suite instead of passing silently. A clean run ended `all checks passed` with the live block reporting `live verified`. Note: this compares the data bundles and the plan engine, not the deployed JavaScript — a changed `dist/app.js` still needs a push to GitHub Pages.

- [x] G49: Ocean cells are classified from a real coastline mask, and the mask is right at named anchors.
  CHECK: node scripts/verify_ocean.mjs
  EXPECT: ocean verified
  EVIDENCE: The GISTEMP file ships anomalies only, so `scripts/landmask.py` parses the already-cached Natural Earth 1:10m countries shapefile with `struct` (258 type-5 records, 548,471 points), skips rings by bounding box, and tests cell centres with even-odd crossing so lake holes read as water. Of 4,039 cells, 2,672 are ocean and 1,367 land. Anchors at grid points classify as expected: mid-Pacific (−17,−167), N Atlantic (39,−39), Southern Ocean (−61,1) and Arctic (87,1) water; Sahara (19,9), Amazon (−5,−63), Antarctica (−81,1) and Siberia (63,101) land. The check's first run failed on a non-grid coordinate (lon −41), which records the constraint that cell centres are the odd offsets of the 4° subsample: lat ≡ 3, lon ≡ 1 mod 4.

- [x] G50: Every ocean mean is the area-weighted mean of the cells it claims, basins share no cell, and the family correction covers basins only.
  CHECK: node scripts/verify_ocean.mjs
  EXPECT: ocean verified
  EVIDENCE: `scripts/build_ocean.py` averages member cells by cos(lat), because a 4° cell near a pole covers less ground than one at the equator, and runs the same `compute_trend` as every other case. The verifier recomputes each region's series from grid.json year by year and requires agreement within 0.002; it also requires 2,333 cells partitioned across the eight disjoint basins with no cell in two, `q ≥ p` for every basin trend, significance agreeing with q < 0.05, and `q = null` for the global aggregate. That aggregate is deliberately outside the family: it shares the basins' cells, so correcting across it would count each cell twice. Storing q at 6 dp turned a basin p of 4.6e-8 into q = 0, which the check caught; q is now stored at 9 dp.

- [x] G51: An ocean question plans an ocean case, and a sea-ice question never lands on a station.
  CHECK: node scripts/verify_ocean.mjs
  EXPECT: ocean verified
  EVIDENCE: `resolveOcean` matches basin aliases longest-first, so "north pacific" beats "pacific" and "indian ocean" beats "indian"; every alias of all nine regions plans `kind: ocean` with the variable relabelled "Sea surface temperature". "Is the Pacific warming?" plans Tropical Pacific · 314 ocean cells · 72%. ""Is the Arctic sea ice shrinking?" previously planned Tromsø air temperature at 56%; ice questions are now answered by a real sea-ice record (G55), and this gate only requires that they never plan a station.

- [x] G52: The ocean is a place and a layer, not a cloud of dots, and two narrow-width regressions were found and fixed.
  CHECK: manual, in the preview panel at 631×704 and 1440×900
  EXPECT: an ocean case opens from a question, and the Ocean layer shows water cells only
  EVIDENCE: The layer switch gains a third button whose field is the existing 4,039-cell layer filtered to `is_ocean` (2,672 shown), so the ocean reads as a field with blank continents rather than extra points; the legend gains `ocean cell · SST` only in that mode, and the case panel reads `Ocean region · sea surface temperature · 314 GISTEMP cells` with its extent in words, plus neighbour-basin chips. No ocean marker is added to the Cities layer (708 points before and after). Two defects the browser check found: the fourth legend row pushed the Ocean button to x 617–678 while the bar ended at 619, fixed by hiding `#ocean-legend` at ≤900 px and pinning the switch (measured 557–618 inside a 631 px viewport); and a case opened from the plan card sat at `scrollTop` 805, fixed by resetting the panel on the next frame as well (measured 0). The region outline (option C) was not built: the plan's fallback was the ring plus the text extent, and the scene already carries a custom layer, arcs, labels and rings.
  NOTE: The screenshot tool returned the same stale frame three times after resizing, so the desktop composition was not confirmed visually; the layout was confirmed by measurement instead (viewport 1440×900, canvas 2880×1800, case panel at x 998–1416).

- [x] G53: The sea-ice record comes from the open NSIDC index, one annual mean per year, and the global record is exactly the two hemispheres summed.
  CHECK: uv run python scripts/build_seaice.py
  EXPECT: 36/36 complete years for both hemispheres, then three records written
  EVIDENCE: The NSIDC/NOAA Sea Ice Index (G02135 v4.0) is served as 24 per-month CSVs from `noaadata.apps.nsidc.org` with no Earthdata account, which is what makes this variable shippable while the Earthdata-backed ones are not. Bulk fetching hit the host's throttle: single files returned 200, then mixed 500s, then connection refusals for every month after ~30 rapid requests (and still refused minutes later). The builder therefore reads the same index as four PSL timeseries — extent and area per hemisphere, `n_iceextent.mon.csv`, `n_icearea.mon.csv`, `s_iceextent.mon.csv`, `s_icearea.mon.csv` (1978→2026, 10⁶ km², −9999 for missing) — four requests instead of twenty-four. A year enters the series only with all twelve months, so a ten-month mean cannot masquerade as an annual one: `36/36 complete years` for each hemisphere. Global sea ice is written as the year-by-year sum of the two, not a separate fit. The bundle is 15.4 kB.

- [x] G54: Every sea-ice annual mean is recomputed from the cached series, and the Arctic/Antarctic split is the honest pair the demo claims.
  CHECK: node scripts/verify_seaice.mjs
  EXPECT: sea ice verified
  EVIDENCE: The verifier parses the cached CSVs independently and rebuilds the annual means, requiring agreement within 0.001 for all 36 years per hemisphere, and requires global = Arctic + Antarctic within 0.002. It enforces the family contract (`q ≥ p` for all three, significance agreeing with q < 0.05) and that q is not rounded to zero: the Arctic p is 1.4e-12 with q 4e-12, and storing q at nine decimals would have written 0 for a value that is not zero. The numbers: Arctic −0.539 (CI −0.640 to −0.438, p 1.4e-12), Antarctic −0.233 (CI −0.543 to +0.077, p 0.136, MK p 0.367), global −0.772 (CI −1.032 to −0.513, q 1.1e-6). The check fails if the Antarctic interval stops crossing zero or the Antarctic becomes significant, because the demo's contrast depends on that.

- [x] G55: A sea-ice question plans the sea-ice record rather than a station, and every alias reaches its own hemisphere.
  CHECK: node scripts/verify_seaice.mjs
  EXPECT: sea ice verified
  EVIDENCE: `resolveSeaIce` matches record aliases longest-first and the planner now prefers that record to both the city and the basin path, so "arctic sea ice", "arctic ice", "sea ice" and "global sea ice" all plan `kind: seaice` with the variable labelled Sea ice extent (10⁶ km²). The first run failed with `"arctic ice" planned city at Tromsø`: the ice vocabulary regex requires "sea ice", so an alias-only phrasing fell through. The gate now keys on either signal (a matched record or an ice term) and plans all 12 aliases; it also requires the plan to say what extent measures. `verify_ocean.mjs` keeps the weaker rule that an ice question never plans a station, so the earlier bug cannot return through either gate.
  NOTE: In the browser on the dev server, the fourth suggestion chip reads `Is the Arctic sea ice shrinking?` and plans `Sea ice extent · Arctic sea ice · 12-month mean · 1990–2025 · 10⁶ km²`. Running it opens a case headed `SEA ICE EXTENT · ANNUAL MEAN OF 12 MONTHLY EXTENTS · 10⁶ KM²` with `OPEN AND SHUT`, −0.54, significant decline, a drawn chart, `scrollTop` 0, and two chips for the other records. Clicking `Antarctic sea ice` re-renders the same panel as `NOT PROVEN`, −0.23, CI −0.54 to +0.08, HAC p 0.136, with the non-significance caveat. `seaice.json` (8.2 kB) is fetched once, on the first question, and nothing is added to the globe. Two copy defects the browser check caught and this change fixed: the narrative read "at q = < 0.001", and it said the Antarctic record "survives" a correction when its q is above 0.05.

- [ ] G48: The two-minute demo has been rehearsed end to end with a stopwatch against the deployed URL.
  MANUAL: run `DEMO.md` twice, timed.
  OPEN: written with the real bundle numbers, but not rehearsed; the spoken script is a human step and is not claimed as verified.

## Blocked

- **The Live chip cannot be live yet.** `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` are present but empty in this workspace's `.env` (lines 9–10, 0 characters; file mtime 09:35, dev server started 16:55), the running dev server answers `{"ok":false,"error":"live_unconfigured"}`, and there is no `.env.local` or `worker/.dev.vars`. Setting them requires a dev-server restart, because `vite.config.js` reads `.env` once when the config is evaluated.
- **The public proxy is unhosted.** GitHub Pages cannot run `worker/index.js`. Sites caps an upload at 10 MiB / 1,000 assets and `dist` is 19 MB (11.3 MB data, 3.6 MB textures, 2 MB JS), so the whole app cannot ship there; the remaining path is a proxy-only Worker with the point list and CORS in front of `/api/live`. It is not worth deploying before the credentials exist.

- [x] G56: Concentration is a real second measure on the same records, recomputed from ice area, and every sea-ice case shows both verdicts at once.
  CHECK: node scripts/verify_seaice.mjs
  EXPECT: sea ice verified
  EVIDENCE: The Sea Ice Index carries ice area as well as extent, so the bundle now stores `SEAICECONC` = 100 × annual mean area ÷ annual mean extent — the mean concentration of the ice-covered area, not a second dataset. Arctic 82.5% in 1990 to 81.4% in 2025, +0.379 percentage points/decade (95% CI +0.073 to +0.684); the HAC test passes (p 0.017) but the Hamed–Rao corrected Mann–Kendall does not (p 0.086), so the verdict is **NOT PROVEN**. Antarctic +0.161 (p 0.273), also not proven. Global concentration is computed from the summed areas, never as the mean of two percentages; the verifier checks that identity year by year, recomputes both measures from the cached extent and area series (0.006 pp tolerance for the ratio, 0.001 for extent), requires every value to sit in 0–100, and fails if the Arctic extent/concentration contrast disappears or the concentration verdict changes. `seaIceVariableCode` sends "concentration" questions to the ratio and defaults to extent; in the browser, "What is the Arctic sea ice concentration?" planned `Sea ice concentration · Arctic sea ice · 12-month mean · %`, rendered `SIGNIFICANT +0.38 percentage points / decade` with the HAC-vs-MK caveat, and the both-measures block read `EXTENT −0.54 million km²/decade PROVEN` above `CONCENTRATION +0.38 percentage points/decade NOT PROVEN`. Clicking the extent row re-rendered the same panel as `OPEN AND SHUT −0.54`, significant decline, `scrollTop` 0.
  NOTE: The independent verifier caught nothing here, but the browser check found the measure switch worked only because the case re-renders in place; the first attempt to drive it after a page reload did nothing until the suggestion chips had rendered, which is a timing artefact of the check, not the app.

- [x] G57: Both sea-ice measures are on one chart, indexed, so the divergence is visible without switching measures.
  CHECK: node scripts/verify_seaice.mjs
  EXPECT: sea ice verified
  EVIDENCE: `renderCompareChart` divides each series by its own first value in the window and scales it to 100, then draws both on shared axes. Dual y-axes were rejected on purpose: two independently chosen scales can manufacture a divergence, and this app cannot afford a chart that argues past its statistics. The `index, <first year> = 100` label and a legend carrying the base year travel with the chart, and the selected measure stays at full stroke while the other drops to 0.55 opacity. In the browser, the Arctic case drew two 36-point paths (`#4f93d6` extent at full opacity, `#c9a227` concentration at 0.55), ticks 90/95/100, and the panel still read `OPEN AND SHUT −0.54` with `EXTENT −0.54 … PROVEN` above `CONCENTRATION +0.38 … NOT PROVEN`. Switching measure swapped the emphasis, and switching the window to 2000–2025 re-based the chart to `index, 2000 = 100` with 1990 replaced at both ends (`n = 26`, concentration +0.55, CI −0.05 to +1.15). The gate fails if either series is dropped from the case or the chart stops being drawn from the shared window.
  NOTE: The measured SVG box came back 568×271 for a 360×172 viewBox, i.e. the panel's own scaling; the visual result was not reviewed as a screenshot, only through the DOM.

- [x] G58: A tap on water in the Ocean layer opens the basin under the tap, not a station and not one cell's surface temperature.
  CHECK: node scripts/verify_ocean.mjs
  EXPECT: ocean verified
  EVIDENCE: `finishGlobeTap` now branches before the station path: in the Ocean layer it waits for `ocean.json`, takes the nearest ocean cell within 3° (the 4° grid's half-diagonal is 2.8°), and resolves that cell with `oceanRegionAt`, which repeats the build's wrapped box test — `(lon - start) % 360 <= span` over `lat_bounds`/`lon_bounds` — and skips the aggregate, which matches every point. The verifier round-trips the first twelve cells of every basin back through `oceanRegionAt` and requires the same basin, pins mid-Pacific → Tropical Pacific, N Atlantic (39,−39) → North Atlantic, Southern Ocean (−61,1) → Southern Ocean and Arctic (87,1) → Arctic Ocean, and requires the Sahara (19,9) to resolve to nothing. Water in no basin is handled separately: 339 cells (the tropical Atlantic, for one) resolve to null, and the tap path sends them to the global ocean with `this water is outside the named basins` rather than calling them land — the check pins that count, the null case at (−1,−31) and the fallback marker. In the browser, a synthetic pointer tap on the Atlantic opened `North Atlantic`, `Ocean region · sea surface temperature · 178 GISTEMP cells`, with the toast `Ocean case: North Atlantic · 178 cells` and no station card. A tap on land in the same layer produced `Land — the Ocean layer only shows water. Switch to Cities to ask about a station.` and opened no case, so the old nearest-city behaviour cannot fire from the water view.
  NOTE: The taps were synthesised as pointer events on the canvas at screen fractions, so they prove the handler and the mapping, not finger accuracy on a phone.

- [x] G59: A case can be taken away for verification, with the annual means and the statistics behind its verdict.
  CHECK: node scripts/verify_export.mjs
  EXPECT: export verified
  EVIDENCE: `renderCase` clears `state.exportData` and each of the six renderers (city, country, grid cell, global field, ocean basin, sea ice) hands over its title, detail, variable, trend object and the exact window it plotted; `mountExport` then appends **Check the numbers** with two buttons. The series file is `year,value,fit,residual` and carries no per-year confidence band, because the bundle stores an interval for the slope and a per-year band would be an invention. The statistics file copies every stored number unrounded (slope, CI, HAC p, BH q, r², Sen, Hamed–Rao terms, lag-1 residual, Durbin–Watson) plus the method, the verdict rule and `trend detection only; no causal attribution`. Files are UTF-8 BOM + CRLF so Excel reads `°C` and `−0.54`. The verifier parses both files with a plain RFC 4180 reader and refits the exported series: station, country, ocean, extent, concentration, grid cell and global all reproduce their stored slope (worst 1.7e-5 relative, which is the rounding of the stored means, not an error in the fit), residuals match `value − fit`, and a case with a comma and a quote in its name round-trips.
  PLACEMENT: The control was first appended to the end of the case (1,213px down a 1,300px panel that shows 322px — three panel-heights out of sight), then put in the flow under the verdict (the verdict itself sits 552px down, so the buttons landed 309px below the fold), and finally pinned to the panel's bottom edge: measured visible at `scrollTop` 0, 640 and 973 of 973, 70px tall, with the export still producing 40 statistics rows from the pinned state. `position: sticky` was chosen over `fixed` because a short case keeps the panel shorter than the viewport and a fixed bar would float detached from it.
  NOTE: The 1e-9 tolerance was abandoned on evidence: the bundle stores means rounded (3 decimals for temperature, 4 for sea ice) while the slope was fitted before that rounding, so an exact refit is impossible and the check now states the agreement it actually reaches instead of pretending to a precision the file cannot carry.

- [x] G60: The landing hero carries its copy in six bordered boxes and ships no leader lines or dots.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: The hero markup is six `<article class="hero-box">` blocks — name/tagline/NASA label, members, about, challenge, local event and data — inside `.hero-boxes`. `scripts/verify_app.mjs` fails if any of the six strings is missing, if the box count is not six, or if `hero-line`/`hero-lines`/`hero-dot` markup returns, and it prints `hero: six copy boxes, no leader lines`. Run against the dev server it exited 0 with that line and `app verified`; `verify_offline.mjs` still passes.

- [x] G61: The boxes sit behind the sphere, no box text is covered, and the phone layout stacks them around the globe.
  MANUAL: reviewed artifacts/boxes-1440d.png, artifacts/boxes-1280.png and artifacts/boxes-390.png, plus rect measurements reported by the browser.
  EVIDENCE: `.hero-boxes` is z-index 1 and `.hero-stage` is z-index 2, so the canvas paints over the boxes. At 1440x900 the left boxes occupy x 40-343 and the right boxes 1096-1384, with text right edges at 245/236/262 and text left edge 1112 — the sphere only takes the inner few pixels of the members and about boxes and no glyph is under it. The globe was enlarged (camera altitude 1.44 on desktop) so that edge contact is visible at all; the earlier 1.62 left a clear gap on every side. At 390x844 the order is name (y 134), globe (265-704), about, members, data, challenge, event, scroll, the stage is 331x439 and `scrollWidth` 375 <= 390, so nothing overflows.

- [x] G62: The boxed hero keeps the globe's hover, dialog, focus and reduced-motion behaviour.
  MANUAL: browser run against the current build at 1440x900 and 390x844.
  EVIDENCE: Hover sets `is-hovering`, shows `Click to open the case` and a pointer cursor; a click opens the native dialog; Escape closes it and focus returns to `hero-globe`; the focus ring reads `rgb(255, 107, 74)`. With `reducedMotion: reduce`, two full screenshots two seconds apart are byte-identical (rotation stopped) and `.hero-box` opacity is 1, so the copy appears without the staggered draw-in; under normal motion the same pair of screenshots differs. At 390x844 a click on the globe's centre opens the dialog. That last check used a mouse click, not a real touch event: the browser context has no touch support, so finger accuracy is still unproven.

- [x] G63: The case page names the product first and uses the tagline only as a tagline.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: `app.html` had the tagline in the places that name the product: `<title>Signal & Noise — Gaussian Frontiers</title>`, the meta description opening with it, the brand link's `Back to the Signal & Noise overview`, the loading eyebrow above `Assembling the evidence locker…`, and the footer ordering. All five now read `Gaussian Frontiers` first with `Signal & Noise` after it, matching the landing page. `verify_app.mjs` gained three assertions — the exact `<title>Gaussian Frontiers — Signal &amp; Noise</title>`, no `Back to the Signal &amp; Noise` link and no `panel-kicker">Signal &amp; Noise` eyebrow — so the tagline cannot drift back into the name position. Run with the dev server it prints `app verified`, and it still requires `Signal &amp; Noise` to appear on both pages, which the new title, meta and footer satisfy.

- [x] G64: Clicking the hero globe opens the case analysis directly, and the boxes arc around the sphere.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: The `<dialog>`, its CSS block and the close/focus-return JavaScript are gone; `hero.js` now holds `const CASE_URL = "./app.html"` and one click listener that assigns it. In the browser at 1440x900 a click on the globe lands on `/app.html` (`title: Gaussian Frontiers — Signal & Noise`, canvas present) with no dialog in the DOM, and Enter on the focused globe navigates the same way. Hover still sets `is-hovering`, shows `Click to open the case` and a pointer cursor, and the keyboard focus ring is still `rgb(255, 107, 74)` (measured after Tab, where `:focus-visible` applies; a programmatic `.focus()` shows the UA ring instead). `verify_app.mjs` now also fetches `/src/hero.js` and fails if `CASE_URL = "./app.html"` is missing or if `hero-dialog` returns. The arc: `--box-bend: clamp(20px, 3.2vw, 48px)` steps the outer boxes inwards, measured at 1440x900 as name x 86-389, members 40-328, about 86-374 on the left and challenge 1050-1338, event 1096-1384, data 1050-1338 on the right, so the middle boxes sit closest to the limb and the corners tuck in. The phone layout is unchanged (stacked, stage 265-704, `scrollWidth` 375 <= 390) and its globe click also lands on `/app.html`.

- [x] G65: A question about a place with no station is answered from the GISTEMP field through a validated coordinate, and the numbers still come from stored, code-computed trends — never from the resolver.
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: `worker/resolve.js` resolves in two stages: the Natural Earth gazetteer (6,415 indexed entries, matched longest-name-first with a population tie-break) and, only for names it does not carry, a stub-able keyless geocoder chain (Open-Meteo, then Nominatim). "Is Gold Coast getting hotter?" — and "Is Goldcoast getting hotter?", the way the question usually gets written — resolves to Gold Coast, Australia at −28.0815, 153.4482 with `source: gazetteer`, `variable: T2M`, `windowKey: 1990-2025` and no API key, and the nearest GISTEMP cell is 111 km away carrying a full 36-year anomaly series and a 1990–2025 trend. The check proves the coordinate lands on a cell the app can draw, that the gazetteer path makes zero network requests, and that `planCase` marks "Is Gold Coast getting hotter?" `resolved: false` (so the derived path is the one that runs) while "Is the world warming?" stays `resolved: true` (so the global field is never routed through the resolver).

- [x] G66: Every resolver failure is labelled, a geocoder's answer is validated rather than trusted, and the public endpoint that calls shared public services is capped.
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: A provider answer of `lat: 120`, a missing coordinate, and an empty `results` array are all rejected rather than passed upstream — the first two fall through to the next provider and end at 422; two failing providers return 502 `resolver_unavailable` (naming the provider that failed, not the last one tried); a TimeoutError returns 504; two empty providers return 422 `place_not_found` echoing the query that was searched. PUT → 405; invalid JSON, blank and 300-character questions → 400 with `limit: 240`. A repeated question is served from the hour-long cache without touching the network, and the 21st lookup inside a minute returns 429 with `retry-after: 60`. The first run of the check failed on its own fixtures — "varies" questions containing "Nan" (a town in Thailand) and "El Dorado" were answered by the gazetteer before the stub was reached — which is why the negative fixtures now use names no gazetteer holds.

- [x] G67: A derived case opens as a real case: same verdict contract, chart, statistics, CSV export and an honest label, with the nearest station one click away.
  MANUAL: browser run against the dev server, driven through the actual ask box and chips.
  EVIDENCE: Clicking the new "Is Gold Coast getting hotter?" chip produced the plan card `Gold Coast · Derived case · Australia · 28.08°S 153.45°E · nearest GISTEMP cell · 1990–2025 · °C` at 74% match, explaining that "gold coast" is not one of the bundle's stations. **Run this case** opened CASE-DC68 headed `DERIVED CASE · NO STATION HERE · AUSTRALIA`, with the notice "the nearest GISTEMP 4° cell — 111 km away at 29.00°S 153.00°E — and its numbers describe that cell, roughly a 440 km box, not the city boundary", the verdict OPEN AND SHUT +0.27 °C/decade (95% CI +0.16 to +0.39, n = 36, HAC p < 0.001, BH q < 0.001), a rendered chart, THE STATISTICS block, both CSV buttons and the chip `A real station is close by · Brisbane · 80 km NNW`, which opened the real Brisbane station (CASE-AF7A). The narrative keeps the app's rule: "This is a trend detection, not an attribution." Console held only the expected `/api/live` 503s from missing Meteomatics credentials; there were no JavaScript errors.

- [x] G68: The gazetteer is built from the already-cached public-domain Natural Earth layer, ships server-side only, and the browser pays nothing for it.
  CHECK: uv run python scripts/build_gazetteer.py
  EXPECT: gazetteer:
  EVIDENCE: Reads `data/cache/naturalearth/ne_10m_populated_places.zip` (7,342 rows, already cached by `build_cities.py`) with the same DBF parser and writes 6,421 places at 311.8 KB as compact `[name, country, lat, lon, population, alt_names]` rows, keeping every capital and everything at 5,000+ people, ASCII spellings as alternative keys. Probes find Gold Coast (Australia, −28.0815, 153.4482), Reykjavik and Ulaanbaatar; Broadbeach is deliberately absent, which is what exercises the model fallback. It is never fetched by the app: the Worker and the Vite middleware read it and index it once per isolate, and `verify_firstload.mjs` still lists only four bundles on the critical path.

- [x] G69: The station bundle is two tiers, every station's detail is reachable through the shipped shard function, and every summary agrees with the record it summarises.
  CHECK: node scripts/verify_bundle.mjs
  EXPECT: bundle verified
  EVIDENCE: `scripts/points_bundle.py` writes `points.json` (identity + `{s, p, n, v}` per variable and window) and `point-details/00…15.json` (full trends + series), with `load_bundle()` merging them back to the old shape for the build and the Python verifiers. The check pins one shard function across `src/bundle.js`, `scripts/bundle.mjs` and `points_bundle.py`, requires no series or trend record in the index, requires every station to have a summary, requires every detail id to live in the shard `shardFor(id)` names with no duplicates and no orphans, compares all 8,460 summaries against their stored slope, p, n and verdict (skipping the explicit `null` windows the masked Antarctic variables carry), and fails if the index exceeds 32% of the whole bundle. Result: 708 stations, index 199 kB gzip against 1,674 kB whole — 12%.

- [x] G70: The split bundle is the same data as before — the rebuild path and both Python verifiers read it through one loader.
  CHECK: uv run python scripts/split_points.py; uv run python scripts/verify_data.py; uv run python scripts/verify_countries.py
  EXPECT: countries verified
  EVIDENCE: `split_points.py` loads the merged bundle and re-splits it, so running it twice is a no-op; `build_data.py` now reads `load_bundle` for its existing-series cache (a rebuild reuses series rather than refetching them) and writes both tiers through `write_bundle`. `verify_data.py` still recomputes every trend from the annual series and `verify_countries.py` still rebuilds all 222 country means from all 708 stations: `708 · featured: 14 · live: 6`, `4,039 grid cells · global slope: 0.2362`, `countries: 222 · stations: 708 · 176 averaged over several stations`. `render_context.py` and `fetch_sentinel.py` read and rewrite `points.json` for imagery only, which is index-tier data, so they need no change.

- [x] G71: The first case pays for an index, not for 708 stations' records, and the budget is enforced.
  CHECK: npm run build; node scripts/verify_firstload.mjs
  EXPECT: first load verified
  EVIDENCE: The critical path is now variables 2 kB + points 199 kB + rag_index 25 kB + sources 1 kB + app.js 63 kB = **289 kB gzip**, down from 2,145 kB. The check gained three assertions: no station in the index carries `series` or `trends`, every station carries a summary, `main.js` has an `ensurePointDetail` loader, and no `point-details` path may appear in the init `Promise.all`. The budget is 1,050,000 gzip bytes (was 2,400,000) so the win is locked in. In the browser at load the network log held only `variables.json`, `points.json`, `rag_index.json` and `sources.json`; opening McMurdo fetched exactly one shard, `/data/point-details/07.json`, plus its imagery.

- [x] G72: Browsing many stations does not accumulate their records in memory.
  MANUAL: measured in the browser through the dev handle `window.__caseFiles.state`.
  EVIDENCE: `ensurePointDetail` merges a shard into the index in place and `touchDetailShard` evicts least-recently-used shards beyond three, never the open case's. Opening six stations across five shards (Nairobi twice, London, Delhi, Manaus, Tromsø) left exactly three shards loaded — `04`, `05`, `06` — 129 hydrated stations out of 708, with the open case (Tromsø) still holding its full record and rendering NOT PROVEN. The order list is trimmed with the cache, so the bookkeeping cannot grow either.

- [x] G73: The whole offline suite, the known-answer statistics tests and the production build pass together with the split bundle and the resolver in place.
  CHECK: uv run python scripts/verify_data.py && uv run python scripts/verify_countries.py && uv run --with pytest pytest -q && node scripts/verify_bundle.mjs && node scripts/verify_resolve.mjs && node scripts/verify_rag.mjs && node scripts/verify_country_plan.mjs && node scripts/verify_locate.mjs && node scripts/verify_offline.mjs && node scripts/verify_textures.mjs && node scripts/verify_clean.mjs && node scripts/verify_live_proxy.mjs && node scripts/verify_red_herring.mjs && node scripts/verify_ocean.mjs && node scripts/verify_seaice.mjs && node scripts/verify_export.mjs && npm run build && node scripts/verify_firstload.mjs && node scripts/verify_app.mjs && echo offline suite complete
  EXPECT: offline suite complete
  EVIDENCE: Every command exits 0. `verify_app.mjs` was run against this workspace's own dev server (port 5183, because port 5173 belongs to another session's preview) via `APP_URL`. `verify_all.sh` gained `verify_bundle.mjs` and `verify_resolve.mjs`; `verify_live.sh` (deployed-bundle hashes) is still the one check that needs a push, and `npm run build` leaves `dist/` uncommitted as before. The red-herring check now derives the twist twice — from the merged bundle and from the shipped index alone — and requires the same case, so the summary encoding cannot silently change what the demo opens.

- [x] G74: The place fallback is keyless — no account, no `.env` entry, no Worker secret — and a provider outage is never reported as "no such place".
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: The ElectronHub key path was removed after the fact: `worker/resolve.js` now falls back to Open-Meteo geocoding (`geocoding-api.open-meteo.com/v1/search`, no key, CC BY 4.0, under 10,000 calls/day) and then OpenStreetMap Nominatim (`nominatim.openstreetmap.org/search`, no key, `user-agent` naming the app and one request/second as its policy requires). Live calls before wiring: Open-Meteo returns `Broadbeach · Australia · −28.02782, 153.43343` for `name=broadbeach` and `{}` for a nonsense name; Nominatim returns `Broadbeach, Gold Coast, Queensland, Australia` at `−28.0281, 153.4313`. The check asserts no `authorization` header is sent, no key-like parameter appears in the URL, the Nominatim request carries a `signal-and-noise` User-Agent, every notice carries its attribution, and the capability probe reports `providers: [open-meteo, nominatim]` with no key state at all. The place name is extracted rather than passed through — "Is Gold Coast getting hotter?" → `gold coast`, "Has rainfall in Broadbeach changed since 2005?" → `broadbeach`, "Is the soil moisture drying out in Narok?" → `narok` — and a question with no place name returns 422 with a specific detail instead of a null-island lookup. `.env`, `.env.example`, `vite.config.js` and `worker/wrangler.toml` no longer mention ElectronHub; the README records the swap and why a geocoder beats a language model at a lookup. In the browser, "Is Broadbeach getting hotter?" — a suburb the gazetteer does not carry — produced `CASE PLAN · 68% MATCH · Broadbeach · Derived case · Australia · 28.03°S 153.43°E` and a case whose notice reads "The coordinates come from Open-Meteo geocoding (Open-Meteo, CC BY 4.0)", with the nearest cell 116 km away at 29.0°S 153.0°E, +0.27 °C/decade proven, and Brisbane 74 km NNW offered as the real station.
  NOTE: This replaces the model path described in G65/G66, which is why those gates now read "keyless geocoder chain" instead of "stub-able ElectronHub call". Their CHECK and EXPECT are unchanged and still pass.

- [x] G75: The landing globe opens centred on Australia and spins eastward about a 23.5-degree axis.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: `src/hero.js` starts at `START_LAT = -25.3`, `START_LNG = 133.8` (the middle of Australia) and carries `AXIAL_TILT_DEG = 23.5`. The camera's up vector is rolled by that angle so the pole reads tilted, and the globe surface turns about its own Y axis at `SPIN_IDLE = 2*PI/100` rad/s — one eastward revolution per 100 s — dropping to a fifth under the hover (`SPIN_HOVER`). OrbitControls' `autoRotate` is off on purpose: it orbits the camera about world up and cannot carry a tilt. `verify_app.mjs` asserts the two start coordinates, the tilt constant, `rotation.y +=` and `controls.autoRotate = false`, so the arrangement cannot silently revert.

- [x] G76: On the built page the globe really sits over Australia, really is tilted, really turns the way Earth turns, and still honours hover and reduced motion.
  MANUAL: browser measurements on the built site at 1440x900, plus PIL frame differencing.
  EVIDENCE: Measured with a temporary probe (removed before committing, `grep` finds no `__heroProbe`/`__heroDebug`): `pointOfView` = lat -25.3, lng 133.8 with Australia at the disc centre in the frame; `camera.up` = (0.3987, 0.9171, 0) = 23.5 degrees off vertical; `rotation.y` advanced 0.3246 rad in 5.11 s = 0.0635 rad/s against the 0.0628 target (1% high, timing noise), so one revolution per 100 s; hovered it advanced 0.0656 rad in 5.22 s = 0.01256 rad/s, exactly a fifth. The sign is positive: PIL puts the warm Australia mask centroid at (806, 501) then (962, 585) in frames 4 s apart — 156 px right, 85 px down, 28.5 degrees below horizontal against the 23.5-degree tilt — eastward motion in the tilted frame, terrain entering left and leaving right. Under `prefers-reduced-motion` `rotation.y` stayed at 0 across 2 s with the tilt still applied. Two defects this caught and the change fixes: `three-globe` builds its globe group only after the texture loads, so capturing the handle at init made the spin a no-op (two frames were pixel-identical); and the frame-delta clamp of 0.25 s dropped wall-clock time in a throttled tab, so it is now 2 s.

- [x] G77: Both deployments are live, and the derived case works on the Worker URL while the static host refuses it honestly.
  CHECK: curl -s https://earth-trend-detective-case-files.gaussian-frontiers.workers.dev/api/resolve; curl -s -X POST …/api/resolve -d '{"question":"Is Broadbeach getting hotter?"}'
  EXPECT: the capability probe reports the geocoder chain; Broadbeach resolves with coordinates
  EVIDENCE: Commit `86b6867` was pushed to `main`, and GitHub Pages published it ~20 s later (verified: `/data/points.json` carries `detail_shards`, `/data/point-details/07.json` and `/data/gazetteer.json` both return 200, and `/assets/bundle.js` on the live host is byte-identical to the local build). In the live Pages app a station chip opens `CASE-2489 · McMurdo` with a shard fetched from `https://the-jamk.github.io/…/data/point-details/07.json` and +0.30 °C/decade on screen. The Worker was deployed with `wrangler deploy` from `worker/` after `wrangler login` (workers.dev subdomain `gaussian-frontiers`, chosen here because the account had none): 63 assets uploaded, Worker 21.59 KiB, `env.ASSETS` bound. Its first requests failed the TLS handshake for ~150 s while Cloudflare issued the certificate; once it answered, `GET /api/resolve` reported `{"ok":true,"places":6415,"providers":["open-meteo","nominatim"]}`, `POST` for Gold Coast returned source `gazetteer`, and `POST` for Broadbeach returned `provider: open-meteo`, `-28.02782, 153.43343`, attribution "Open-Meteo, CC BY 4.0", and `zzqxville` returned 422 `place_not_found`. In the deployed app both questions open a derived case (CASE-DC68 for Gold Coast, CASE-1413 for Broadbeach, each +0.27 °C/decade with the 111 km / 116 km cell spelled out), `/` serves the landing page and `/api/live` returns 503 with Meteomatics unconfigured, which the app labels as the snapshot.
  NOTE: Wrangler asked for a workers.dev subdomain, which is an account-level choice; `gaussian-frontiers` is changeable at dash.cloudflare.com → Workers → subdomain. Pages still serves the app without the resolver, by design.

- [x] G78: The landing page is the globe scene and nothing else: no top-bar call to action, no section under the hero, no scroll hint, and no scrollbar.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: `index.html` drops the `Open the case` button from the top bar, the `<div class="landing-main">` block (the intake steps, the sample case, the contract, the data notes and the footer), and the `Scroll` link; the page is 76 lines and an HTML parse reports no unbalanced or unclosed tag. `src/landing.js` is now three statements — import the stylesheet, import `initHero`, call it — so nothing fetches `points.json`, `variables.json` or a detail shard for a section that no longer exists. The matching CSS went with it: `.cta-ghost`, `.landing-main`, the `.hero-scroll` rules and the sections, sample, contract, data and footer blocks, with the two landing breakpoints trimmed to the `.hero` and `.topbar` rules they still need. `verify_app.mjs` now asserts the globe button is present and fails if `class="landing-main"`, `class="ghost-btn cta-ghost"`, `class="hero-scroll"`, `href="#how"`, `id="sample-case"`, `<footer` or `class="section"` reappears, or if a line reading exactly `Scroll` is back.

- [x] G79: In the browser the trimmed landing fills the viewport without scrolling and the globe still opens the case.
  MANUAL: Cloud browser, built site, 1440x900.
  EVIDENCE: `document.documentElement.scrollHeight` is 900 against `window.innerHeight` 900, so there is no scrollbar; `innerText` contains no occurrence of the word scroll; the top bar's text is exactly `GAUSSIAN FRONTIERS` with zero links or buttons in it; six `.hero-box` articles remain, `.landing-main`, `footer` and `section.section` all return null and there are 0 such sections; `main` measures 834 px tall, filling the height under the 66 px bar. Clicking `#hero-globe` navigated to `/app.html` (title `Gaussian Frontiers — Signal & Noise`), which is now the only route into the app. Screenshot: `artifacts/hero-only.png`.

- [x] G80: A push to `main` redeploys the Worker, the same way it republishes Pages, and a repository without a Cloudflare token still goes green.
  CHECK: curl -s https://api.github.com/repos/The-JamK/NASA-Hackathon-2026-Project-Earth/actions/runs/43661831005/jobs
  EXPECT: a push to `main` deploys the built site, and the published assets are the ones that push built
  EVIDENCE: `.github/workflows/deploy-worker.yml` runs `npm ci && npm run build` on push to `main` and then `npx --yes wrangler@4 deploy` from `worker/` — the exact command that published the live Worker. The first run on commit `acb66e1` completed green (run 43660441943): checkout, setup-node, `npm ci`, `npm run build` and the credential check all succeeded, and `Deploy worker` reported **skipped** because the repository has no `CLOUDFLARE_API_TOKEN` yet — the run is not failed by a missing optional secret, so Pages keeps publishing and the Worker simply keeps its previous version. The guard's branching was also run outside CI both ways (`present=false` with no token, `present=true` with one). The account id defaults to the account's own id and can be overridden with a `CLOUDFLARE_ACCOUNT_ID` secret. Once the secret `CLOUDFLARE_API_TOKEN` was added, run 43661831005 on commit `faa164f` deployed for real — `Deploy worker` reported **success** where it had been skipped — and Cloudflare recorded a new deployment at 01:11:05Z (version `8905e674`). What it published is the build of that commit: `/assets/app.js` and `/assets/style.css` are byte-identical to a local `npm run build` of `faa164f`, and `/` serves an `index.html` identical to the same build (`/index.html` 307s to `/`, which is why the page is fetched at the root). `/api/resolve` still returns 200 and Broadbeach still opens a derived case on the redeployed Worker, so the automatic deploy did not regress the resolver.
  NOTE: The file was not on the default branch of the first push attempt — it was rebased past two teammate commits to `main` (`2847fed`, `8ff90cc`) before GitHub would register the workflow, which is why there is no earlier run. The account-level workers.dev subdomain `gaussian-frontiers` and the token's client-IP filter are both deliberately unrestricted: GitHub-hosted runners rotate addresses, so an IP allowlist would fail the deploy intermittently.

- [x] G81: The snapshot chip is text only, and the verdict is a solid block of its own colour with no left bar.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: `liveChip()` no longer emits the `<i></i>` that drew the dot, and the rules that styled it (`.live-chip i` and the `pulse` animation only it used) are gone with the now-unused `@keyframes pulse`. `.verdict` loses `border-left` and the near-transparent wash; each tone sets `background` to its own token (warm `--warm`, cool `--cool`, none `--flat`, explore `--amber`) and an ink colour, and the stamp, rate, unit and sub-line all inherit that ink instead of the dark-theme `--text`/`--muted` values, which were the two things that would have been unreadable on a filled block. `verify_app.mjs` fails if `<i></i>` returns to `main.js`, if the `.verdict` rule regains a `border-left`, or if any of the four tones stops setting its background token; it fetches the stylesheet through `?direct` because the dev server otherwise answers that path as a JS module.

- [x] G82: In the browser the Sydney case shows no dot, a fully filled verdict block, and dark ink that clears 4.5:1 on every tone.
  MANUAL: Cloud browser, built site, 1440x900, case opened with "Is Sydney getting hotter?" then Run case.
  EVIDENCE: The live chip's text starts at the box edge — `SNAPSHOT · 26.7 °C NOW · 0.00 MM/H · 1.7 M/S · METEOMATICS · 14 NOV 00:00 UTC` — and `document.querySelectorAll('.live-chip i').length` is 0. The verdict reads `OPEN AND SHUT` / `+0.35 °C / decade` / `Significant warming · 95% CI +0.18 to +0.51 · n = 36` with computed `background: rgb(255, 107, 74)` and `border-left-width: 0px`. Contrast measured in the page for all four tones (background against the resolved colour of the stamp, rate, unit and sub-line) is warm 6.83, cool 5.93, none 4.76, explore 7.95 — all above the 4.5 AA floor, with the grey tone the tightest and therefore pinned to pure black ink at full opacity. Screenshots: `artifacts/verdict-filled.png`, `artifacts/chip-no-dot.png`.

- [x] G83: The hero Earth stands upright and spins faster than it did.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: `AXIAL_TILT_DEG` and the `sin`/`cos` camera roll are gone; `camera.up.set(0, 1, 0)` keeps the pole vertical on screen while the surface still turns about that axis, so `pointOfView` over Australia is unchanged. `SPIN_IDLE` moves from `(2 * Math.PI) / 100` to `(2 * Math.PI) / 70` — one revolution per 70 s, about 1.43x the old rate — and the hover rate stays a fifth of it. `verify_app.mjs` now requires the `camera.up.set(0, 1, 0)` line and the new `SPIN_IDLE`, and fails if `AXIAL_TILT` or `tiltRadians` returns to `hero.js`.

- [x] G84: On the built page the camera is upright and the measured spin matches the new rate.
  MANUAL: Cloud browser, built site, 1440x900, temporary probe removed before committing.
  EVIDENCE: With a temporary `window.__heroProbe` (grep now finds 0 occurrences in `hero.js`), two samples 5.19 s apart gave `rotation.y` 0.40841 -> 0.87664 = 0.09024 rad/s against the 0.08976 target (0.5% high, timing noise), i.e. a full turn in about 70 s versus the previous 0.0628 rad/s. `camera.up` read `[0, 1, 0]` at both samples. The final probe-free build was screenshotted twice 4 s apart: the pole is vertical and the landmasses have moved between frames (`artifacts/hero-upright.png`, `artifacts/hero-upright-t1.png`). `scripts/verify_all.sh` passes on the final build.

- [x] G85: The hero Earth turns a little faster again: one revolution per 50 s instead of 70.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: `SPIN_IDLE` is `(2 * Math.PI) / 50` in `src/hero.js`, up from `/ 70`, so the idle rate is 0.12566 rad/s against 0.08976 before — 1.4x — and `SPIN_HOVER` keeps deriving from it as a fifth. The upright camera, the Australia start point and `controls.autoRotate = false` are untouched. `verify_app.mjs` expects the new constant, so a silent revert to 70 s fails the check.

- [x] G86: The measured spin on the built page matches one turn in 50 s, with the probe gone from the shipped code.
  MANUAL: Cloud browser, built site, 1440x900, temporary probe removed before committing.
  EVIDENCE: Two samples 5.127 s apart read `rotation.y` 0.64713 -> 1.29217 = 0.12581 rad/s, i.e. one turn in 49.94 s, against the 0.12566 target (0.1% high, timing noise) and the 0.08976 measured at the 70 s setting. `camera.up` was `[0, 1, 0]` at both samples, so the Earth is still upright. The final build reports `typeof window.__heroProbe === "undefined"` and `grep -c __heroProbe src/hero.js` is 0. Screenshots 4 s apart: `artifacts/hero-upright-50s.png`, `artifacts/hero-upright-50s-t1.png`. `scripts/verify_all.sh` passes on this build.

- [x] G87: A static host answers "Is Gold Coast getting hotter?" with a real derived case, using the gazetteer the page already ships.
  CHECK: python3 -m http.server 5186 --directory dist, then ask that question in the page and open the plan
  EXPECT: the plan reads `74% match · Gold Coast · Derived case` and the case renders +0.27 °C/decade
  EVIDENCE: `src/field.js` imports `indexGazetteer`, `matchGazetteer` and `readIntent` from `worker/resolve.js` — the same matcher the Worker runs — and loads `data/gazetteer.json` lazily, only after `/api/resolve` has failed with 404/405, an unreadable body or no route at all. Served from a plain static server, which answers POST with 501 and has no resolver: typing the question produced `CASE PLAN · 74% MATCH · Gold Coast · Derived case · Australia · 28.08°S 153.45°E`, and opening it rendered `CASE-DC68 · DERIVED CASE · NO STATION HERE` at +0.27 °C/decade with the chart, fetching `data/gazetteer.json` and no resolver call that succeeded. A name the gazetteer lacks behaves honestly: Broadbeach returned "No resolver server is reachable here, and the bundled gazetteer does not carry that name. Try a larger nearby city — suburbs and spelling variants need the Worker deployment." The same question on the live GitHub Pages build, in a fresh session, gave the same 74% plan, the same `CASE-DC68` case and +0.27 °C/decade, with `data/gazetteer.json` in the network log. The Worker is unchanged and still answers from `/api/resolve` first (200, source `gazetteer`).
  NOTE: The app bundle grew from 186 kB to 191 kB. A visitor holding the previous `assets/app.js` in cache (Pages sets `max-age=600`) keeps the old, refusing behaviour until it expires, which is why the live check needed an uncached session.

- [x] G88: The ask strip no longer offers the sea-ice chip or the steep-but-unproven chip, and the other four chips are unchanged.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: `renderSuggestions()` in `src/main.js` drops the `chip-ice` push and the `chip-herring` block, plus the `deriveSteepUnproven` import that only fed that block; the two RAG example chips, the ocean chip and the derived-place chip are untouched. `verify_app.mjs` now fails if `chip-ice`, `chip-herring`, `Arctic sea ice shrinking` or `Steep, but not proven` reappears in `main.js`. `verify_red_herring.mjs` is updated rather than deleted: it still fails if the derived seed stops being a featured, non-exploratory, steep-but-unproven case, and it now also fails if the chip comes back or if the seed station is missing from the shipped index (so it can still be asked for by name); it still reports `McMurdo 0.303 °C/decade, p 0.060, n 36, ranked 7/14 by steepness`. `DEMO.md` step 1:18 now types **Is McMurdo warming?** instead of clicking the chip, and its "what the twist depends on" paragraph says the chip is gone.

- [x] G89: In the browser the strip shows exactly the four remaining chips, and both removed questions still work when typed.
  MANUAL: Cloud browser, built site, 1440x900.
  EVIDENCE: `#suggestions .chip` returns exactly 4 nodes: `Is the Sahel getting drier?`, `Is Nairobi warming?`, `Is the Pacific warming?` (chip-ocean) and `Is Gold Coast getting hotter?` (chip-derived) — neither removed chip is present. Typing `Is the Arctic sea ice shrinking?` into the ask box still plans `CASE PLAN 56% MATCH Sea ice extent Arctic sea ice · 12-month mean · 1990–2025 · 10⁶ km²`, and typing `Is McMurdo warming?` still plans `CASE PLAN 72% MATCH Temperature at 2 m McMurdo · 1990–2025 · °C`, so only the chips were removed, not the cases. Screenshot: `artifacts/ask-chips.png`. `scripts/verify_all.sh` passes on this build after one rerun: the first run's only failure was `verify_live.sh` seeing 503 from GitHub Pages mid-deploy for `/dist/index.html`, which returned 404 seconds later and passes standalone.

- [x] G90: A misspelt place resolves — `illonoisis` finds Illinois, `reykavik` finds Reykjavik — through the shared matcher both hosts run.
  CHECK: node scripts/verify_search.mjs
  EXPECT: search verified
  EVIDENCE: `searchPlaces` scores every entry by how much of the typed name its key accounts for, then adds a population prior, so the answer people expect wins. `scripts/verify_search.mjs` passes against the built gazetteer: `illonoisis` → Illinois (match `typo`), `reykavik` → Reykjavík, `Pariss` → Paris, `goldcoast` (no space) → Gold Coast, `guidance`-free nonsense like `zzqxville` → nothing, and `Paris` is not displaced by a longer name. The typo budget grows with the word — one edit per five letters — because "illonoisis" is three edits from "illinois". Both the Worker (`worker/resolve.js`) and the page (`src/field.js`) import this one function, so a pass here is a pass for either host.
  NOTE: Typo tolerance changes behaviour honestly: "Is Atlantis warming?" now returns Atlanta and the Atlantic-region names as candidates, which is why the outage test in `verify_resolve.mjs` had to move to a name nothing is close to.

- [x] G91: An ambiguous name comes back as ranked candidates with a "did you mean" flag instead of one silent guess, and `washington` offers Washington, D.C. first.
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: The response carries `candidates` (name, country, kind, subtype, population, score, match) plus three flags: `ambiguous` when the runner-up is within 0.12 of the best, `expanded` when the answer is a name the question did not spell out, `corrected` when the matcher had to repair a typo. `verify_resolve.mjs` asserts `"Is Washington getting hotter?"` returns `Washington,  D.C.` first (folded `washington d c`), `expanded: true`, at least two candidates, the state as the second, and finite coordinates on every candidate; `illonoisis` returns Illinois with `corrected: true`; `Gold Coast` is none of the three flags. Scoring is what makes Washington work: an exact city scores 1.0, the initials expansion scores 0.98, and the population prior (0.25 × log10(pop)/7) puts Washington, D.C. (4.3M) ahead of the state (no population) and ahead of the UK Washington.

- [x] G92: The gazetteer carries Natural Earth states and provinces, so `illinois` is a place the app can answer.
  CHECK: node scripts/verify_gazetteer.mjs
  EXPECT: gazetteer verified
  EVIDENCE: `scripts/build_gazetteer.py` now also reads `ne_10m_admin_1_states_provinces` and writes 4,560 regions as `[name, country, lat, lon, type, altNames]` beside the 6,421 places, taking each division's label point from the DBF rather than parsing a polygon. `verify_gazetteer.mjs` passes: Illinois is a State in the United States with its label point at 39.946, -89.1991 inside the state's own bounds, Queensland and Ontario are present, Gold Coast is still a place, Broadbeach is still deliberately absent, rows are unique by name and country, every coordinate is in range, and the file is 554 KB (under the 800 KB budget, because the page downloads it).
  NOTE: That layer's DBF names its columns in lower case (`name`, `admin`, `type_en`), unlike the populated-places layer; the first build returned 0 regions until that was handled.

- [x] G93: Asking `washington` shows a "Did you mean" popup with Washington, D.C. first, and choosing it opens the derived case.
  MANUAL: browser measurement on the built page.
  EVIDENCE: On the dev page, `"Is Washington getting hotter?"` rendered a popup titled "Did you mean one of these?" with exactly two buttons — `Washington, D.C. city · United States of America · 4.3M` then `Washington state · United States of America` — while the plan behind it read `74% MATCH Washington, D.C.`. Clicking the second button removed the popup, moved the plan to Washington at 47.49°N 120.36°W and, on run, opened `CASE-16C2 · DERIVED CASE · STATE · UNITED STATES OF AMERICA` with the notice "The bundle has no station for Washington, a state, so this case is the GISTEMP 4° cell nearest its centre". `"Is illonoisis getting hotter?"` showed the singular title "Did you mean" with one button, `Illinois state · United States of America`, and choosing it opened `CASE-433D` at 39.95°N 89.20°W, +0.26 °C/decade.

- [x] G94: The static GitHub Pages build behaves the same — typo, ambiguity and popup — with no server at all.
  MANUAL: browser measurement against `python3 -m http.server` serving `dist`.
  EVIDENCE: Served from a plain static server (which answers POST with 501 and has no resolver), `"Is Washington getting hotter?"` produced the same two-item popup from `data/gazetteer.json` — one failed `/api/resolve` request, then the page's own match — and `"Is illonoisis getting hotter?"` produced "Did you mean" → Illinois → `CASE-433D` at +0.26 °C/decade. The candidate objects carry their own coordinates, so choosing one needs no further call on either host.

- [x] G95: Nothing regressed: the existing resolver, bundle, offline and first-load checks still pass and the build still succeeds.
  CHECK: node scripts/verify_resolve.mjs && node scripts/verify_bundle.mjs && node scripts/verify_offline.mjs && npm run build
  EXPECT: resolver verified
  EVIDENCE: All four pass after the change (`resolver verified: 10973 gazetteer places`, `bundle verified`, `offline verified`, `✓ built`). `verify_firstload.mjs` still passes at 293 kB gzip on the critical path (was 289 kB, +4 kB for the matcher), and `verify_all.sh` now runs the two new checks before the resolver. The worker's gazetteer loader and the Vite middleware both index places and regions, so the server paths see the same 10,973 entries the page does.

- [x] G96: The hero opens centred on Papua New Guinea with a neutral, upright view, and spins faster than one turn per 50 s.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: `START_LAT` moves from -25.3 to -6.5 and `START_LNG` from 133.8 to 145.0, which puts New Guinea on the disc's midline instead of Australia, so nothing sits tilted up above the centre; `camera.up.set(0, 1, 0)` already keeps the view neutral and is unchanged, and `controls.autoRotate` stays off. `SPIN_IDLE` goes from `(2 * Math.PI) / 50` to `(2 * Math.PI) / 40` — one eastward turn per 40 s, 1.25x the old rate — with hover still a fifth of it. `verify_app.mjs` expects the new latitude, longitude and rate, so a silent revert fails.

- [x] G97: On the built page the island is centred and upright, and the measured spin matches one turn in 40 s.
  MANUAL: Cloud browser, built site, 1440x900, temporary probe removed before committing.
  EVIDENCE: With a temporary probe (grep now finds 0 hits in `hero.js`, and the built page reports `typeof window.__heroProbe === "undefined"`), two samples 9.465 s apart read `rotation.y` 0.48957 -> 1.96083 = 0.15544 rad/s, one turn in 40.42 s, against the 0.15708 target (1% low, timing noise) and the 0.12581 measured at the 50 s setting; `camera.up` was `[0, 1, 0]` and `pov` `[-6.5, 145]` at both samples. The screenshot shows New Guinea across the middle of the disc with Australia below-right and Asia above, no upward lean: `artifacts/hero-png-final.png`, plus a second frame 4 s later (`artifacts/hero-png-final-t1.png`). `scripts/verify_all.sh` passes on this build.

- [x] G98: A misspelt climate word asks the right variable, and the plan says which word it read.
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: `readVariable()` keeps the old keyword regexes and only when none of them fires does it repair one word against the climate vocabulary — `precipitation`, `rainfall`, `drought`, `monsoon`, `moisture`, `wetness`, `radiation`, `sunshine`, `cloudiness`, `temperature`, `warming` — within the length-scaled typo budget and only for words of six letters or more, because a wrong variable is a worse answer than a fallback. `verify_resolve.mjs` asserts `"Is precipitiation in Nairobi changing?"` asks PRECTOTCORR, reports `variableCorrection {typed: "precipitiation", word: "precipitation"}`, and says `read "precipitiation" as precipitation; "nairobi" resolves to Nairobi` in its explanation; `"Is temperture in Chicago rising?"` asks T2M. In the browser the plan read `Precipitation (corrected) · Chicago` with the same explanation, and running it opened `CASE-20CA` on rainfall (−0.04 mm/day per decade) rather than silently answering temperature.

- [x] G99: A misspelt station name opens the station's own case and offers it in the popup, instead of falling through to a coarser derived cell.
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: `stationCandidates()` compares the question's one-, two- and three-word windows against the 708 station names only — never country aliases — and only after the exact pass found nothing, so a correct name can never be "repaired". `"Is Nairobii getting hotter?"` returns Nairobi with `corrected: true` and `candidates[0] = {id: "nairobi", kind: "station"}`; `"Is Melborne warming?"` returns Melbourne the same way. In the browser the ask showed a "Did you mean" popup containing exactly `Nairobi station · Kenya · 3M`, the plan behind it read `"nairobii" was read as Nairobi, Kenya, which is one of the bundle's stations`, and choosing the candidate replaced it with the station plan (Nairobi · 1990–2025 · °C). The same two steps produced the same popup and plan on a plain static server over `dist`, so no server is needed for this either.

- [x] G100: The tolerance does not fire on names that are already right, and it does not hide the place standing next to a misspelt climate word.
  CHECK: node scripts/verify_resolve.mjs && node scripts/verify_search.mjs && npm run build
  EXPECT: search verified
  EVIDENCE: Exact questions are untouched: Nairobi, Paris, Sydney, Chicago and Gold Coast all come back with `corrected: false` and `variableCorrection: null`, and the typo budget is zero below five letters so short words are never mangled. A misspelt climate word is dropped from the place query in `worker/resolve.js` (`climateTypo` in the `placeQuery` filter) — without that, `"precipitiation"` stayed in the name, dragged coverage under the 0.6 floor and hid the city beside it; `"Is precipitiation in London changing?"` now places London and asks PRECTOTCORR, which `verify_resolve.mjs` asserts through `handleResolve`. `verify_search.mjs` and `verify_resolve.mjs` both pass, the build succeeds, and first-load is 294 kB gzip (+1 kB).

- [x] G101: A misspelt country name answers that country's average and says which name it read.
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: `resolveCountry()` keeps its exact pass and adds one repaired pass over country aliases of five letters or more, using the same window-and-budget matcher as stations. `verify_resolve.mjs` asserts `"Is Austraila warming?"` → country Australia with `corrected: true` and `"austraila" was read as Australia` in the explanation, and `"Is Cannda getting hotter?"` → Canada. In the browser the plan read `Australia average · 12 stations · 1990–2025 · °C` with the same sentence, and running it opened `CASE-A113 · COUNTRY AVERAGE · 12 STATIONS · OCEANIA`; the plain static server over `dist` produced the identical plan, so this needs no Worker.

- [x] G102: A misspelt ocean basin answers that basin instead of silently falling back to the global ocean.
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: Before this, `"Is the Indain Ocean warming?"` matched the generic alias `ocean` (the global aggregate) exactly and answered the world. A repaired alias may now replace an exact one only when the exact words are all words of the repaired name — `ocean` is inside `indian ocean`, so the repair wins; a name that was spelled correctly never can. `verify_resolve.mjs` asserts `"Is the Indain Ocean warming?"` → Indian Ocean with `corrected: true` and `"Is the Pacfic warming?"` → a Pacific basin, also corrected. In the browser the plans read `Indian Ocean · 373 ocean cells` and `Tropical Pacific · 314 ocean cells` with `was read as …` in the explanation, on both the dev server and the static build.

- [x] G103: The repair never replaces a name that is already right, and the exact controls are unchanged.
  CHECK: node scripts/verify_resolve.mjs && node scripts/verify_search.mjs && npm run build
  EXPECT: search verified
  EVIDENCE: `"Australia"` is one edit from `"Austria"`, and an early version of this swapped them; the guard added for that is pinned in `verify_resolve.mjs`: `"Is Austria warming?"` → Austria with `corrected: false`, `"Is Australia warming?"` → Australia with `corrected: false`, `"Is the Indian Ocean warming?"` → Indian Ocean with `corrected: false`, while `"Is the ocean warming?"` still answers the global ocean. In the browser the Austria control read `Austria average · 3 stations` with the plain wording. A repaired country or basin also cannot outrank a station the question really names. `verify_search.mjs` and `verify_resolve.mjs` pass, the build succeeds, and first-load stays at 294 kB gzip.

- [x] G104: A misspelt state or province resolves to it, in the ask box and in the popup.
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: States and provinces ride the gazetteer's shared matcher, so they were already typo-tolerant once the gazetteer carried them; this pins it. `verify_resolve.mjs` asserts `"Is Illonois getting hotter?"` → Illinois with `kind: "region"` and `corrected: true`, `"Is Pensylvannia getting hotter?"` → Pennsylvania, and the exact control `"Is Pennsylvania getting hotter?"` → Pennsylvania with `corrected: false`. In the browser the same question produced a "Did you mean" popup whose only entry was `Illinois state · United States of America`, and the plan behind it read `Derived case · United States of America · 39.95°N 89.20°W · nearest GISTEMP cell` — on the dev server and on the plain static build alike, since the page carries its own gazetteer.

- [x] G105: A misspelt sea-ice name answers that hemisphere's record instead of the global one or a land station.
  CHECK: node scripts/verify_resolve.mjs
  EXPECT: resolver verified
  EVIDENCE: Two separate misses were fixed. `"Is Antartic sea ice shrinking?"` matched only the words "sea ice" — the global record — and now repairs to Antarctic sea ice via a strict alias match (one edit, same length); `"Is the Arctic see ice shrinking?"` never looked like an ice question at all, so the station table's `arctic` alias answered with Tromsø air temperature, and `mentionsIce()` now recognises "see ice" as "sea ice" within one letter. `defaultSeaIceRecord()` also repairs a hemisphere word ("artic", "antartic") instead of defaulting to both poles. `verify_resolve.mjs` pins `Antartic` → Antarctic sea ice (corrected), `Artic` → Arctic sea ice (corrected), `Arctic see ice` → Arctic sea ice (corrected, `kind: "seaice"`), and the controls `"Is Arctic sea ice shrinking?"` and `"Is global sea ice shrinking?"` → not corrected. `"Is Antarctica warming?"` still answers the Antarctica country average rather than being eaten by the ice record. In the browser the plan read `Sea ice extent · Antarctic sea ice · 12-month mean`, and running it opened `CASE-68B7 · SEA ICE EXTENT` on the static build.

- [x] G106: A dropped letter finds the right name anywhere on the map, and it is measured rather than asserted for one country.
  CHECK: node scripts/verify_typos.mjs
  EXPECT: typos verified
  EVIDENCE: `verify_typos.mjs` takes a seeded sample of 300 names from the 6,421 cities and 300 from the 4,560 states and provinces, drops one letter from the middle of each folded name, and asks the shared matcher for it. Results: cities 95.0% first and 99.0% in the first three; states and provinces 95.7% first and 99.3% in the first three; nothing unplaced in either set. Named spot checks across six continents all land first: Queensland (`queenland`), Alberta, Ontario, Jalisco, Santa Catarina, Gauteng, KwaZulu-Natal, Guangdong (`guandong`), Sichuan, Yunnan, Maharashtra, Tamil Nadu, Hokkaido (`hokkido` → Hokkaidō), Kyoto (`kyto` → Kyōto), Reykjavik, Nairobi, Ulaanbaatar, Medellín, Wellington, and Bavaria/Saxony by their English names (→ Bayern/Sachsen, which is what the layer calls them). Three ranking bugs came out of the measurement: a repair used to be ranked by population, so `Guandong` lost to Andong and `Cataonia` lost to Catania (repairs now rank by how much of the word changes, with a state breaking an exact tie); the unspaced rule matched any key inside the typed word, so `Guandong` counted as an unspaced `Andong` (it now requires the whole word, spaces aside); and `Andalucia` was matching `Santa Lucía` three edits in (a repair that changes the first letter and more than one edit is now rejected) while `Normandy` matched `Norman` (a whole extra ending is a different name). `"Is Canada warming?"` is answered by the country path before this table is asked, so the clean-question controls use place and state names. A live check then caught a fourth, cross-path version of the same mistake: `Queenland` (Queensland) was captured by the *country* matcher as Greenland, because the first-letter guard lived only in the place matcher. The guard and the extra-ending rule now apply to country, basin and ice-record repairs too, `Queenland` reaches the gazetteer and resolves to Queensland, and `verify_resolve.mjs` pins both ends of that — the plan must leave it unresolved, and the resolver must return Queensland.
  NOTE: Coverage follows the Natural Earth layer, which is not uniformly first-order: Germany, China, India, Japan, Brazil, Australia and the US arrive as states/provinces, while Italy, Spain and the UK arrive as provinces, communities and districts. Names the layer does not carry — Lombardy, Scotland, Andalusia, Brittany — resolve to nothing rather than to a lookalike; `verify_typos.mjs` asserts they are never answered silently.

- [x] G107: Every repair raises the "Did you mean" popup, not only place names.
  MANUAL: browser measurement on the built page, dev server and static build.
  EVIDENCE: `planCase` now returns a `repairs` list naming each word it changed (station, state/ocean/country, ice record, climate word), and `showSuggestions` renders the non-place repairs as popup buttons beside any place candidates. On the built page: `Is precipitiation in Chicago changing?` → "Did you mean" → `precipitation · climate word`; `Is Austraila warming?` → `Australia · country`; `Is the Pacfic warming?` → `Tropical Pacific · ocean`; `Is Antartic sea ice shrinking?` → `Antarctic sea ice · ice record`; `Is Nairobii getting hotter?` → `Nairobi · station · Kenya · 3M`; and `Is Nairobi getting hotter?` raises nothing. Clicking a repair closes the popup with a `Using Australia` toast; clicking a station still opens that station's plan. The same five popups appeared on a plain static server over `dist`. A first version wired the click handler to `[data-suggest]` only, so repair buttons did nothing — fixed and re-measured.

MET: 106
UNMET: 1
ABANDONED: 0
