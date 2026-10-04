# Hypothesis Globe frontend

Next.js App Router + TypeScript. Run commands from `apps/web`. Use Node.js 20.9+.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The example configuration uses `DATA_MODE=api` and requires FastAPI on port 43124. For frontend-only development, set `DATA_MODE=fixture` explicitly. Backend-served fixtures remain sample data, not verified reports.

## Connect FastAPI

Start FastAPI from the repository root in a separate terminal:

```sh
cd apps/api
python3 -m venv .venv  # first setup only; Python 3.12+
source .venv/bin/activate
pip install -r requirements.txt  # first setup only
python -m uvicorn main:app --reload --host 127.0.0.1 --port 43124
```

Then set `apps/web/.env.local`:

```dotenv
DATA_MODE=api
API_BASE_URL=http://127.0.0.1:43124
```

Restart Next.js. The browser calls `/api/events` on port 3000; the Next.js server forwards it to FastAPI `/events` on port 43124. This avoids browser CORS configuration. Both variables are server-only; no `NEXT_PUBLIC_` prefix is needed. For a backend on another laptop, use that laptop's reachable address.

Supported GET paths:

- `/api/events` → `/events`
- `/api/events/{id}` → `/events/{id}`
- `/api/events/{id}/links` → `/events/{id}/links`
- `/api/health` → `/health`

API mode forwards query parameters and HTTP statuses. Requests time out after 10 seconds and return 502 when the backend cannot be reached. Fixture mode returns the complete fixed dataset; fixture filtering and pagination are not implemented. It does not contact FastAPI, and its health response reports `backendConnected: false`. API failures are displayed rather than silently switching to sample data.

`src/lib/api.ts` is the browser data loader. `src/app/api/[...path]/route.ts` controls fixture mode and forwarding. Shared fixtures stay in the root `data/fixtures` folder. Both fixture and FastAPI link routes return an EventLink array. Expanded cards load this endpoint on demand through `src/components/related-event-controls.tsx`, resolve source/target IDs against the loaded Event array, and expose the existing tree controls. Empty results and errors are shown explicitly; no synthetic links are generated.

## Checks

```sh
npm test
npm run lint
npm run build
```

The initial install reports five high-severity audit findings in the ESLint development dependency chain (`braces` → `micromatch` → `fast-glob` → Next's lint plugin/config). The suggested automated fix downgrades the Next lint configuration to 14.x, so it has not been applied. Recheck upstream fixes before deployment.

## Later deployment

Use a Next.js server runtime with `DATA_MODE=api` and a backend URL reachable from that runtime. The proxy does not support a static export. Build with the repository root available because fixtures are imported from outside `apps/web`.

## Interactive globe

Earth is the main view. Numbered pins follow geographic coordinates and connect to floating cards that can overlap the sphere. Cards start as compact headlines; click a headline to expand full details or collapse again. New cards find space around existing cards and may cover Earth. Drag a headline to reposition it; cards follow world-space anchors along curved rotation paths until hidden. Initial placement avoids existing cards; later paths may overlap without repositioning. If no space fits, a new card waits for a slot. Cards and connectors disappear when their pins rotate behind Earth and return when their pins face the camera again. Click a surface point to capture full-precision latitude/longitude, or a pin/card to select an event. Initial card placement uses a configurable distance, with straight connector thickness in `src/lib/globe-config.ts`. Country-scale zoom and Reset view are available alongside pause/resume and dragging. Only the Pause/Resume button changes rotation after startup; interactions preserve it. Reduced-motion users initially start paused.

See [globe visuals and backend integration](docs/globe-and-api.md) for all named visual settings, projection/visibility behavior, field mappings, API routes, selection hooks, current limitations, and verification steps.

The page fetches `GET /api/events` once on mount (and on error retry). Rotation and selections are local. Expanded cards call the relationship route; details and health routes are available through the proxy. The smooth Earth uses bundled Natural Earth vector countries with readable borders over the fluid ocean; see [vector globe settings and data](docs/vector-globe.md). The left icon rail groups 29 layer IDs into six categories, with Technology, Government & Politics, Finance, and Society enabled by default. At the default zoom the globe shows a land-clipped heatmap of the visible markers; zooming in past about twice the default size swaps it for pin markers. Markers default to significance ≥ 50 and are capped at 5,000; the right rail exposes the threshold. Layer/time filters are shareable via the URL; Back/Forward restores them. Selected event cards survive disabling their layers. The event loader follows pagination. Backend location search and a visible time scrubber are not implemented.


The animated ocean uses [Rare UI Fluid Orb](https://rareui.com/components/fluidorb), copyright © 2026 Swami Malode. Its source is vendored and adapted in `src/components/ui/fluid-orb.tsx`, with the [license retained](docs/licenses/rare-ui-LICENSE.txt). See [fluid ocean notes](docs/fluid-ocean.md).

Country colors are each country's average color in NASA Earth Observatory's [Blue Marble](https://visibleearth.nasa.gov/images/57752) image (public domain). The image is not bundled; `scripts/build-country-colors.py` regenerates `src/data/country-colors.json` from it.

Click countries to toggle multiple selections. The left sidebar holds layers, selected countries and their loaded POIs, individual remove buttons, and Clear all. Ocean clicks preserve selections. Countries, borders, and markers animate elevation over 600ms. Antarctica remains white. These interactions are local UI state and make no backend requests.
