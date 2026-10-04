# Hypothesis Globe

An interactive globe focused on technology, government, finance, and societal events. Layers toggle on and off. The product is not another news blob. The current UI shows clearly labeled fixture events; source-linked relationships remain a planned feature.

Events already live in the shared TigerData database. A new machine only needs the app installed and a connection string. Do not recreate the schema or reload USGS, GDACS, or FIRMS.

## Set up on a new machine

Node.js 20.9+ and Python 3.12+.

1. Clone the repo and create a gitignored env file at the repo root:

```bash
cp .env.example .env
```

On Windows PowerShell: `Copy-Item .env.example .env`

2. Put the TigerData URL in `DATABASE_URL`. From a terminal that is logged in (`tiger auth login`):

```bash
tiger service list
tiger db uri SERVICE_ID --with-password
```

Paste the printed `postgresql://...` string into `.env`. Leave `FIRMS_MAP_KEY` blank. That key is only for loading new hotspots, and the database already has its data.

3. Start the API so it reads that database. The frontend expects port 43124.

```bash
cd apps/api
python -m venv .venv
```

Windows: `.venv\Scripts\activate`  
macOS/Linux: `source .venv/bin/activate`

```bash
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 43124
```

`GET /health` should report `"database": "ok"`. If `DATABASE_URL` is empty, the API serves fixture JSON instead.

4. In a second terminal, from the repo root, start the site and point it at the API:

```bash
cd apps/web
npm ci
cp .env.example .env.local
```

Set these in `apps/web/.env.local`, then restart Next.js after any change:

```dotenv
DATA_MODE=api
API_BASE_URL=http://127.0.0.1:43124
```

```bash
npm run dev
```

Open http://localhost:3000. The browser talks only to `/api` on port 3000. Next.js forwards those calls to FastAPI. Do not put `DATABASE_URL` in the frontend env.

## Weekend sources

- USGS earthquakes. Public domain GeoJSON feeds.
- NASA FIRMS fire hotspots. Free MAP_KEY. Cite NASA FIRMS.
- ReliefWeb reports. Free API. Respect partner copyright. Show title, source, time, coordinates, and a link. Do not paste article bodies.

Do not make a commercial news API the core of the demo. NewsAPI and GDELT Cloud restrict republish and resale.

## Stack

Google Maps, Gemini, and TigerData stay. Cost is out of scope.

- Next.js App Router + React + TypeScript (installed versions in `apps/web/package.json`)
- Main screen: `react-globe.gl` + Three.js with spinning Earth, click coordinates, and fixture markers
- Google Maps + deck.gl remains the original regional-map proposal; heatmaps and arcs are not implemented yet
- FastAPI for backend data, reached through the Next.js `/api` proxy
- TigerData (Postgres + Timescale). `raw.ingest_batch` plus `mart.event` plus one table per event kind
- Fixture JSON until `DATABASE_URL` is set
- Gemini `gemini-3.5-flash-lite` extract, `gemini-3.8-flash` links

Do not call TigerData or Gemini from the browser. Do not use deprecated Maps HeatmapLayer. Do not start photorealistic 3D this weekend.

## Four students in parallel

Share schema and fixtures first. Then these tracks do not wait on each other.

| Student | Track | Start here |
| --- | --- | --- |
| A | Map UI | #3 #5 #6 #8 |
| B | Ingest and TigerData | #4 #7 #10 #13 |
| C | FastAPI | #2 #9 |
| D | Gemini and geocode | #11 #12 #14 |
| Anyone free | Keys, demo, polish | #17 #15 #16 |

Everyone also owns #1. Setup and runbook live on #21.

Repo: https://github.com/tm1944/hypothesis-globe

Issues are ordered most critical to least critical. Labels mark `critical` / `high` / `medium` / `low` plus `UI`, `backend`, `data`, `ml`, `demo`, `docs`, `contract`, and `parallel`.

## Issues, most critical first

