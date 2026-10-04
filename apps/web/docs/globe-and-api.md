# Globe visuals and backend integration

## Screen and readability

Earth occupies the center of the page. There is no dashboard header, event list, inspector, or permanent connection banner. A compact rotation control and interaction hint remain. Data errors show a retry notice; sample cards are explicitly labeled **Sample**.

Desktop (1100px and wider): the center canvas reserves 320px on each side. Cards are 278px wide and sit 24px from the outside edges. The initial camera fits the entire sphere inside its canvas. Zoom-in now reaches a camera altitude of 0.04 globe radii (roughly 255 km above a real Earth), enabling country-scale and closer inspection. The enlarged Earth is clipped to the center canvas, keeping cards unobstructed. The surface is a smooth sphere with a local Earth texture, not detailed map tiles or country borders. Each rail holds at most two cards with a 16px gap. Layout is at least 800px tall so the cards remain readable on shorter windows; the page may scroll vertically.

Below 1100px, the canvas takes the full width and cards move into a grid below it. Below 580px, that grid becomes one column. No card is placed over Earth. Connectors are behind the cards and ignore pointer events.

Card title: 17px, coordinates: 14px, body: 13px, UTC time: 12px. Bright text sits on opaque dark panels. N/S and E/W clarify coordinate signs. Coordinates are rounded to four decimals **only for display**; state retains the original numbers. Summaries longer than 60px scroll inside the card, without hiding the source or coordinates. Titles wrap. Source links accept HTTP/HTTPS only. Null summaries and source URLs have explicit fallbacks.

Numbered screen-space pins correspond to numbered cards. Nearby numbered badges slide along their straight connector where space permits to provide separate click targets. The connector still begins at the exact projected coordinate; event data does not move. All loaded events also retain globe markers. Up to four events are eligible for cards, ranked by `significance` descending with ID as the tie-breaker. The selected event takes priority; a selected surface point consumes one slot. This is a visual cap, not an API filter. Numbers identify the current displayed candidate set, not durable event IDs. The backend identity is always `event.id`.

## Rotation, anchoring, and visibility

`src/components/event-globe.tsx` loads only in the browser. The Earth loads the user-provided `public/textures/8k_earth_daymap.jpg` (8192 × 4096). Change `GLOBE.textureUrl` in `src/lib/globe-config.ts` to use a different local equirectangular texture.

Each animation frame:

1. Convert a callout's geographic coordinates to a surface vector with `getCoords`.
2. Test whether the surface faces the camera. For the current spherical Earth centered at the origin, the perspective horizon is `surfaceNormal · cameraPosition > globeRadius` (with a 0.5 world-unit margin).
3. Project with `getScreenCoords(lat, lng, pinAltitude)` and offset into the page's globe container.
4. Move the screen pin and its single straight SVG segment. Cards follow the projected pin vertically, clamped to the viewport and separated from neighboring cards. They stay in reserved side areas, switching sides after the pin crosses the canvas midpoint by 28px. This buffer prevents rapid flipping near the center. Overcrowded rails spill to the opposite rail. Cards never animate across Earth when switching. Back-facing or off-canvas pins, cards, and connectors are hidden together.

The projection loop mutates only DOM positions and visibility. A selected event hidden by map filters retains its card without a pin/connector. It never changes event coordinates and makes **zero network requests**. Its animation frame, media listener, and resize observer are cleaned up on unmount. Cards near the horizon can disappear as Earth turns; pause rotation to read or interact with them.

Dragging, zooming, surface clicks, pin clicks, card title clicks, and hovering/focusing a card pause rotation so its contents stay readable. Pause/resume is explicit. Reduced-motion users start paused with inertial damping disabled. They can opt into rotation with Resume. Clicking a source opens the source URL in a new tab; it does not call FastAPI.

## Visual configuration

`src/lib/globe-config.ts` is the named configuration entry point. `src/app/globals.css` owns typography, card widths, colors of the page, and breakpoints.

