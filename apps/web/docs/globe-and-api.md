# Globe visuals and backend integration

## Screen and readability

Earth occupies the center of the page. There is no dashboard header, event list, inspector, or permanent connection banner. A compact rotation control and interaction hint remain. Data errors show a retry notice; sample cards are explicitly labeled **Sample**.

The globe canvas uses the full page width. Newly visible cards find a free rectangle near their pin, with 16px clearance from existing cards. Earth does not constrain placement. Cards initially show only a compact headline. Click the headline (or use Enter/Space) to expand full details; click it again to collapse. Expansion selects the event and preserves the existing pin-relative offset. Card height can change without repacking neighbors, so expanded cards may overlap them. Once placed, a card keeps a world-space anchor and its width. Its position follows a curved projected path as Earth rotates, without repacking or switching sides. Cards avoid each other when first placed but may overlap later if their paths converge. Rotation behind Earth or removal by filtering releases its slot; reappearing cards get a new placement. If no free rectangle fits, the new card waits until space opens instead of moving existing cards or overlapping them. Cards are at most 278px wide. Existing cards are not clamped or repacked during rotation or resizing; they may extend offscreen until hidden and placed again.

Card title: 17px, coordinates: 14px, body: 13px, UTC time: 12px. Bright text sits on opaque dark panels. N/S and E/W clarify coordinate signs. Coordinates are rounded to four decimals **only for display**; state retains the original numbers. Summaries longer than 60px scroll inside the card, without hiding the source or coordinates. Titles wrap. Source links accept HTTP/HTTPS only. Null summaries and source URLs have explicit fallbacks.

Numbered screen-space pins correspond to numbered cards. Pins remain at their exact projected coordinate; event data does not move. All loaded events also retain globe markers. Up to four events are eligible for cards, ranked by `significance` descending with ID as the tie-breaker. The selected event takes priority; a selected surface point consumes one slot. This is a visual cap, not an API filter. Numbers identify the current displayed candidate set, not durable event IDs. The backend identity is always `event.id`.

## Rotation, anchoring, and visibility

`src/components/event-globe.tsx` loads only in the browser. The Earth draws bundled Natural Earth country polygons and border lines over the fluid orb. Change `landColor`, `countryBorderColor`, and the documented geometry settings in `src/lib/globe-config.ts`; see [vector basemap documentation](vector-globe.md).

Each animation frame:

1. Convert a callout's geographic coordinates to a surface vector with `getCoords`.
2. Test whether the surface faces the camera. For the current spherical Earth centered at the origin, the perspective horizon is `surfaceNormal · cameraPosition > globeRadius` (with a 0.5 world-unit margin).
3. Project with `getScreenCoords(lat, lng, pinAltitude)` and offset into the page's globe container.
4. Allocate a free rectangle for each newly visible card using `src/lib/card-placement.ts`. Keep world-space card anchors in a ref across rotation and React updates. Move all existing rectangles to their current projected pins before checking space for newcomers. Release hidden/removed cards before allocating newcomers. Connect the moving pin to the moving card edge midpoint with a `connectorInsetPx` extension under the card. A selected event retained after filtering keeps its card without a pin or connector.


The projection loop mutates only DOM positions and visibility. A selected event hidden by map filters retains its card without a pin/connector. It never changes event coordinates and makes **zero network requests**. Its animation frame, media listener, and resize observer are cleaned up on unmount. Cards near the horizon can disappear as Earth turns; pause rotation to read or interact with them.

Globe and card clicks, dragging, wheel/pinch zoom, and key presses inside the globe stop automatic rotation immediately. Hover alone does not. Rotation restarts `GLOBE.idleResumeMs` (10 s) after the last interaction: it eases from still to `rotationSpeed` over `spinUpMs` while tilt and zoom ease back to `initialView.lat` and the default fit over `viewReturnMs`. A held pointer, a selected event or location, an open connection card, or an open cluster list holds the view, so rotation never resumes under them; the countdown starts once they close. Selecting an event or location flies the camera to center it at the current zoom (linked-pin visits keep `relatedFocusAltitude` as a minimum). The camera stays upright: it tilts toward or away from the viewer by at most `maxTiltDegrees` (45°) and never rolls; centering clamps to that range. Switching between Headlines and Explore skips the idle wait: rotation starts (or keeps its speed) and tilt and zoom ease back at once. There are no pause or reset buttons. Reduced-motion users never get automatic rotation or view return, and inertial damping is disabled. Interaction listeners and pending timers are cleaned up on unmount. This behavior is local UI state and makes no backend requests. Clicking a source opens its URL in a new tab.

