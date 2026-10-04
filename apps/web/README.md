# Hypothesis Globe frontend

Next.js App Router + TypeScript. Run commands from `apps/web`. Use Node.js 20.9+.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Default `DATA_MODE=fixture` loads the repository's shared JSON files. These three examples are development data, not verified reports. No Maps key or backend is required for this starter screen.

## Connect FastAPI

Have the API teammate start FastAPI on port 43124, then update `.env.local`:

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

Earth is the main view. Numbered pins follow geographic coordinates and connect to readable cards outside the sphere. Back-facing callouts are hidden; on mobile, cards sit below Earth. Click a surface point to capture full-precision latitude/longitude, or a pin/card to select an event. Cards follow their pins vertically and switch safe sides with straight connectors. Country-scale zoom and Reset view are available alongside pause/resume and dragging. Rotation honors reduced-motion preferences.

See [globe visuals and backend integration](docs/globe-and-api.md) for all named visual settings, projection/visibility behavior, field mappings, API routes, selection hooks, current limitations, and verification steps.

The page follows every `/api/events` page on mount and on error retry. A changed dataset restarts once; partial or failed results are not displayed as complete. API-served fixtures retain Sample labels. Rotation and selections are local. Details, relationship, and health routes remain available through the proxy but are not currently called. Location search, heatmaps, and relation cards remain unimplemented.

Ranked endpoints `/api/feed` and `/api/feed/pins` now forward to FastAPI in API mode. They accept request selections without saving preferences. See [the API contract](../api/README.md#ranked-feed-and-globe-pins). The current globe continues to load the full `/api/events` dataset; these endpoints are ready for a ranked-feed UI.