| Setting | Default | Meaning / units |
| --- | --- | --- |
| `initialView` | 30, -110 | Initial latitude/longitude in degrees; positive longitude is east |
| `rotationSpeed` | 1 | OrbitControls speed; 1 is approximately one orbit/minute at 60fps |
| `atmosphereColor` | #87c8ef | Atmosphere color |
| `atmosphereAltitude` | 0.12 | Fraction of globe radius |
| `ambientLightIntensity` | 2.0 | Three.js ambient intensity, chosen for readable terrain |
| `sunlightIntensity` | 1.1 | Three.js directional intensity |
| `maxPixelRatio` | 2 | Maximum device-pixel ratio for rendering |
| `pointRadiusDegrees` | 0.38 | Angular radius of event markers |
| `pointAltitude` | 0.016 | Marker height as a fraction of globe radius |
| `surfaceFitWidth` | 0.43 | Maximum initial sphere radius / canvas width |
| `surfaceFitHeight` | 0.39 | Maximum initial sphere radius / canvas height |
| `minZoomAltitude` | 0.04 | Nearest camera altitude / globe radius; lower is closer |
| `sideSwitchBufferPx` | 28 | Midpoint hysteresis before a card switches rails |
| `cardEdgePaddingPx` | 80 | Vertical clearance for controls and hint |
| `zoomOutMultiplier` | 1.7 | Maximum camera distance / fitted camera distance |
| `maxCallouts` | 4 | Maximum card candidates including a selected surface point |
| `cardGapPx` | 16 | Minimum vertical spacing between desktop cards |
| `desktopBreakpointPx` | 1100 | Must match CSS media breakpoint |
| `colors` | by layer | Pin, connector, and card-accent colors |

The perspective fit uses the actual camera field of view: focal pixels = canvas height / (2 × tan(FOV/2)); distance = sqrt(radius² + (focalPixels × radius / desiredScreenRadius)²). Resizing recomputes the fit while preserving the current zoom-to-fit ratio within the zoom limits. Reset view restores the initial latitude/longitude and whole-Earth fit, and pauses rotation. None of these visual settings belong in the backend Event contract.

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

- Surface click: pauses rotation, normalizes longitude into [-180,180), and invokes `onSelect` with the exact location. A numbered pin/card displays that location. **No request or persistence occurs.**
- Existing pin/card click: pauses rotation and invokes `onSelect` with the event. This is the future place for fetching details or relationships. Use `encodeURIComponent(event.id)` because IDs include colons or other characters.
- Clear: invokes `onSelect(null)` and removes surface selection or event highlighting. No backend mutation.

Potential backend integration (not implemented): derive a bounding box from the selected location and a user-chosen radius, then call `/api/events?bbox=minLng,minLat,maxLng,maxLat`. The documented event API also supports `types`, `start` (inclusive), `end` (exclusive), `minSignificance`, `limit`, and `cursor`. A radius is not currently a documented backend parameter. Agree on antimeridian/pole handling, query radius, debounce/cancellation, and pagination with the API teammate first.

The link endpoint's response envelope must also be agreed before use; the fixture currently returns an array of EventLink objects. There are no location-search POSTs, analytics requests, save actions, or ingest calls in this UI.

## Manual verification

- Confirm readable cards and terrain on desktop and 390px mobile width.
- Pause/resume; drag until a marker disappears behind Earth; verify its card and connector disappear too.
- Click a surface point: verify the card's hemisphere labels, pin tracking, and clear action.
- Click a source and verify its URL; click a pin/card title and verify selected state.
- Rotate/zoom/resize and confirm cards track their pins vertically, switch sides, and never cover Earth or each other. Confirm each connector has one straight segment.
- Scroll in to country scale, select a surface coordinate, and use Reset view to return to the whole Earth.
- Inspect requests: only initial/retry `/api/events` pages, assets, and explicitly opened source links.
- Run `npm run lint` and `npm run build` from `apps/web`.

## Layer controls and deep links (#5)

`src/lib/layers.ts` defines the single `LayerState` object, keyed by all eight schema layer IDs. Each value is `{ enabled, mode, weightField }`. Disabled layers remain in this object. Earthquake, wildfire, and humanitarian start enabled; the other five start disabled. Every layer starts in `markers` mode. Every layer keeps `weightField: 'weight'` fixed in its config.

The compact Layers menu changes enabled state for all layers and rendering mode (`markers`, `heatmap`, `both`) for earthquake and wildfire. Other layers always use individual POI markers; legacy heatmap modes for those layers are canonicalized to markers. Heatmaps always use the backend-supplied event `weight`; there is no weight-field dropdown. The backend can calculate this value from significance, severity, or other factors. Opening the menu pauses rotation. Marker colors match each layer's heatmap color. Native react-globe.gl heatmaps replace the original deck.gl proposal; no Google Map is mounted.