## Visual configuration

`src/lib/globe-config.ts` is the named configuration entry point. `src/app/globals.css` owns typography, card widths, colors of the page, and breakpoints.

| Setting | Default | Meaning / units |
| --- | --- | --- |
| `initialView` | 30, -110 | Initial latitude/longitude in degrees; positive longitude is east |
| `idleResumeMs` | 10000 | Idle time after the last globe/card interaction before rotation restarts |
| `spinUpMs` | 4000 | Rotation eases from still to full speed over this long |
| `viewReturnMs` | 4000 | Tilt and zoom ease back to the default view over this long |
| `maxTiltDegrees` | 45 | Largest tilt toward or away from the viewer; no sideways roll |
| `rotationSpeed` | 0.5 | OrbitControls speed; 1 is approximately one orbit/minute at 60fps |
| `atmosphereColor` | #87c8ef | Atmosphere color |
| `atmosphereAltitude` | 0.12 | Fraction of globe radius |
| `ambientLightIntensity` | 2.0 | Three.js ambient intensity, chosen for readable terrain |
| `sunlightIntensity` | 1.1 | Three.js directional intensity |
| `maxPixelRatio` | 2 | Maximum device-pixel ratio for rendering |
| `pointRadiusDegrees` | 1.9 | Angular radius of event markers |
| `pointAltitude` | 0.016 | Marker height as a fraction of globe radius |
| `surfaceFitWidth` | 0.43 | Maximum initial sphere radius / canvas width |
| `surfaceFitHeight` | 0.39 | Maximum initial sphere radius / canvas height |
| `minZoomAltitude` | 0.04 | Nearest camera altitude / globe radius; lower is closer |
| `pinToCardDistancePx` | 80 | Preferred horizontal gap when allocating a new card |
| `connectorInsetPx` | 6 | Connector extends this many pixels inside the card edge |
| `connectorWidthPx` | 4 | Straight connector thickness in CSS pixels |
| `cardEdgePaddingPx` | 24 | Responsive card width margin and retained-selection inset; does not clamp moving cards |
| `zoomOutMultiplier` | 1.7 | Maximum camera distance / fitted camera distance |
| `maxCallouts` | 4 | Maximum card candidates including a selected surface point |
| `colors` | by layer | Pin, connector, and card-accent colors |

The perspective fit uses the actual camera field of view: focal pixels = canvas height / (2 × tan(FOV/2)); distance = sqrt(radius² + (focalPixels × radius / desiredScreenRadius)²). Resizing recomputes the fit while preserving the current zoom-to-fit ratio within the zoom limits. Idle rotation eases tilt and zoom back to the initial latitude and whole-Earth fit. None of these visual settings belong in the backend Event contract.

## Current frontend/backend boundary

```
browser → GET /api/events → Next.js GET proxy → FastAPI GET /events
                        ↘ shared JSON in DATA_MODE=fixture
```

Configuration in `apps/web/.env.local` (restart Next.js after changes):

```dotenv
DATA_MODE=api
API_BASE_URL=http://127.0.0.1:43124
```

Default mode is `fixture`. These variables stay server-side. Never put the database URL or Gemini credentials in browser configuration. For deployment, `API_BASE_URL` must be reachable from the Next.js server. The browser keeps using relative `/api` URLs.

| Browser endpoint | FastAPI endpoint | Current caller / behavior |
| --- | --- | --- |
| `GET /api/events` | `GET /events` | `getEvents()` in `src/lib/api.ts`, all pages on page mount and on error retry |
| `GET /api/events/{id}` | `GET /events/{id}` | Proxy available; not currently requested because cards use the list payload |
| `GET /api/events/{id}/links` | `GET /events/{id}/links` | Proxy available; not currently requested; relation cards are not implemented |
| `GET /api/health` | `GET /health` | Proxy available; not polled by this page |

The proxy forwards query parameters and upstream statuses, disables caching, and times out after 10 seconds. Network failures become 502. It allows only the GET routes listed above; ingestion is not exposed. Fixture mode returns the fixed full array and does not implement filtering/pagination.

Expected events response:

```ts
{
  generatedAt: string; // ISO timestamp
  sourceStatus: Record<string, string>;
  events: Event[];
  nextCursor: string | null;
}
```

The frontend follows `nextCursor` until every page is loaded, then publishes one Event array. A 409 response discards partial data and restarts once; another failure shows Retry. Repeated cursors stop with an error. API-served fixtures are labeled Sample using sensor source status, even when the proxy is in API mode. The database status key is `tigerdata`. Rotation never initiates requests.

## Fields consumed by the UI

