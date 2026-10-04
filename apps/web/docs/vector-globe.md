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
| `landCurvatureDegrees` | 1.5° border interpolation spacing; lower costs more line points |
| `orbTopColor`, `orbColor` | Light top and dark bottom ocean colors |
| `reliefStrength` | Low-poly elevation shading on country caps; 0 turns it off. Flat ground keeps its color, slopes lighten or darken |
| `reliefHeightScale` | Slope exaggeration: full heightmap range in globe radii |
| `reliefFacetDegrees` | 0.75° land cap triangle size and elevation sampling spacing; each triangle is one relief facet. Lower is finer and costs more triangles |
| `reliefLightDirection` | Camera-space direction toward the relief light (upper left), fixed as the globe rotates |

### Elevation relief

`public/textures/earth-topology.png` is sampled once per cap vertex in the vertex shader (at a mip level matching `reliefFacetDegrees`). Central differences give an east/north slope that tilts the radial normal, which is passed with a `flat` varying, so each triangle is shaded as one facet. This is intentional: the coarse tessellation produces a low-poly look rather than fine terrain. Extruded side walls, borders, markers, heatmaps, and the ocean are unshaded by relief.

Country data, outlines, and color accessors have stable identities across selection/rotation renders. Land transitions are disabled. The existing zoom limits and bounded pixel ratios remain. At the former 1.5° cap tessellation there were about 20,680 cap triangles (excluding side faces); the 0.75° `reliefFacetDegrees` default should be roughly four times that (estimated, not measured). No measured FPS claim is made.

## Frontend/backend contract

The basemap is imported into the client bundle: no third-party runtime fetch (the heightmap is a same-origin static file), API key, or new backend route. Land, border, ocean, and heatmap clicks feed the existing local `{ kind: "location", location: { lat, lng } }` selection; event markers continue selecting the Event object. Longitude is east-positive in degrees. Country features do not become events and country names/IDs are not sent to FastAPI. The existing `/api/events` flow, layer/time filters, and selected-card retention stay unchanged.

The prior day-map PNG remains in `public/textures` for reference but is not loaded; only the elevation heightmap is fetched (same origin, static file). Historic texture-generation notes do not describe the active basemap.

## Zoom-out depth precision

`src/lib/globe-depth.ts` bounds the camera clipping range to the globe and atmosphere on controls changes. The library's near plane of 0.05 with a large sky far plane wasted depth precision at distant zooms, allowing the invisible sphere, land, and borders to compete for depth values. The near plane now follows 90% of the distance to the atmosphere's bounding sphere (minimum 0.001 × globe radius); the far plane includes the far-side atmosphere plus 0.1 × radius padding. Inside the atmosphere the small near-plane floor preserves close views. `camera.updateProjectionMatrix()` applies changes without remounting the globe or changing picking geometry.

Regression tests cover close/distant clip containment and separation of the globe and land even with a 16-bit depth buffer at representative zoom-out distances. The browser check covers maximum zoom-out, close zoom, reset, and ocean coordinate selection. This change affects rendering only; no backend contract or visual colors change. If future layers extend beyond the atmosphere, expand the bounding extent accordingly.

## Starry backdrop

`src/lib/star-field.ts` draws the real night sky behind the globe as one `THREE.Points` call. Stars come from the Yale Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991, CDS catalog V/50, https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50). `scripts/build-star-catalog.mjs` downloads `catalog.gz`, keeps J2000 right ascension, declination, V magnitude, and B−V color (0.6 where B−V is missing) for the 9,096 entries with a position and magnitude, sorts them brightest first, and writes `src/data/bright-stars.json` (≈207 KB). Downloaded 2026-10-04; source SHA-256 `3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed` (also stored in the JSON). Rebuild from `apps/web` with `node scripts/build-star-catalog.mjs`.

Placement: the celestial poles lie on the globe's axis, and the field is turned by Greenwich mean sidereal time (`src/lib/sky-math.ts`, IAU 1982 formula, re-applied every `skyRealignMs`). Each star therefore sits above the place where it is overhead right now. Positions are J2000 without precession (≈0.3° by 2026) or proper motion, which is invisible at this scale. Because the camera orbits a fixed scene, stars turn with the Earth during idle rotation and manual drags; the view is the sky as seen from near Earth, not mirrored.

Rendering: stars are directions; only the camera rotation applies and depth is pinned to the far plane, so the globe's tight clip planes are unchanged and the ocean depth sphere hides stars behind the Earth. Size and opacity scale with magnitude; color comes from B−V using Mitchell Charity's blackbody table, blended toward white. Stars never intercept hover or clicks. No twinkle or other animation.

| Setting | Meaning |
| --- | --- |
| `skyBrightness` | 0.85 peak star opacity |
| `skyMagnitudeCutoff` | 5.5: dimmest magnitude drawn (≈2,900 stars); raise toward 6.5 for more |
| `skyStarMinSizePx`, `skyStarMaxSizePx` | 1.6 and 4.2 CSS pixels for the dimmest and brightest stars |
| `skyColorSaturation` | 0.6; 0 is white, 1 is full B−V tint |
| `skyRealignMs` | 60000 ms between sidereal-time updates |
