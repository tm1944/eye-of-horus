# Hypothesis Globe frontend

Next.js App Router + TypeScript. Run commands from `apps/web`. Use Node.js 20.9+.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Default `DATA_MODE=fixture` loads the repository's shared JSON files. These three examples are development data, not verified reports. No Maps key or backend is required for this starter screen.

## Connect FastAPI

Have the API teammate start FastAPI on port 8000, then update `.env.local`:

```dotenv
DATA_MODE=api
API_BASE_URL=http://127.0.0.1:8000
```

Restart Next.js. The browser calls `/api/events` on port 3000; the Next.js server forwards it to FastAPI `/events` on port 8000. This avoids browser CORS configuration. Both variables are server-only; no `NEXT_PUBLIC_` prefix is needed. For a backend on another laptop, use that laptop's reachable address.

Supported GET paths:

- `/api/events` → `/events`
- `/api/events/{id}` → `/events/{id}`
- `/api/events/{id}/links` → `/events/{id}/links`
- `/api/health` → `/health`

API mode forwards query parameters and HTTP statuses. Requests time out after 10 seconds and return 502 when the backend cannot be reached. Fixture mode returns the complete fixed dataset; fixture filtering and pagination are not implemented. It does not contact FastAPI, and its health response reports `backendConnected: false`. API failures are displayed rather than silently switching to sample data.

`src/lib/api.ts` is the browser data loader. `src/app/api/[...path]/route.ts` controls fixture mode and forwarding. Shared fixtures stay in the root `data/fixtures` folder. Fixture links return an array; confirm the backend link response envelope before building relationship cards.

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

Earth is the main view. Numbered pins follow geographic coordinates and connect to floating cards that can overlap the sphere. New cards find space around existing cards and may cover Earth. Visible cards follow their rotating pins with fixed offsets until hidden. Initial placement avoids existing cards; later paths may overlap without repositioning. If no space fits, a new card waits for a slot. Cards and connectors disappear when their pins rotate behind Earth and return when their pins face the camera again. Click a surface point to capture full-precision latitude/longitude, or a pin/card to select an event. Initial card placement uses a configurable distance, with straight connector thickness in `src/lib/globe-config.ts`. Country-scale zoom and Reset view are available alongside pause/resume and dragging. Only the Pause/Resume button changes rotation after startup; interactions preserve it. Reduced-motion users initially start paused.

See [globe visuals and backend integration](docs/globe-and-api.md) for all named visual settings, projection/visibility behavior, field mappings, API routes, selection hooks, current limitations, and verification steps.

The page fetches `GET /api/events` once on mount (and on error retry). Rotation and selections are local. Details, relationship, and health routes remain available through the proxy but are not currently called. The smooth Earth uses bundled Natural Earth vector countries with readable borders over the fluid ocean; see [vector globe settings and data](docs/vector-globe.md). The Layers menu supports nine layer IDs, with Technology, Government & Politics, Finance, and Society enabled by default. Earthquake and wildfire are off by default; enabling them supports heat-plus-marker mode with one focused heatmap at a time. Markers default to significance ≥ 50 and are capped at 5,000; the panel exposes the threshold and heatmap focus. Layer/time filters are shareable via the URL; Back/Forward restores them. Selected event cards survive disabling their layers. Backend location search, pagination, a visible time scrubber, and relation cards are not implemented.


The animated ocean uses [Rare UI Fluid Orb](https://rareui.com/components/fluidorb), copyright © 2026 Swami Malode. Its source is vendored and adapted in `src/components/ui/fluid-orb.tsx`, with the [license retained](docs/licenses/rare-ui-LICENSE.txt). See [fluid ocean notes](docs/fluid-ocean.md).
