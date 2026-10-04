# Transparent continents over Fluid Orb

The active globe uses [vector continents and country borders](vector-globe.md) over FluidOrb. PNG-based land extraction has been replaced; the ocean shader and its bounded rendering settings remain.

## Component provenance

[Fluid Orb by Rare UI](https://rareui.com/components/fluidorb), copyright (c) 2026 Swami Malode. Source: https://github.com/swamimalode07/rare-ui/blob/main/components/ui/fluid-orb.tsx

The component corresponding to `npx shadcn@latest add swamimalode07/rare-ui/fluid-orb` is installed by vendoring its inspected source. The shadcn CLI was not run: the standalone component is adapted to the project's existing CSS without adding a Tailwind/shadcn scaffold or dependencies. The original shader and drift behavior are retained, with defined smoothstep edge math. Source credit and the full MIT + Commons Clause + Attribution license are retained in `licenses/rare-ui-LICENSE.txt`; the frontend README links visibly to Rare UI.

## Rendering and performance

`event-globe.tsx` places a pointer-inert FluidOrb beneath the native transparent globe canvas. Camera movement updates the orb's CSS scale from the projected sphere diameter: `2 * focalPixels * radius / sqrt(cameraDistance² - radius²)`. Pan remains disabled, so the projected center stays at the center of the canvas. No React state updates or canvas reallocations occur during this scaling.

The native sphere writes depth without color and renders before vector land and markers, preventing far-side geometry from showing through oceans. Native ocean picking and polygon/border clicks feed the same coordinate selection. The former duplicate depth shell is removed.

`GLOBE` exposes `orbTopColor` (`#9edbff`, light blue) and `orbColor` (`#083568`, deep blue at the bottom), `orbRenderSize` (512), `orbMaxFps` (30), and `orbMaxPixelRatio` (1.25). The gradient stays vertical on screen, with fluid distortion confined between its pinned top and bottom colors. Its CSS fallback uses the same gradient. The orb renders into a fixed backbuffer of at most 640 × 640, then scales visually with the globe. It suspends in hidden tabs and holds a still frame with reduced motion, including changes to that preference. If its WebGL context fails, the circular blue CSS background remains. It uses a second small WebGL canvas; no measured FPS improvement is claimed. Interaction pauses globe rotation; ambient ocean motion continues unless reduced motion is enabled.

Event coordinates, fixtures, thresholds, layers, selection, and backend endpoints are unchanged. The orb has no network or API dependency after its source is installed.

## Original extraction prompt (built-in imagegen)

Historical only: the previous illustrated texture received a [polar repair](polar-texture-repair.md). Those assets have since been removed and replaced by the user-provided day-map PNG.

Edit target: attached flat illustrated world map. Make a production PNG globe texture with a REAL transparent alpha channel. Remove ALL blue water (oceans, seas and lakes) to fully transparent pixels. Preserve every landmass, coastline, island, white/gray polar ice, green/tan terrain, colors, geographic placement, entire world extent and original approximately 1.78:1 aspect ratio exactly as source. No rearrangement, crop, added objects, labels, shadows, outlines or checkerboard background. This is a precise water-removal cutout, not a redesign. Keep the source map's flat projection and orientation. Output transparent PNG at highest available resolution.

Two candidates were generated; the first was selected after visual inspection. Source pixels were not edited with a local imaging script. The generated result approximates the preservation requested in the prompt.
