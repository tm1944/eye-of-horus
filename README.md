# Hypothesis Globe

A Google Maps globe with heatmaps of significant events. Layers toggle on and off. The product is not another news blob. It fuses open sensors with a small, source-linked hypothesis graph and an explicit unknown state.

The Next.js frontend foundation is in `apps/web`. Start locally with `cd apps/web`, `npm ci`, and `npm run dev`, then open http://localhost:3000. It uses shared fixtures by default. See [frontend setup and FastAPI connection](apps/web/README.md) to connect the local backend. Implementation is split across four teammates; the runbook is [#21](https://github.com/tm1944/hypothesis-globe/issues/21).

Issues are ordered most critical to least critical. Labels mark `critical` / `high` / `medium` / `low` plus `UI`, `backend`, `data`, `ml`, `demo`, `docs`, `contract`, and `parallel`.

Repo: https://github.com/tm1944/hypothesis-globe

## Weekend sources

- USGS earthquakes. Public domain GeoJSON feeds.
- NASA FIRMS fire hotspots. Free MAP_KEY. Cite NASA FIRMS.
- ReliefWeb reports. Free API. Respect partner copyright. Show title, source, time, coordinates, and a link. Do not paste article bodies.

Do not make a commercial news API the core of the demo. NewsAPI and GDELT Cloud restrict republish and resale.

## Stack

Google Maps, Gemini, and Snowflake stay. Cost is out of scope.

- Next.js App Router + React + TypeScript (installed versions in `apps/web/package.json`)
- Main screen: `react-globe.gl` + Three.js with spinning Earth, click coordinates, and fixture markers
- Google Maps + deck.gl remains the original regional-map proposal; heatmaps and arcs are not implemented yet
- FastAPI for backend data, reached through the Next.js `/api` proxy
- Snowflake XSMALL. RAW VARIANT plus MART.EVENT plus MART.EVENT_LINK
- Fixture JSON until the warehouse answers
- Gemini `gemini-3.5-flash-lite` extract, `gemini-3.8-flash` links

Do not call Snowflake or Gemini from the browser. Do not use deprecated Maps HeatmapLayer. Do not start photorealistic 3D this weekend.

## Four students in parallel

Share schema and fixtures first. Then these tracks do not wait on each other.

| Student | Track | Start here |
| --- | --- | --- |
| A | Map UI | #3 #5 #6 #8 |
| B | Ingest and Snowflake | #4 #7 #10 #13 |
| C | FastAPI | #2 #9 |
| D | Gemini and geocode | #11 #12 #14 |
| Anyone free | Keys, demo, polish | #17 #15 #16 |

Everyone also owns #1. Setup and runbook live on #21.

## Issues, most critical first

- P0 [#21](https://github.com/tm1944/hypothesis-globe/issues/21) Repo setup and four-track runbook
- P0 [#17](https://github.com/tm1944/hypothesis-globe/issues/17) Enable Google APIs, map ID, and FIRMS key on Friday
- P0 [#1](https://github.com/tm1944/hypothesis-globe/issues/1) Shared Event schema and weekend fixtures
- P0 [#2](https://github.com/tm1944/hypothesis-globe/issues/2) FastAPI GET /events from fixtures
- P0 [#3](https://github.com/tm1944/hypothesis-globe/issues/3) Google Maps vector map with one fixture point
- P0 [#4](https://github.com/tm1944/hypothesis-globe/issues/4) Snowflake DDL and Python connector
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

Real-time social firehoses. Custom models. Photorealistic 3D tiles. Live war, terror, and finance classifiers. Auth and billing. Snowflake streams and dbt. Claiming OEM rights on GDELT Cloud.
