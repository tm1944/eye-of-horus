# Globe visuals and backend integration

## Screen and readability

Earth occupies the center of the page. There is no dashboard header, event list, inspector, or permanent connection banner. A compact rotation control and interaction hint remain. Data errors show a retry notice; sample cards are explicitly labeled **Sample**.

Desktop (1100px and wider): the center canvas reserves 320px on each side. Cards are 278px wide and sit 24px from the outside edges. The camera fits the entire sphere inside its canvas; zoom-in stops at that fit, so Earth never moves behind cards. Each rail holds at most two cards with a 16px gap. Layout is at least 800px tall so the cards remain readable on shorter windows; the page may scroll vertically.

Below 1100px, the canvas takes the full width and cards move into a grid below it. Below 580px, that grid becomes one column. No card is placed over Earth. Connectors are behind the cards and ignore pointer events.

Card title: 17px, coordinates: 14px, body: 13px, UTC time: 12px. Bright text sits on opaque dark panels. N/S and E/W clarify coordinate signs. Coordinates are rounded to four decimals **only for display**; state retains the original numbers. Summaries longer than 60px scroll inside the card, without hiding the source or coordinates. Titles wrap. Source links accept HTTP/HTTPS only. Null summaries and source URLs have explicit fallbacks.

Numbered screen-space pins correspond to numbered cards. Nearby numbered badges are separated by at least 34px; a small anchor ring and short leader preserve each exact projected coordinate. All loaded events also retain globe markers. Up to four events are eligible for cards, ranked by `significance` descending with ID as the tie-breaker. The selected event takes priority; a selected surface point consumes one slot. This is a visual cap, not an API filter. Numbers identify the current displayed candidate set, not durable event IDs. The backend identity is always `event.id`.

## Rotation, anchoring, and visibility

`src/components/event-globe.tsx` loads only in the browser. The texture is local; its source/license are in `public/textures/README.md` and `THREE-GLOBE-LICENSE.txt`.

Each animation frame:

1. Convert a callout's geographic coordinates to a surface vector with `getCoords`.
2. Test whether the surface faces the camera. For the current spherical Earth centered at the origin, the perspective horizon is `surfaceNormal · cameraPosition > globeRadius` (with a 0.5 world-unit margin).
3. Project with `getScreenCoords(lat, lng, pinAltitude)` and offset into the page's globe container.
4. Move the screen pin and SVG connector. Cards are sorted vertically within the nearest side rail; overcrowded rails spill to the opposite rail. Back-facing or off-canvas pins, cards, and connectors are hidden together.

The projection loop mutates only DOM positions and visibility. It never changes event coordinates and makes **zero network requests**. Its animation frame, media listener, and resize observer are cleaned up on unmount. Cards near the horizon can disappear as Earth turns; pause rotation to read or interact with them.

Dragging, zooming, surface clicks, pin clicks, card title clicks, and hovering/focusing a card pause rotation so its contents stay readable. Pause/resume is explicit. Reduced-motion users start paused with inertial damping disabled. They can opt into rotation with Resume. Clicking a source opens the source URL in a new tab; it does not call FastAPI.

## Visual configuration

`src/lib/globe-config.ts` is the named configuration entry point. `src/app/globals.css` owns typography, card widths, colors of the page, and breakpoints.

| Setting | Default | Meaning / units |
| --- | --- | --- |
| `initialView` | 30, -110 | Initial latitude/longitude in degrees; positive longitude is east |
| `rotationSpeed` | 0.28 | OrbitControls speed; 1 is approximately one orbit/minute at 60fps |
| `atmosphereColor` | #87c8ef | Atmosphere color |
| `atmosphereAltitude` | 0.12 | Fraction of globe radius |
| `ambientLightIntensity` | 2.0 | Three.js ambient intensity, chosen for readable terrain |
| `sunlightIntensity` | 1.1 | Three.js directional intensity |
| `maxPixelRatio` | 2 | Maximum device-pixel ratio for rendering |
| `pointRadiusDegrees` | 0.38 | Angular radius of event markers |
| `pointAltitude` | 0.016 | Marker height as a fraction of globe radius |
| `surfaceFitWidth` | 0.43 | Maximum initial sphere radius / canvas width |
| `surfaceFitHeight` | 0.39 | Maximum initial sphere radius / canvas height |
| `zoomOutMultiplier` | 1.7 | Maximum camera distance / fitted camera distance |
| `maxCallouts` | 4 | Maximum card candidates including a selected surface point |
| `cardGapPx` | 16 | Minimum vertical spacing between desktop cards |
| `desktopBreakpointPx` | 1100 | Must match CSS media breakpoint |
| `colors` | by layer | Pin, connector, and card-accent colors |

The perspective fit uses the actual camera field of view: focal pixels = canvas height / (2 × tan(FOV/2)); distance = sqrt(radius² + (focalPixels × radius / desiredScreenRadius)²). Resizing recomputes the fit. None of these visual settings belong in the backend Event contract.

## Current frontend/backend boundary

```
browser → GET /api/events → Next.js GET proxy → FastAPI GET /events
                        ↘ shared JSON in DATA_MODE=fixture
```

Configuration in `apps/web/.env.local` (restart Next.js after changes):

```dotenv
DATA_MODE=api
API_BASE_URL=http://127.0.0.1:8000
```

Default mode is `fixture`. These variables stay server-side. Never put Snowflake or Gemini credentials in browser configuration. For deployment, `API_BASE_URL` must be reachable from the Next.js server. The browser keeps using relative `/api` URLs.

| Browser endpoint | FastAPI endpoint | Current caller / behavior |
| --- | --- | --- |
| `GET /api/events` | `GET /events` | `getEvents()` in `src/lib/api.ts`, once on page mount and on error retry |
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

The frontend currently loads **one page**, without filters or cursor traversal. `nextCursor`, `generatedAt`, and `sourceStatus` are retained in the response type but not shown or acted upon by this minimal view. Confirm pagination and geographic-search requirements before implementing those features. Rotation must never initiate per-frame requests.

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
| `updatedAt`, `altM`, `geoSource`, `weight`, `entities`, `rawRef` | Retained in event objects; no current visual behavior or request triggered |

Sensor depth (`altM`) is not used as visual pin altitude. Globe pin height is cosmetic and must not change stored event altitude. `weight` is reserved for later heatmaps.

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
- Rotate/zoom/resize and confirm cards never cover Earth or each other.
- Inspect requests: only initial/retry `/api/events`, assets, and explicitly opened source links.
- Run `npm run lint` and `npm run build` from `apps/web`.