The authoritative contracts remain root `packages/schema/event.schema.json` and `link.schema.json`; do not rename backend fields.

| Event field | Frontend use |
| --- | --- |
| `id` | Stable card/marker identity and future detail/link lookup |
| `lat`, `lng` | Full-precision coordinates in degrees; lat [-90,90], lng [-180,180] |
| `layerId` | Card category and marker/connector color |
| `title`, `summary` | Card contents; summary can be null |
| `source`, `sourceUrl` | Source attribution and external link; URL can be null |
| `occurredAt` | Human-readable UTC timestamp |
| `geoPrecision` | Shows point/city/region/country precision to avoid implying exact locations |
| `significance` | Prioritizes the small number of visible card candidates |
| `updatedAt`, `altM`, `geoSource`, `entities`, `rawRef` | Retained in event objects; no current visual behavior or request triggered |

Sensor depth (`altM`) is not used as visual pin altitude. Globe pin height is cosmetic and must not change stored event altitude. `weight` controls each event’s heatmap intensity. The backend supplies this value; the frontend uses it directly, clamped to zero or greater, without deriving it from significance. It does not affect marker size or card content.

## Selection hooks for future functionality

`Selection` is exported from `src/components/event-globe.tsx`; `src/app/page.tsx` owns the state:

```ts
type Selection =
  | { kind: 'location'; location: { lat: number; lng: number } }
  | { kind: 'event'; event: Event };
// null means cleared.
```

- Surface click: normalizes longitude into [-180,180), and invokes `onSelect` with the exact location. A numbered pin/card displays that location. **No request or persistence occurs.**
- Existing pin/card click: invokes `onSelect` with the event. This is the future place for fetching details or relationships. Use `encodeURIComponent(event.id)` because IDs include colons or other characters.
- Clear: invokes `onSelect(null)` and removes surface selection or event highlighting. No backend mutation.

Potential backend integration (not implemented): derive a bounding box from the selected location and a user-chosen radius, then call `/api/events?bbox=minLng,minLat,maxLng,maxLat`. The documented event API also supports `types`, `start` (inclusive), `end` (exclusive), `minSignificance`, `limit`, and `cursor`. A radius is not currently a documented backend parameter. Agree on antimeridian/pole handling, query radius, debounce/cancellation, and pagination with the API teammate first.

The link endpoint's response envelope must also be agreed before use; the fixture currently returns an array of EventLink objects. There are no location-search POSTs, analytics requests, save actions, or ingest calls in this UI.

## Manual verification

- Confirm readable cards and terrain on desktop and 390px mobile width.
- Pause/resume; drag until a marker disappears behind Earth; verify its card and connector disappear too.
- Click a surface point: verify the card's hemisphere labels, pin tracking, and clear action.
- Click a source and verify its URL; click a pin/card title and verify selected state.
- Rotate/zoom/resize and confirm cards follow curved projected paths from their world-space anchors, may cover Earth, and avoid existing cards on initial placement. Confirm each connector has one straight segment.
- Scroll in to country scale, then leave the globe idle for 10 s: it eases back to the whole Earth while rotation spins up.
- Inspect requests: only initial/retry `/api/events` pages, assets, and explicitly opened source links.
- Run `npm run lint` and `npm run build` from `apps/web`.

## Layer controls and deep links (#5)

`src/lib/layers.ts` defines the single `LayerState` object, keyed by all nine schema layer IDs. Each value is `{ enabled, mode, weightField }`. Disabled layers remain in this object. Technology, Government & Politics, Finance, and Society start enabled; the other five start disabled. Earthquake and wildfire start in `both` mode; other layers start in `markers` mode. Only the focused density layer renders heat. Every layer keeps `weightField: 'weight'` fixed in its config.

The compact Layers menu changes enabled state for all layers and rendering mode (`markers`, `heatmap`, `both`) for earthquake and wildfire. Other layers always use individual POI markers; legacy heatmap modes for those layers are canonicalized to markers. Heatmaps always use the backend-supplied event `weight`; there is no weight-field dropdown. The backend can calculate this value from significance, severity, or other factors. Opening or closing the menu preserves rotation. Marker colors match each layer's heatmap color. Native react-globe.gl heatmaps replace the original deck.gl proposal; no Google Map is mounted.

`page.tsx` retains the one API Event array. `deriveVisuals` applies enabled-layer and time filters, then derives marker arrays and per-layer weighted heatmap datasets. Disabled layers get empty datasets; the renderer skips empty heatmaps to avoid unnecessary density computations. No `key` is changed on the globe, so toggles do not reset camera, zoom, or selection. No network request is triggered by a toggle or rendering-mode change.