`page.tsx` retains the one API Event array. `deriveVisuals` applies enabled-layer and time filters, then derives marker arrays and per-layer weighted heatmap datasets. Disabled layers get empty datasets; the renderer skips empty heatmaps to avoid unnecessary density computations. No `key` is changed on the globe, so toggles do not reset camera, zoom, or selection. No network request is triggered by a toggle or rendering-mode change.

Time uses `occurredAt >= start && occurredAt < end` in UTC. A visible time scrubber is not included in this task; the menu displays the URL time range and can clear it. Unknown layer IDs in URLs are ignored; explicit `layers=` means all off. Missing `layers` restores the weekend defaults. Invalid modes fall back to defaults. Legacy `weights` URL overrides are ignored and removed when the URL is canonicalized. Invalid/reversed/missing time ranges become all-time.

Deep-link format:

```text
?layers=earthquake,wildfire,humanitarian&t=all
?layers=earthquake&t=2026-10-03T00:00:00Z,2026-10-04T00:00:00Z
?layers=wildfire&t=all&modes=wildfire:both
```

`t` is either `all` or two timezone-qualified ISO timestamps separated by a comma. `modes` accepts optional comma-separated `layer:value` overrides to make rendering modes shareable too. Browser percent-encoding of commas/colons is normal. Unrelated URL parameters and the hash are preserved. The URL is the persisted source for the one LayerState; `useLayerFilters` subscribes to history changes. Initial values are canonicalized with `replaceState`; user changes use `pushState`, so Back/Forward and refresh restore filters without navigation or a backend round trip. Selection itself is not serialized.

A selected event is retained independently of filtered arrays. Turning off its layer, changing to heatmap-only mode, or excluding its timestamp retains its card with a “hidden by map filters” label while hiding its pin/connector. It stays available even if that hidden location is behind Earth. Clear removes this retained card. Surface selection is also independent of layer filters. Relationship cards are not implemented; future relation selection should follow this same retention rule, using unfiltered event IDs rather than visible markers.

### Backend implications

The browser still requests only `GET /api/events` on initial load/retry. `layers`, `modes`, and `t` are **frontend URL parameters**, not automatically forwarded to FastAPI. The `layers` values map to the backend's documented `types` parameter; an ISO `t` pair maps to `start` and `end` if server-side loading is implemented later. Modes are frontend rendering preferences. Event `weight` is part of the backend Event contract and supplies heatmap intensity. Do not make each layer its own fetch or discard selected events when adding pagination. The current frontend still loads one page; large datasets need a separate loading/performance plan.

### Checks

`npm test` runs the pure filter/URL tests using Node's test runner and the installed TypeScript compiler. Tests cover defaults, all-off state, invalid input, round-trip query preservation, exclusive end times, rendering modes, fixed event weight and legacy override removal, and source-array immutability. Browser checks cover card retention, history restoration, heatmap appearance, and no camera reset on toggles. Subsecond interaction was observed with the eight-fixture dataset; no large-feed performance guarantee has been established.

## Clustered heatmap test data

`data/fixtures/events.json` contains 48 events, including 40 synthetic `heatmap-demo:*` records. All new records use `fictional-demo`, `[Demo]` titles, null source links, and explicit fictional summaries. They share `2026-10-03T16:00:00Z`; existing fixtures are preserved. Fixture mode serves these through the same `/api/events` contract; API mode does not inject demo data.

| Continent / test area | Center (latitude, longitude) | Demo records |
| --- | --- | --- |
| North America / California | 38.55, -122.35 | 5 nearby fires, 1 earthquake, 1 humanitarian event |
| South America / Central Brazil | -12.5, -53 | 5 nearby fires, 1 earthquake, 1 humanitarian event |
| Europe / Central Spain | 40, -4.5 | 5 nearby fires |
| Africa / Zambia | -13.5, 28 | 5 nearby fires |
| Asia / Northern Thailand | 18.5, 99 | 5 nearby fires, 1 earthquake, 1 humanitarian event |
| Australia / Southeast | -33.7, 150.6 | 5 nearby fires |
| North America / Central Canada | 55, -105 | 1 isolated fire, weight 0.2 |
| South America / Central Argentina | -35, -64 | 1 isolated fire, weight 2 |
| Africa / Tanzania | -6, 35 | 1 isolated fire, weight 0.2 |
| Asia / Central India | 22, 79 | 1 isolated fire, weight 2 |

