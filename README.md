# NASA Hackathon 2026 - Project Earth 

Signal & Noise — an Earth system trend detective for NASA Space Apps 2026. 

## Run locally

```sh
npm install
npm run dev
```

The app uses prebuilt data under `public/data`; rebuild the data bundle with:  

```sh
uv run python scripts/build_data.py --env-file path/to/.env
```

## City coverage

The bundle ships a hand-curated set of 45 cities plus the three largest populated
places of every country and territory, ranked by Natural Earth's `POP_MAX`:

- `scripts/build_cities.py` downloads `ne_10m_populated_places` and
  `ne_10m_admin_0_countries` (public domain, no account) into
  `data/cache/naturalearth` and parses the DBF tables with the standard library.
- `scripts/build_data.py` merges those candidates with the curated table: one that
  is already a case, or within 15 km of one (the same conurbation), is skipped, and
  a candidate is kept only when NASA POWER returns all four variables for it.
- A third pass fills regions the top-three rule leaves thin — Russia, northern
  China, the Sahara and Sahel, North America, South America, Australia, Southeast
  Asia, the Middle East, the Indian interior, Central Asia and the Amazon interior —
  with the largest city that no existing point covers within 500 km (minimum
  population 20,000), so a huge country is not represented by three metro areas
  while Europe carries a hundred.
- `--skip-grid` reuses the committed GISTEMP grid and `--skip-imagery` reuses the
  committed context imagery, so a city change does not rebuild the 4,039-cell
  field or refetch every Sentinel-2 mosaic:

```sh
uv run python scripts/build_data.py --skip-grid --skip-imagery
uv run python scripts/render_context.py --only <slug>   # Blue Marble fallback
uv run python scripts/fetch_sentinel.py --only <slug>    # Sentinel-2 upgrade
```

Every station answers to its country name, and every country on the globe has an
average record of its own. Ask "Is France warming?" and the plan offers the mean of
France's stations alongside a list of its cities, so a country question is answered
by the country rather than silently by its biggest city.

The result is 708 points across 222 countries and territories: 696 carry all four
variables and twelve keep three — the eleven Antarctic stations and Greenland's
Ittoqqortoormiit, where MERRA-2 masks root-zone soil wetness over ice. The Arctic holds
17 stations and Antarctica 11, up from 7 and 1; Russia 32, North America 102, northern
China 12, North Africa 30, South America 66, Australia 12, Southeast Asia 38, the Middle
East 43, India 9, Central Asia 18, the Amazon interior 19 and the Sahel 18. Islands and ice shelves
where MERRA-2 masks root-zone soil wetness are left out rather than filled with an
interpolated or mask value.

## Live conditions

The “Live” chip on a city case is served by a small proxy so the Meteomatics
credentials never reach the browser:

- `worker/live.js` — allowlists the bundle's points, queries Meteomatics for them
  in one request, caches for 10 minutes, and answers `live_unconfigured` when
  credentials are absent.
- `worker/index.js` — Workers entry: `/api/live` plus the static app.
- `vite.config.js` — the same handler behind the dev and preview servers, reading
  `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` from `.env`.

If the proxy is not running — the static GitHub Pages build, for example — the
app falls back to the snapshot captured during the data build and labels the
chip **Snapshot**.

To host the proxy, build with `npm run build`, deploy `worker/` with Wrangler
(`worker/wrangler.toml` serves `dist/` as static assets), and store
`METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` as Worker secrets.

## The ocean

The ocean is presented as places, not as points. The GISTEMP field already
covers water, so a basin is the area-weighted mean of the ocean cells inside it —
the same shape as a country average, with no marker added to the globe:

```sh
uv run python scripts/build_ocean.py
```

- `scripts/landmask.py` reads the cached Natural Earth 1:10m countries
  shapefile with the standard library and stamps `is_ocean` on every grid cell.
  The GISTEMP file carries anomalies only, so the coastline test comes from
  geometry.
- Eight disjoint basins (North/Tropical/South Pacific, North/South Atlantic,
  Indian, Southern and Arctic Ocean) plus a global-ocean aggregate, each averaged
  with a cos(lat) area weight and corrected with Benjamini–Hochberg across the
  eight basins only. The aggregate sits outside that family because it shares
  their cells, so its q is null rather than borrowed.
- Ocean cells carry ERSST-based sea surface temperature, which the interface
  labels as such; land cells remain surface air temperature.

Ask "Is the Pacific warming?" for a basin case, or use the third map layer to
see the field filtered to water. In that layer a tap on water opens the basin
under the tap — not the nearest station, and not a single cell's surface
temperature — using the same wrapped box test the build used to partition the
cells, so the map and the averages cannot disagree. Water outside every named
basin (the tropical Atlantic, 339 of the 2,672 cells) opens the global ocean
rather than being reported as land; a tap on land says so and opens nothing. `node scripts/verify_ocean.mjs` recomputes every mean, pins the
mask at named anchors, and round-trips each basin's cells through the tap test.

## The sea ice