Time uses `occurredAt >= start && occurredAt < end` in UTC. A visible time scrubber is not included in this task; the menu displays the URL time range and can clear it. Unknown layer IDs in URLs are ignored; explicit `layers=` means all off. Missing `layers` restores the product defaults. Invalid modes fall back to defaults. Legacy `weights` URL overrides are ignored and removed when the URL is canonicalized. Invalid/reversed/missing time ranges become all-time.

Deep-link format:

```text
?layers=earthquake,wildfire,humanitarian&t=all
?layers=earthquake&t=2026-10-03T00:00:00Z,2026-10-04T00:00:00Z
?layers=wildfire&t=all&modes=wildfire:both
```

`t` is either `all` or two timezone-qualified ISO timestamps separated by a comma. `modes` accepts optional comma-separated `layer:value` overrides to make rendering modes shareable too. Browser percent-encoding of commas/colons is normal. Unrelated URL parameters and the hash are preserved. The URL is the persisted source for the one LayerState; `useLayerFilters` subscribes to history changes. Initial values are canonicalized with `replaceState`; user changes use `pushState`, so Back/Forward and refresh restore filters without navigation or a backend round trip. Selection itself is not serialized.

A selected event is retained independently of filtered arrays. Turning off its layer, changing to heatmap-only mode, excluding its timestamp, or removing its marker through the significance threshold/cap retains its card with a “hidden by map filters” label while hiding its pin/connector. It stays available even if that hidden location is behind Earth. Clear removes this retained card. Surface selection is also independent of layer filters. Relationship cards are not implemented; future relation selection should follow this same retention rule, using unfiltered event IDs rather than visible markers.

### Backend implications

The browser still requests only `GET /api/events` on initial load/retry. `layers`, `modes`, `t`, `heatmap`, and `minSignificance` are **frontend URL parameters**, not automatically forwarded to FastAPI. The `layers` values map to the backend's documented `types` parameter; an ISO `t` pair maps to `start` and `end` if server-side loading is implemented later. Modes are frontend rendering preferences. Event `weight` is part of the backend Event contract and supplies heatmap intensity. Do not make each layer its own fetch or discard selected events when adding pagination. The current frontend still loads one page; large datasets need a separate loading/performance plan.

### Checks

`npm test` runs the pure filter/URL tests using Node's test runner and the installed TypeScript compiler. Tests cover defaults, all-off state, invalid input, round-trip query preservation, exclusive end times, rendering modes, fixed event weight and legacy override removal, and source-array immutability. Browser checks cover card retention, history restoration, heatmap appearance, and no camera reset on toggles. Subsecond interaction was observed with the eight-fixture dataset; no large-feed performance guarantee has been established.

## Global event fixtures

`data/fixtures/events.json` contains 39 events: 36 clearly fictional societal demos, plus the original three Napa earthquake/fire/news contract fixtures. Existing relationship fixture IDs remain valid. The former disaster-heavy `placeholder:*` and `heatmap-demo:*` demos have been replaced.

Each of six regions (North America, South America, Europe, Africa, Asia, and Oceania) includes technology, government policy, finance, society, conflict-dialogue, and journalism examples. Every new record uses a `societal-demo:*` ID, `fictional-demo` source, `[Demo]` title, null source URL, and a summary stating it is not a real report. Coordinates are city centroids and never claim exact incident locations. All demos have significance above the default marker threshold of 50.

