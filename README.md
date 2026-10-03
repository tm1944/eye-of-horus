# Hypothesis Globe

A Google Maps globe with heatmaps of significant events. Layers toggle on and off. The product is not another news blob. It fuses open sensors with a small, source-linked hypothesis graph and an explicit unknown state.

## Weekend sources

- USGS earthquakes. Public domain GeoJSON feeds.
- NASA FIRMS fire hotspots. Free MAP_KEY. Cite NASA FIRMS.
- ReliefWeb reports. Free API. Respect partner copyright. Show title, source, time, coordinates, and a link. Do not paste article bodies.

Do not make a commercial news API the core of the demo. NewsAPI and GDELT Cloud restrict republish and resale.

## Stack we already have

Google Maps, Gemini, and Snowflake are available at no cost for this team. Keep them. Challenge them only when they hurt demo speed, reliability, licensing, or quality.

- Snowflake is the warehouse. The globe API also reads a local snapshot so a cold warehouse or campus firewall cannot blank the map.
- Maps JavaScript API is the globe. Keep attribution. Do not scrape tiles. Ship 2D first.
- Gemini drafts relation cards with citations. It does not prove causality. Precompute demo cards. Never live-prompt the critical click.

## Who would pay later

1. Government and NGO watchboards.
2. Insurance and reinsurance hazard desks.
3. Commodity and macro desks.
4. Corporate OSINT.
5. Freemium prosumer.
6. Mass consumer last.

UI is not a moat. Licensed exclusive data is. Liveuamap already owns the consumer conflict map.

## Four-student split

- **Globe.** Maps JS, toggles, heatmap, markers, attribution.
- **Ingest.** USGS and FIRMS into Snowflake. Snapshot writer. Health page.
- **Relations.** Curated 10 to 20 events. Gemini batch. Cards with sources and confidence.
- **Narrative.** Demo script, buyer slide, offline snapshot, 60-second backup video.

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