Sea ice is a record, not a cloud of points on the cap. NSIDC publishes the
monthly extent of each hemisphere, so a case is the annual mean of twelve
monthly extents — the same annual-mean contract as every other record:

```sh
uv run python scripts/build_seaice.py
```

- The source is the NSIDC/NOAA Sea Ice Index (G02135), read as four CSV
  timeseries from NOAA PSL — extent and area, per hemisphere
  (`n_iceextent.mon.csv`, `n_icearea.mon.csv`, `s_iceextent.mon.csv`,
  `s_icearea.mon.csv`; 1978→present, 10⁶ km²). NSIDC also serves the index as
  24 per-month CSVs; that host throttles a bulk fetch (500s, then refused
  connections after ~30 rapid requests), and the PSL files carry the same index.
- 1990–2025, three records: Arctic, Antarctic, and global (their sum). The three
  form one Benjamini–Hochberg family, so each stores its own q.
- The Arctic is a proven decline: −0.539 ×10⁶ km²/decade, 95% CI −0.640 to
  −0.438, HAC p 1.4e-12, q 4e-12. The Antarctic is not proven: −0.233, CI −0.543
  to +0.077, HAC p 0.136. Same instrument, same window, opposite verdicts.
- Extent is the area with at least 15% ice cover — not concentration, not
  thickness — and averaging the twelve months hides the seasonal cycle. The
  case panel says both, and nothing is added to the globe.

### Two measures, side by side

The index also carries ice **area**, so a second measure rides on the same
records: concentration = 100 × area ÷ extent, the mean concentration of the
ice-covered area. It answers a different question from extent — how much of that
area is actually ice, rather than how far the ice reaches — and the two do not
have to agree:

| measure | Arctic | Antarctic |
|---|---|---|
| extent | −0.539 ×10⁶ km²/decade, proven | −0.233, not proven |
| concentration | +0.379 pp/decade, not proven | +0.161, not proven |

The Arctic pack is retreating, and the ice that remains is on average slightly
more concentrated — but the HAC and Mann–Kendall tests disagree on that second
point (p 0.017 vs 0.086), so the app does not call it. Every sea-ice case lists
both measures with their verdicts, and the measure switch changes the narrative
and facts.

The chart draws both series at once, each indexed to the window's first year =
100, so the divergence is visible without switching measures. Dual y-axes were
the alternative and were rejected: two freely chosen scales can suggest a
divergence the data does not have, while indexing cannot.

Ask "Is the Arctic sea ice shrinking?" for the Arctic case, "What is the Arctic
sea ice concentration?" for the second measure, or "Is sea ice shrinking?" for
the global sum. `node scripts/verify_seaice.mjs` recomputes both measures from the
cached series, checks the global sum against the two hemispheres, and requires
every alias to plan a sea-ice case.

## The globe

The planet is NASA Blue Marble shaded relief and bathymetry at **8192 × 4096** —
30 texels per degree at the equator, 3.1 MB — served from NASA GIBS and committed as
`public/textures/earth-blue-marble.jpg`, with a 4096 × 2048 greyscale shaded-relief
map driving the bump shading. `scripts/verify_textures.mjs` reads the image headers, so a downsized
texture cannot ship while the interface claims a higher resolution; it runs as part
of `scripts/verify_all.sh`.

## Deploy to GitHub Pages

The app is built with Vite and served from `dist`. The workflow in
`.github/workflows/deploy.yml` builds and publishes `dist` whenever `main` is
pushed. In the repository settings, set **Pages → Build and deployment → Source**
to **GitHub Actions** once; after that the workflow owns the deployment.

Vite uses relative asset paths (`base: "./"`) and the app resolves data,
textures and point imagery through `import.meta.env.BASE_URL`, so the build works
under the repository subpath rather than only at the domain root.

## Tap anywhere on the globe

Tapping the globe answers with the records closest to that coordinate. A yellow
marker sits on the tapped point, two dashed yellow arcs run to the nearest station
and to the nearest GISTEMP cell, each with its distance printed on the globe, and a
small card beside the point lists both records with their distances, a compass
bearing for the station, and an **Open** button for each.

Tapping inside a station's halo (1.6° around the dot) opens that station directly
instead of recommending neighbours, so the globe still behaves like a case browser.
The recommendation is local geometry over the cached bundle: no map tiles, no
geocoder, no outbound link. `node scripts/verify_locate.mjs` checks the nearest
record and the nearest cell against a brute-force minimum without a browser.

Station dots carry a faint halo, which is also the hover target: while the cursor
is anywhere inside that area the dot grows, its halo lights up, and a click opens
the case.

## Pages

Two pages are built from `vite.config.js` (`build.rollupOptions.input`):

- `index.html` — the landing page at the site root: what the app does, a sample
  verdict read live from `public/data`, and the statistical contract.
- `app.html` — the app itself: globe, question box, map link and the case file, which appears only while a case is open.

On GitHub Pages they are served at `/NASA-Hackathon-2026-Project-Earth/` and
`/NASA-Hackathon-2026-Project-Earth/app.html`. Both pages use relative links and
`./` asset URLs, so they also work from a local `vite preview`.