- P0 [#21](https://github.com/tm1944/hypothesis-globe/issues/21) Repo setup and four-track runbook
- P0 [#17](https://github.com/tm1944/hypothesis-globe/issues/17) Enable Google APIs, map ID, and FIRMS key on Friday
- P0 [#1](https://github.com/tm1944/hypothesis-globe/issues/1) Shared Event schema and weekend fixtures
- P0 [#2](https://github.com/tm1944/hypothesis-globe/issues/2) FastAPI GET /events from fixtures
- P0 [#3](https://github.com/tm1944/hypothesis-globe/issues/3) Google Maps vector map with one fixture point
- P0 [#4](https://github.com/tm1944/hypothesis-globe/issues/4) TigerData DDL and Python connector
- P1 [#5](https://github.com/tm1944/hypothesis-globe/issues/5) Layer toggles and LayerState
- P1 [#6](https://github.com/tm1944/hypothesis-globe/issues/6) deck.gl heatmap and scatterplot overlay
- P1 [#7](https://github.com/tm1944/hypothesis-globe/issues/7) USGS ingest plus local snapshot
- P1 [#8](https://github.com/tm1944/hypothesis-globe/issues/8) Time scrubber on one Event array
- P1 [#9](https://github.com/tm1944/hypothesis-globe/issues/9) Health, sourceStatus, and fixture fallback
- P2 [#10](https://github.com/tm1944/hypothesis-globe/issues/10) FIRMS ingest and downsample
- P2 [#11](https://github.com/tm1944/hypothesis-globe/issues/11) Gemini extract, geocode verify, precomputed cards
- P2 [#12](https://github.com/tm1944/hypothesis-globe/issues/12) Relation cards and ArcLayer
- P2 [#13](https://github.com/tm1944/hypothesis-globe/issues/13) ReliefWeb country-centroid layer
- P2 [#14](https://github.com/tm1944/hypothesis-globe/issues/14) 30-row geo and link eval
- P3 [#15](https://github.com/tm1944/hypothesis-globe/issues/15) Demo script, buyer slide, backup video
- P3 [#16](https://github.com/tm1944/hypothesis-globe/issues/16) Empty, loading, and error states
- P3 [#18](https://github.com/tm1944/hypothesis-globe/issues/18) Optional ACLED if the account is already approved
- P3 [#19](https://github.com/tm1944/hypothesis-globe/issues/19) Optional react-globe.gl swap

## Demo script

1. Dark globe. Open sensors and a checked hypothesis.
2. Toggle earthquakes. A live USGS point pulses.
3. Toggle fires. FIRMS hotspots appear.
4. Toggle humanitarian reports. A ReliefWeb pin lands near one cluster.
5. Open the relation card. Two sources. Time gap. Confidence. Unknown if weak.
6. Toggle the political layer off. The card stays.
7. One buyer line. Insurer or NGO.

The wow moment is a card a judge can open in two real source URLs.

## Cut list

Real-time social firehoses. Custom models. Photorealistic 3D tiles. Live war, terror, and finance classifiers. Auth and billing. Claiming OEM rights on GDELT Cloud.

## Credits

Third-party data and assets the site shows. The same list appears as small credits in the globe's bottom-right corner (`apps/web/src/components/data-attribution.tsx`); keep the two in sync. Details, checksums, and rebuild steps are in the linked docs.

- **Event feeds:** [USGS](https://earthquake.usgs.gov/earthquakes/feed/) earthquakes (public domain); [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) fire hotspots; [GDACS](https://www.gdacs.org/) disaster alerts; [The GDELT Project](https://www.gdeltproject.org/) conflict events (via `data/backup_csvs/finalconflictCSV.csv`); [GNews](https://gnews.io/) headlines; and [Wikipedia Current events](https://en.wikipedia.org/wiki/Portal:Current_events) (CC BY-SA 4.0). Each event card also links its own source URL.
- **Star backdrop:** Yale Bright Star Catalogue, 5th Revised Ed. (Hoffleit, D. & Warren Jr., W. H. 1991), distributed by the CDS, Strasbourg as catalog [V/50](https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50). Positions, magnitudes, and B−V colors are copied unchanged by `apps/web/scripts/build-star-catalog.mjs` into `apps/web/src/data/bright-stars.json`. This project uses data obtained from the CDS, Strasbourg, France. Star colors follow Mitchell Charity's blackbody color table ("What color is a blackbody?", vendian.org). See [apps/web/docs/vector-globe.md](apps/web/docs/vector-globe.md#starry-backdrop).
- **Country shapes:** [Natural Earth](https://www.naturalearthdata.com/) Admin 0 countries, 1:110m, public domain. See [apps/web/docs/vector-globe.md](apps/web/docs/vector-globe.md).
- **Elevation relief:** `earth-topology.png` from the [three-globe](https://github.com/vasturiano/three-globe) examples (MIT, © Vasco Asturiano). Its original source is not stated upstream. See [apps/web/public/textures/README.md](apps/web/public/textures/README.md).
- **Rendering:** [three.js](https://threejs.org/), [three-globe](https://github.com/vasturiano/three-globe), and [react-globe.gl](https://github.com/vasturiano/react-globe.gl), all MIT.
