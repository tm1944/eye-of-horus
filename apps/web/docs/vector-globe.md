# Vector land and country borders

## Local map data

`src/data/countries.geojson.json` bundles 177 Natural Earth Admin 0 country features at 1:110 million scale. Geometry is copied unchanged; only `ADM0_A3` (as feature ID) and `ADMIN` (as name) are retained from source properties. Polygon and MultiPolygon rings, holes, Antarctica, and date-line splits remain intact. This static visual basemap is separate from the single in-memory Event array.

Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson

Dataset description: https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/

License: public domain, https://www.naturalearthdata.com/about/

Downloaded 2026-10-03. Original download SHA-256: `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`.

The geometry is generalized for a responsive global/country view. Small islands and microstates may be omitted, and zooming does not add detail. Borders follow the dataset's cartographic representation, not a backend jurisdiction lookup. Arctic sea ice is not land and is not rendered as a continent; Antarctica is included.

## Rendering and settings

`event-globe.tsx` draws opaque native globe polygons with muted sage land. Separate one-pixel line paths draw country boundaries and coastlines. `country-borders.ts` splits outlines around artificial polar/date-line closure edges so Antarctica does not acquire a fake border across the pole. Fill geometry remains unchanged. Shared boundaries can occur in both adjoining country rings.

The native globe sphere uses a colorless, depth-writing material and renders first (`renderOrder = -10`). It hides far-side land, outlines, and event markers while preserving native ocean picking. No duplicate depth shell or image texture is required. FluidOrb remains behind the transparent WebGL canvas and provides the animated ocean.

Edit `src/lib/globe-config.ts`:

| Setting | Meaning |
| --- | --- |
| `landColor` | Opaque continent/country fill |
| `countryBorderColor` | Country border and coastline color |
| `landAltitude` | 0.001 × globe radius above the native sphere |
| `borderAltitude` | 0.0018 × radius, above land but below heatmaps |
| `landCurvatureDegrees` | 1.5° tessellation/interpolation spacing; lower costs more triangles |
| `orbTopColor`, `orbColor` | Light top and dark bottom ocean colors |

Country data, outlines, and color accessors have stable identities across selection/rotation renders. Land transitions are disabled. The existing zoom limits and bounded pixel ratios remain. The current tessellation produces about 20,680 cap triangles (excluding side faces); no measured FPS claim is made.

## Frontend/backend contract

The basemap is imported into the client bundle: no third-party runtime fetch, API key, or new backend route. Land, border, ocean, and heatmap clicks feed the existing local `{ kind: "location", location: { lat, lng } }` selection; event markers continue selecting the Event object. Longitude is east-positive in degrees. Country features do not become events and country names/IDs are not sent to FastAPI. The existing `/api/events` flow, layer/time filters, and selected-card retention stay unchanged.

The prior PNG remains in `public/textures` for reference but is not loaded by the globe. Historic texture-generation notes do not describe the active basemap.

## Zoom-out depth precision

`src/lib/globe-depth.ts` bounds the camera clipping range to the globe and atmosphere on controls changes. The library's near plane of 0.05 with a large sky far plane wasted depth precision at distant zooms, allowing the invisible sphere, land, and borders to compete for depth values. The near plane now follows 90% of the distance to the atmosphere's bounding sphere (minimum 0.001 × globe radius); the far plane includes the far-side atmosphere plus 0.1 × radius padding. Inside the atmosphere the small near-plane floor preserves close views. `camera.updateProjectionMatrix()` applies changes without remounting the globe or changing picking geometry.

Regression tests cover close/distant clip containment and separation of the globe and land even with a 16-bit depth buffer at representative zoom-out distances. The browser check covers maximum zoom-out, close zoom, reset, and ocean coordinate selection. This change affects rendering only; no backend contract or visual colors change. If future layers extend beyond the atmosphere, expand the bounding extent accordingly.