- [Current default view](http://localhost:3000/?layers=technology,politics,finance,humanitarian&t=all)
- [All six primary topics](http://localhost:3000/?layers=technology,politics,finance,humanitarian,conflict,news&t=all)
- [Optional disaster overlay fixtures](http://localhost:3000/?layers=earthquake,wildfire&t=all)

Explicit `layers` in an existing URL still overrides defaults. Open `/` without a query or use the current-default link to see the new focus. Filters remain local; fixtures are not injected into live API responses.

## Scroll / zoom performance

Native heatmap bandwidth also controls mesh resolution in the installed three-globe version. Increasing bandwidth from 1.2 to 3 degrees reduces each spherical mesh from approximately 1.10 million to 176 thousand triangles (about 84% fewer). This deliberately broadens smoothing; close fires still accumulate into a cluster but are less individually distinct. The display pixel ratio is capped at 1.5 rather than 2, reducing pixel workload on high-density displays.

Heatmap arrays and accessors retain stable identities across rotation and selection renders, avoiding unnecessary density updates. The color accessor applies depth-write and draw-order settings when three-globe updates a heatmap mesh; the frame loop no longer traverses the scene. Card layout is invalidated by camera controls, resizing, selection changes, and page scrolling. Measurements are batched before position writes, desktop cards move using transforms, and connector endpoints use the computed card positions. A stationary camera skips layout work except during card dragging, elevation animation, or explicit invalidation.

Earlier browser verification covered three simultaneous heatmaps (before density modes were restricted to earthquake and wildfire) and wildfire markers with heatmap, country zoom, and desktop card rails. Tests, lint, and build pass. The geometry reduction is calculated from the installed renderer; no numeric FPS improvement is claimed.


## Vector Earth and POI rendering

The active basemap uses `src/data/countries.geojson.json`, with country polygons and separate border paths over FluidOrb. A colorless depth-writing native sphere provides ocean picking and hides far-side geometry. There is no texture request or duplicate depth shell. [Vector globe documentation](vector-globe.md) covers provenance, settings, longitude seams, and backend boundaries.

Earthquake and wildfire start in both mode with wildfire as the preferred heatmap; other layers use markers. The default enabled layers are technology, politics, finance, and humanitarian. Only wildfire and earthquake support optional heatmaps because they represent spatial density. News, humanitarian, politics, conflict, terror, and finance remain individually selectable markers even if an old URL asks for heatmap mode. Disabled layers and time filtering still apply. Heatmaps use existing event weights, and clicks still feed the same local selection state.


## Heat plus clickable points (#6, globe implementation)

The existing react-globe.gl renderer provides native weighted heatmaps and clickable Three.js point meshes; no Google Maps, deck.gl overlay, deprecated Maps heatmap, or Map3DElement is introduced. At most four DOM callout pins/cards are created; other points are WebGL meshes. Clicking a point selects its Event and opens/prioritizes its React floating card.

`src/lib/layers.ts` exposes `MAX_MARKERS = 5000` and `DEFAULT_MIN_SIGNIFICANCE = 50`. The Layers panel edits the minimum significance. Marker candidates must be in an enabled layer/time window, permit marker display, and have `significance >= minSignificance`. They are sorted by descending significance, with ID tie-breaking, then capped. The original Event array remains intact. The panel reports displayed/qualifying counts when the cap is reached. Selected cards survive threshold and cap exclusions.

Earthquake and wildfire default to `both`. `heatmap=wildfire` is the default focus; `heatmap=earthquake` switches density while keeping the other layer's eligible markers. Only one heatmap dataset is populated. If the requested focus is off, in markers-only mode, or has no events in the time range, the other eligible density layer is used; otherwise none is drawn. The panel names the active layer. Heatmap-only mode on an unfocused layer has no visual until that layer becomes the focus. Layer configuration remains intact.

The marker threshold and 5,000 cap do not remove events from density calculations. All time/layer-filtered points in the active heatmap contribute their nonnegative `weight`, including the significance-20 synthetic fire clusters. Density is still normalized by the library within the active dataset. Set the marker threshold to 0 to inspect every fixture point.

New URL fields are `minSignificance` (finite nonnegative number, default 50) and `heatmap` (earthquake or wildfire, default wildfire). They round-trip through history alongside `layers`, `modes`, and `t`. Mode defaults changed: missing earthquake/wildfire modes now mean both; explicit `modes=wildfire:markers` remains marker-only. Existing non-density heatmap modes still become markers.

### FIRMS aggregation handoff (proposed; not implemented)

The current frontend consumes one `/api/events` response and computes density locally. It does not aggregate live FIRMS on the server. Before loading large FIRMS feeds, the backend should group hotspots by spatial cell and UTC time bucket, sum a consistently defined nonnegative weight, and return cell centroids for density. Retain individual high-significance Events with stable IDs for clickable markers; do not present an aggregated cell as an individual source event.

A proposed separate `GET /heatmap-cells?layer=wildfire&start=...&end=...&resolution=...` response would be `{ layerId, start, end, resolution, cells: [{ lat, lng, weight, count }] }`. This endpoint and its Next.js proxy allowlist entry do not exist yet; agree its contract with the backend owner before wiring it. Keep the marker Event array separate from that derived density response, reuse the same layer/time filters, and never send the marker significance threshold to the density query. Current backend `/events` defaults to 2,000 rows, with a maximum of 8,000; the frontend does not paginate, so a 5,000 render cap does not imply every backend event is loaded.

Validation includes a 6,000-event synthetic filter test: exactly 5,000 highest-significance markers survive while all 6,000 remain heatmap input. Tests also cover the inclusive significance boundary, one-heatmap fallback, malformed URLs, mode persistence, and immutable source data. This validates data selection, not GPU performance at 5,000 points. Browser checks use the local fixtures; large live-feed performance still needs server aggregation and GPU profiling.


## Technology, government, finance, and society focus

| UI label | Event / URL `layerId` | Default |
| --- | --- | --- |
| Technology | `technology` (new) | On, markers |
| Government & Politics | `politics` | On, markers |
| Finance | `finance` | On, markers |
| Society | `humanitarian` | On, markers |
| Conflict | `conflict` | Off, markers |
| News | `news` | Off, markers |
| Earthquakes | `earthquake` | Off, both when enabled |
| Wildfires | `wildfire` | Off, both when enabled |
| Terror | `terror` | Off, markers |

The first six topics lead the menu. Legacy categories remain for stored data and deep-link compatibility. Category names in event cards use the same friendly labels. Heatmap focus controls appear only when a density-capable layer is enabled, so the default product view is entirely marker-based. The 5,000 marker cap, significance threshold, time filters, selected-card retention, and one-heatmap limit remain in place.

Backend mapping: `technology` is added to `packages/schema/event.schema.json`; ingestion classifiers, warehouse constraints, and downstream consumers with hardcoded layer enums must accept it. Existing FastAPI type filtering compares strings and the Next.js proxy passes through Event rows, so no route change is necessary. Technology covers product launches, computing, AI, communications, and research. `politics` covers government policy and civic decisions; `finance` covers markets, investment, and economic developments. For this product iteration, `humanitarian` intentionally groups societal topics such as housing access, education, labor, community services, and aid under the Society label. This broadens the category's product meaning without rewriting existing event IDs. The backend should use these IDs, not the display labels; no live news ingestion or classification service is implemented by this UI change.


## Fluid ocean presentation

The generated land/ice PNG is composited over the animated Rare UI Fluid Orb. See [implementation, attribution, and image prompt](fluid-ocean.md). Oceans are visual only; this change adds no API calls, changes no Event fields, and leaves latitude/longitude selection unchanged.

Unnumbered surface markers use a 1.9° radius (5× the original 0.38°). Numbered HTML pins retain their existing size.

### Country selection, sidebar, and elevation

`page.tsx` owns a local `selectedCountryIds: string[]` independently from the single event/location `Selection`. Clicking a country toggles membership; ocean clicks leave the list unchanged. The left sidebar contains layer controls, each selected country and its loaded POIs, individual remove buttons, and Clear all. On narrow phones the sidebar stacks above the globe. Selection is session memory, not persisted to the URL or backend.

Country membership uses the bundled Natural Earth Polygon/MultiPolygon boundaries, including holes. Selected countries include all their loaded POIs regardless of layer/significance filters. Their union is deduplicated by event ID. No additional backend pages are fetched; simplified coastline geometry limits precision. Clicking a POI in the sidebar prioritizes its floating headline. The existing floating headline cap remains.

Antarctica stays white. Selected land rises to `GLOBE.selectedCountryAltitude` with its borders and markers over `GLOBE.countryAnimationMs` (600ms); deselection lowers it. The native layers share quadratic in/out easing. Numbered pins follow the native marker's current tween altitude. No elevation or country selection is sent to FastAPI; future server queries require an agreed country identifier and boundary policy.

### Dragging headline cards

Drag a headline with mouse or touch to reposition its card. Movement under 5px remains a normal click to expand/collapse; a completed drag suppresses that click. Pointer capture keeps the gesture on the headline rather than rotating the globe. Dragging counts as a globe interaction and restarts the idle countdown.

`src/lib/card-anchor.ts` unprojects the drop position onto the POI's camera-depth plane and stores a world-space anchor. Projecting that anchor as the camera orbits produces curved motion. New cards also get world anchors after collision-free initial placement. There is no Earth coverage constraint or continuous collision repacking. Cards can overlap later or after dragging/expansion. Anchors are local UI data, cleared when their POI hides or leaves the callout set; nothing is posted to the backend.

### Continent shading and neutral UI

`src/lib/continent-material.ts` shades country surfaces using their radial normal and camera direction. Only land is darkened near Earth's circular silhouette; the ocean and event palette remain unchanged. `GLOBE.continentEdgeShadeStrength` controls the amount (0.48 default). Antarctica has a white base with the same depth shading. Selected countries retain orange `selectedCountryColor` while raised, with darker orange `selectedCountrySideColor` extrusion walls. Antarctica retains its white cap. Deselecting restores the base colors.

UI panels, controls, borders, inputs, and text use neutral charcoal/gray tones matching the #4e4d4d cards, documented in `globals.css`. These presentation settings make no backend requests.

POIs have `pointsTransitionDuration={0}`: their cylinders keep a constant radius and height. The projection loop reads the country polygon's current native tween elevation and translates the marker base onto that surface; numbered pins and connector origins use the same elevation. There is no independent POI growth animation. This uses three-globe's `__data`/`__currentTargetD` polygon metadata and should be rechecked on library upgrades.

Raised-wall alignment: continent cap and wall materials render both faces. Border paths use the same great-circle contour subdivision as the native country mesh, with native path resampling disabled (`pathResolution=360`). Their groups scale from the current country polygon elevation rather than running a separate path tween. The small configured border clearance remains to prevent z-fighting.

Connector attachment: the endpoint follows the vertical midpoint of `.card-title` rather than the whole card. Expanding details, wrapping the headline, and scrolling trigger fresh measurements. The connector stays on the pin-facing card edge with the existing 6px inset and 4px stroke. This is presentation-only; backend selection and event fields are unchanged.

Connectors now terminate at the headline's horizontal and vertical center, with no pin-facing side selection or inset setting. The opaque card covers the inner segment. Country hover uses `GLOBE.hoverCountryColor` without affecting altitude, selection, or rotation; selected countries retain orange and Antarctica retains white. Border hover highlights its owning country too.

Country border lines are black while selected (raised walls remain dark orange). Click picking runs a fresh Three.js raycast on pointer release rather than relying on the renderer's cached hover result. Movement up to 6 CSS pixels for a mouse or 10 for touch/pen is tolerated; gestures exceeding that distance, cancelled gestures, secondary buttons, and releases outside the viewport do not select. Card gestures stay separate. This changes only local interaction, not API requests.

### Expanded cards and demo event connections

Expanding a headline sets the same persistent paused state as the Pause button. Closing it does not resume rotation; use Resume. Expanded cards keep their screen position, can be dragged by the headline anywhere (including over Earth or another card), and remain visible behind the horizon. Collapsing restores a world-space anchor from the current position. Ordinary collapsed headlines keep their existing rotation behavior.

`src/lib/related-events.ts` chooses up to three stable, ID-ordered sample destinations from the single loaded Event array. These **Demo links** are navigation placeholders, not asserted relationships. Selecting one calls the existing event-selection handler, opens the target as a compact headline (collapsing it if already expanded), and animates the camera for `relatedFocusMs` with a minimum altitude of `relatedFocusAltitude`, preserving wider current views. The source and target remain in the visual set even if filters would hide them. Multiple directed connections can coexist. Each source card provides On/Off controls for its demo destinations and Clear all connections from here, which removes only that source’s outgoing links. Clicking a destination title adds its link (without duplicates), selects it, and navigates to it. Toggling a link alone does not move the camera.

The red curve is a Three.js tube following a great-circle route. Both ends float `relatedArcClearance` globe radii above the sphere; its midpoint adds `relatedArcRise`. It has no vertical stems or surface attachments. `relatedArcColor` and `relatedArcRadius` control appearance. Earth naturally occludes its far side. The mesh ignores picking and disposes its geometry/material when replaced or unmounted.

Backend handoff: replace `placeholderRelatedEvents` with EventLink lookup using `sourceId` / `targetId` from `packages/schema/link.schema.json`, resolving IDs against the loaded events. Supply real relation/rationale/confidence separately when available; do not present these arbitrary demo associations as backend-inferred links. This implementation makes no new network requests and changes no backend contracts.

Card placement update: new cards (including expanded related-event cards) must fit a free rectangle with 16px clearance. There is no overlapping fallback. A headline that grows into a full card relocates only itself if its larger rectangle conflicts with another card. Existing neighbors keep their positions. Candidates outside Earth's projected circle are preferred; if none fit, free space over Earth is allowed. Straight connectors have no maximum length and follow the new card position. If no rectangle fits, the new card waits and retries when camera, layout, or dragging changes free space. Drag any open card by its headline to position it freely; user placement is not constrained by this automatic allocation rule. These changes are presentation-only and make no backend requests.

Whole-card dragging: all areas of headlines and expanded cards now start a drag, including text, padding, links, and related-event buttons. Moving at least 5px repositions the card; the following click is cancelled in the article's capture handler so it cannot open a source, navigate to a related POI, or toggle expansion. Pointer capture stays on the originally pressed child to preserve ordinary clicks. Text selection and native link dragging are disabled within cards. Touch gestures drag the card; mouse/trackpad wheel scrolling still scrolls its content. Coordinates and backend data are unchanged.


Default framing now uses `surfaceFitWidth: 0.46` and `surfaceFitHeight: 0.44`, making Earth about 7–13% larger depending on the viewport. Idle view return uses the same fit. Automatic card placement also samples 24 positions around Earth's perimeter to use corner space; outside-Earth candidates still win, overlaps remain forbidden, and existing cards stay put. Explicitly expanded cards remain mounted across related-event navigation, retaining their positions and connection controls. They may exceed the normal automatic headline cap but still wait for a free rectangle before becoming visible. Connection state is an in-memory directed list of source/target Event references; `setConnection` and `clearSourceConnections` are the UI controls to adapt to real EventLink IDs later. No new API calls or schema changes.

Headline perspective: collapsed cards scale from 100% near Earth's front to 88% near its limb, with up to 12° of X/Y tilt and 900px CSS perspective. Expanded, retained, and actively dragged cards stay flat at full size. `headlineMinScale`, `headlineTiltDegrees`, and `headlinePerspectivePx` tune this visual effect. Layout uses untransformed dimensions, so scaling cannot feed back into card sizing or placement. The transform pivots at the headline center, keeping its connector endpoint fixed.

New placement now excludes only the central circle at `cardCenterExclusion: 0.5` times Earth's projected radius (plus the normal 16px gap), allowing headlines and cards across the outer part of Earth. This is a spawn-time exclusion, not a moving collision rule: existing cards never jump away from Earth, and users can still drag anywhere. Cards wait if no free position outside the central circle fits. No backend changes or requests.

Expansion visibility fix: growing a visible headline into a full card no longer releases its slot before finding a replacement. If a larger collision-free slot exists, only that card relocates; otherwise it keeps its current position, even if the expanded size overlaps another card or the center exclusion. The user can drag it to a better position. Expanded-card connectors always draw to the projected event coordinate, including behind-Earth POIs and filtered events; hidden surface pins stay hidden. Collapsed cards retain normal horizon visibility rules. This corrects placement failure rather than changing the headline perspective effect.

Single-POI focus: when an Event is selected and the active connection list is empty, only that event's marker, headline/card, and connector remain in the visual data. Heatmaps are temporarily hidden too. This includes marker, headline, and country-sidebar POI selection. Clear POI selection (always available in the globe controls) or the expanded card's Clear button restores the existing layer/time/country-filtered view. Filters and the underlying Event array are not changed. Turning on a connection restores the multi-POI view; removing the last connection reapplies single-POI focus while selection remains. All POI selection now uses the same parent selection state, avoiding stale country-local focus after clearing. No backend requests or contract changes.

### Rooted selection tree

The initial POI selection is the root. Adding a connection locks that root while navigation can focus any node. Only the root and its connected tree nodes supply markers and callouts; default POIs and heatmaps remain hidden even after the last branch is removed. Nodes have one parent. Existing nodes can be revisited by their title, but their connection toggle cannot add a second parent or connect back to the root.

Turning off a connection or choosing Remove branch removes its target and every descendant, including their lines and expanded states. Sibling branches remain. Clear all connections from here removes all children and descendants but keeps that source node. If the active selection is removed, focus returns to a surviving node. Clear entire tree on the root or Clear selection tree in the globe controls clears all connections, expanded selections, and the root, restoring the current default filtered view. Collapsing a card is only a display change, not an unselection. `connectTree` and `pruneBranch` in `related-events.ts` implement these local UI semantics; backend data and contracts remain unchanged. This supersedes the earlier single-POI/multi-POI restoration behavior.

### FastAPI connection (current)

Local `apps/web/.env.local` uses `DATA_MODE=api` and `API_BASE_URL=http://127.0.0.1:43124`; the example env now recommends the same. The browser's paginated `/api/events` loader reaches FastAPI `/events` through the existing same-origin Next.js proxy. Start both apps using `apps/web/README.md`. No CORS changes are needed. Database credentials belong only in the ignored root `.env`; without them FastAPI serves snapshots/fixtures and the UI preserves sample labeling.

Expanded cards mount `RelatedEventControls`, which requests `/api/events/{encodedId}/links` and expects an EventLink array. It resolves the opposite endpoint against the complete loaded Event array, deduplicates destinations, labels relations as hypotheses, and displays backend rationale. Missing event IDs, empty relationships, loading, and errors are explicit; errors offer Retry. Closing/unmounting the card aborts its pending request. Active outgoing tree controls remain available even if a later link request fails. No arbitrary placeholder relationship is used by the UI now. Activating a backend link feeds the existing local tree logic; removing branches/clearing the tree never writes to FastAPI. `/api/health` is available for connection diagnostics.