The 40 demo events are distributed across six continents: 30 clustered fires, 4 isolated fires, and 6 overlapping events. Each five-fire cluster uses weights 0.2, 0.5, 1, 1.5, and 2. California, Brazil, and Thailand include an exact shared coordinate across three layers to exercise overlap. Synthetic significance stays at 20 so test points do not outrank the original featured cards. The original eight fixtures are unchanged.

- [Wildfire intensity only](http://localhost:3000/?layers=wildfire&t=all&modes=wildfire:heatmap)
- [Earthquake/wildfire heatmaps with humanitarian markers](http://localhost:3000/?layers=earthquake,wildfire,humanitarian&t=all&modes=earthquake:heatmap,wildfire:heatmap)
- [Wildfire markers and heatmap](http://localhost:3000/?layers=wildfire&t=all&modes=wildfire:both)

Reset view faces North America; pause and zoom toward California. Rotate around Earth to compare the clusters in Brazil, Spain, Zambia, Thailand, and Australia. Isolated comparison points sit away from the clusters. Toggle layers off and back on to check overlap stability. These URLs configure layers, not camera position.

The installed three-globe renderer normalizes density to the maximum **within each layer's current dataset**. Nearby weights accumulate, but brightness is relative: it is not an absolute severity scale and cannot be compared directly between earthquake and wildfire. Changing the time filter can change that maximum. Mixed colors indicate overlapping layers, not a combined backend score.

`src/lib/globe-config.ts` exposes bandwidth (3 degrees), base altitude (0.002 globe radii), layer spacing (0.0005 radii), and maximum opacity (0.65). Heatmaps use flat separated shells rather than intersecting raised surfaces. `event-globe.tsx` disables heatmap depth writes while retaining depth testing against Earth, and sets stable draw order using `LAYER_IDS`. Colors blend in this fixed order; later layers can tint earlier layers. The material adjustment relies on the installed three-globe data-to-mesh binding `__threeObjHeatmap`; recheck this adapter when upgrading that dependency. Pin altitude remains above every heatmap shell.

Validation: 48 unique records pass structural Event schema validation; filter tests, lint, and production build pass. Browser checks exercised the overlap at country zoom and disabling/re-enabling layers. Large-feed performance is not established.


## Scroll / zoom performance

Native heatmap bandwidth also controls mesh resolution in the installed three-globe version. Increasing bandwidth from 1.2 to 3 degrees reduces each spherical mesh from approximately 1.10 million to 176 thousand triangles (about 84% fewer). This deliberately broadens smoothing; close fires still accumulate into a cluster but are less individually distinct. The display pixel ratio is capped at 1.5 rather than 2, reducing pixel workload on high-density displays.

Heatmap arrays and accessors retain stable identities across rotation and selection renders, avoiding unnecessary density updates. The color accessor applies depth-write and draw-order settings when three-globe updates a heatmap mesh; the frame loop no longer traverses the scene. Card layout is invalidated by camera controls, resizing, selection changes, and page scrolling. Measurements are batched before position writes, desktop cards move using transforms, and connector endpoints use the computed card positions. A stationary camera skips card layout work.

Earlier browser verification covered three simultaneous heatmaps (before density modes were restricted to earthquake and wildfire) and wildfire markers with heatmap, country zoom, and desktop card rails. Tests, lint, and build pass. The geometry reduction is calculated from the installed renderer; no numeric FPS improvement is claimed.


## Earth texture and POI rendering

The native smooth globe displays `public/textures/8k_earth_daymap.jpg`, supplied by the user as a 8192 × 4096 equirectangular image. The browser loads it from `/textures/8k_earth_daymap.jpg`; `GLOBE.textureUrl` selects the asset. No map service, API key, or new backend endpoint is needed. Texture provenance is recorded in `public/textures/README.md`.

The globe uses the library's native sphere, material, geographic orientation, and click picking. No custom mesh replacement, generated land mask, or asset-generation script is needed. Coordinate selection, card projection, markers, optional heatmaps, and scroll performance settings remain unchanged.

All enabled layers start in marker mode; the three weekend default enabled layers are unchanged. Only wildfire and earthquake support optional heatmaps because they represent spatial density. News, humanitarian, politics, conflict, terror, and finance remain individually selectable markers even if an old URL asks for heatmap mode. Disabled layers and time filtering still apply. Heatmaps use existing event weights, and clicks still feed the same local selection state.
