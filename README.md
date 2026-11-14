# NASA Hackathon 2026 - Project Earth 

Case Files — an Earth system trend detective for NASA Space Apps 2026. 

## Run locally

```sh
npm install
npm run dev
```

The app uses prebuilt data under `public/data`; rebuild the data bundle with:  

```sh
uv run python scripts/build_data.py --env-file path/to/.env
```

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

## Deploy to GitHub Pages

The app is built with Vite and served from `dist`. The workflow in
`.github/workflows/deploy.yml` builds and publishes `dist` whenever `main` is
pushed. In the repository settings, set **Pages → Build and deployment → Source**
to **GitHub Actions** once; after that the workflow owns the deployment.

Vite uses relative asset paths (`base: "./"`) and the app resolves data,
textures and point imagery through `import.meta.env.BASE_URL`, so the build works
under the repository subpath rather than only at the domain root.

## Map panel

The left column links the 3D globe to a map. Enter a place or a coordinate
(`Kigali`, `-1.29, 36.82`, `1°17′S 36°49′E`) and the app finds the closest record
it holds, opens that case, and shows the distance and bearing on a small map. When
the nearest GISTEMP cell is closer than the nearest station, the map readout
offers that cell as a second option. Selecting a point on the globe centres the
map on it; clicking the map searches that spot.

The base map is the local NASA Blue Marble texture cropped to the search area, so
the panel needs no tile server or API key. **Google Maps** is an outbound link for
the searched coordinate, not an embedded layer. Names resolve through the station
bundle, the country outlines already loaded for the globe, and an offline
gazetteer in `src/geo.js`; `node scripts/verify_locate.mjs` checks that resolution
without a browser.

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
