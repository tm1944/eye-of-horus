/** Visual-only settings. None are sent to FastAPI. Units are explicit below. */
export const GLOBE = {
  continentEdgeShadeStrength: 0, // edge darkening for land and water: 0 = none (flat); 1 = black at the circular limb
  hoverCountryColor: "#e6b77e", // hover changes color only, never altitude
  selectedCountryColor: "#ed963e",
  selectedCountrySideColor: "#9b501f", // darker orange extrusion walls
  countryAnimationMs: 600, // land and border tween; fixed-size markers follow the surface
  selectedCountryAltitude: 0.025, // raised country surface, fraction of globe radius
  landColor: "#9ebe8f", // fallback for countries missing from data/country-colors.json
  landLightnessBoost: 0.12, // added to each satellite country color's HSL lightness (≈2 shades)
  borderDarkness: 0.5, // borders = average of the two neighbors' land colors, this much darker
  landAltitude: 0.001, // fraction of globe radius, below heatmaps and markers
  borderAltitude: 0.0018, // outlines above land, below heatmaps; prevents line/surface flicker
  landCurvatureDegrees: 1.5, // border line interpolation spacing; land caps use reliefFacetDegrees
  reliefStrength: 1.4, // low-poly elevation shading on country caps: 0 = flat; flat ground always keeps its color
  reliefHeightScale: 0.03, // slope exaggeration: full heightmap range (sea level → highest peak) in globe radii
  reliefFacetDegrees: 0.5, // land cap triangle size and elevation sampling spacing: each triangle is one shaded facet; lower = finer, more triangles
  reliefLightDirection: [-0.5, 0.7, 0.5] as const, // camera space, toward the light: upper left, like the orb's bright top
  reliefSlopeSmoothing: 2, // slope sampling distance in facets; higher smooths rugged ranges (Andes, Himalaya)
  reliefShadeLimit: 0.3, // soft cap on relief lightening/darkening (±30%) so steep mountains stay gentle
  orbTopColor: "#86bad9", // light blue at the screen-space north/top of the orb (15% darker than #9edbff)
  orbColor: "#072d58", // deep blue at the bottom (15% darker than #083568); fluid motion blends between these
  orbRenderSize: 512, // fixed CSS/backbuffer basis, scaled to the projected globe
  orbMaxFps: 30,
  orbMaxPixelRatio: 1.25,
  initialView: { lat: 30, lng: -110 }, // degrees, east-positive longitude
  idleResumeMs: 10000, // automatic rotation restarts this long after the last globe/card interaction (never while a card holds the view)
  spinUpMs: 4000, // rotation eases from still to rotationSpeed over this long…
  viewReturnMs: 4000, // …while tilt (initialView.lat) and zoom (default fit) ease back over this long
  maxTiltDegrees: 45, // the globe stays upright: it tilts toward/away from the viewer at most this far, never sideways
  relatedFocusMs: 1000, // camera travel time to a linked POI
  relatedFocusAltitude: 0.9, // minimum camera altitude for linked POIs; preserve wider current views
  relatedArcColor: "#ff3030", // floating relationship curve
  relatedArcClearance: 0.07, // both endpoints above even raised countries and markers
  relatedArcRise: 0.12, // extra height at the middle, in globe radii
  relatedArcRadius: 0.3, // red tube thickness in Three.js world units, at full confidence
  relatedArcMinRadiusScale: 0.5, // a confidence-0 link draws at half thickness
  relatedArcGrowMs: 650, // flight from the origin pin out to a linked pin
  relatedArcStaggerMs: 70, // delay between successive arcs fanning out from one pin
  relatedArcRetractMs: 280, // arcs pull back into their origin when no longer shown
  relatedArcHitScale: 5, // invisible picking tube is this many times thicker than the drawn arc
  relatedArcHaloScale: 3.2, // hover glow tube radius relative to the drawn arc
  relatedArcHoverMs: 140, // glow fade in/out
  relatedArcHoverReleaseMs: 250, // a hovered pin's arcs linger this long so the pointer can reach them
  rotationSpeed: 0.5, // Three.js OrbitControls speed; 1 ≈ one revolution/minute at 60 fps, so 0.5 ≈ one per two minutes
  atmosphereColor: "#333333", // one shade lighter than the #242424 page background
  atmosphereAltitude: 0.12, // outer halo thickness, fraction of globe radius
  atmosphereHaloStrength: 1, // 1 = exactly atmosphereColor at the limb, fading to the background
  atmosphereHaloFalloff: 2.2, // higher = halo fades faster into space
  atmosphereRimStrength: 0, // haze over land and water near the limb; 0 = off (not rendered)
  atmosphereRimFalloff: 3, // higher = haze hugs the edge more tightly
  ambientLightIntensity: 2.0,
  sunlightIntensity: 1.1,
  maxPixelRatio: 1.5, // limit GPU cost on high-density displays
  // Backdrop: the real night sky (Yale Bright Star Catalogue), aligned to the current sidereal time.
  skyBrightness: 0.85, // peak star opacity; subtle against the #242424 page
  skyMagnitudeCutoff: 5.5, // dimmest visual magnitude drawn (≈2,900 stars; the catalog reaches ≈6.5)
  skyStarMinSizePx: 1.6, // CSS pixels for the dimmest stars…
  skyStarMaxSizePx: 4.2, // …and the brightest (Sirius)
  skyColorSaturation: 0.6, // 0 = white; 1 = full B−V star color
  skyRealignMs: 60000, // re-apply sidereal time this often (the sky turns 0.25° per minute)
  pinHeadRadiusDegrees: 0.315, // pin-shaped markers: sphere head, half the earlier 0.63° marker radius
  pinStemRadiusRatio: 0.25, // stem radius / head radius
  pinStemColor: "#9a9a9a", // neutral gray stems; heads keep their layer color
  heatmapBandwidthDegrees: 1.5, // smoothing radius = heat spot size (half the earlier 3°); also sets heatmap mesh detail
  heatmapBaseAltitude: 0.002, // fraction of globe radius
  heatmapMaxOpacity: 0.75, // densest areas keep the land faintly visible
  heatmapOpacityGain: 1.6, // opacity per unit of normalized density, capped above
  markerZoomMagnification: 2.07, // markers replace the heatmap once Earth looks this many times larger than the default fit (was ≈1.03)
  surfaceFitWidth: 0.36, // projected sphere radius / canvas width
  surfaceFitHeight: 0.34, // projected sphere radius / canvas height
  zoomOutMultiplier: 1.7,
  minZoomAltitude: 0.04, // nearest camera height / globe radius (~255 km on Earth)
  pinToCardDistancePx: 80, // preferred horizontal gap when a card first appears
  connectorWidthPx: 4, // CSS pixels, constant as the globe zooms
  cardCenterExclusion: 0.5, // new cards avoid the central half of Earth's visible radius
  cardEdgePaddingPx: 24, // responsive card width margin and retained-selection inset
  // Headline cards ride a ring per pin: its latitude circle, tilted so the side facing the
  // viewer is raised. Cards meet their pins at Earth's edges and arch over them at the centre.
  cardRingTiltDegrees: 15, // how far the ring rises (or dips) at the centre
  cardRingLift: 0.04, // ring height above the surface, in globe radii
  // Pins at or north of the default viewing latitude (initialView.lat, 30°N) carry their
  // card above; pins south of it hang their card below.
  cardRingGapPx: 10, // space between a card and its anchor, and between cards
  cardEaseMs: 140, // cards glide toward their ring position (time constant)
  headlineCardWidthPx: 240, // collapsed headline cards; the open details card stays 278
  maxCallouts: 4, // highest-significance events; selected event takes priority
  headlineCount: 12, // Headlines tab: the top N events overall (map filters do not apply), each with a floating card
  headlinePerCategory: 3, // …taking at most this many from any one sidebar category
  briefingSlideMs: 130, // easing time constant as the globe slides beside the briefing or rail, or between tabs (~0.4 s; frame-rate independent)
  tourStepMs: 8000, // Headlines tour: each story is shown this long before flying to the next (north to south)
  pinSelectedScale: 1.5, // Explore: the selected pin grows and gains a white halo
  headlinePinScale: 1.5, // Headlines: every pin uses the large size (the selection keeps its halo)
  pinPingPeriodMs: 2400, // Headlines: a soft ring of light expands from each pin head this often…
  pinPingMaxScale: 3.4, // …to this many head radii…
  pinPingOpacity: 0.45, // …starting at this opacity and fading out; pins are staggered
  pinDimColor: "#6c6c6c", // with a selection, unrelated pins turn gray (but stay clickable)
  pinDimStemColor: "#555555",
  clusterRadiusPx: 28, // explore view: pins closer than this on screen merge into a numbered cluster
  clusterOpenMax: 10, // larger clusters zoom in to spread out instead of listing their events
  clusterSpreadFactor: 1.5, // zoom until a cluster spans ≈ radius × √count × this many pixels
  clusterZoomMs: 900,
  spotlightEveryMs: 30000, // explore view: while rotating, one headline appears this often…
  spotlightShowMs: 7000, // …for this long,
  spotlightMemory: 12, // …and is not repeated until this many others have been shown
  // One hue family per sidebar category; subcategories are shades of it.
  colors: {
    earthquake: "#ffc38b", wildfire: "#ff9f6b", cyclone: "#ffd9a8", flood: "#f5b26e", volcano: "#ff8a4c", drought: "#e8c08f", environment: "#ffcf96", // hazards
    conflict: "#fba6bf", terror: "#ff8fa8", crime: "#f7bccd", protest: "#ffa3c4", strategic_development: "#ffc1d4", // security
    politics: "#e6d09c", world: "#f0dc9e", news: "#d9c48a", media: "#f5e6b8", // politics & world
    finance: "#94e5c9", business: "#7fd9b8", technology: "#80e5ef", science: "#a6f0e0", // economy & tech
    humanitarian: "#d3b9ff", famine: "#c0a3f5", health: "#e0cfff", education: "#b9a8ec", // humanitarian & health
    culture: "#a0d9ff", entertainment: "#8ccaff", sports: "#b7e3ff", fashion: "#9cc2f5", travel: "#c4e8ff", food: "#86bdf0", // culture & lifestyle
    selected: "#ceffe5",
  } as Record<string, string>,
};
// Pin geometry in fractions of globe radius: the stem is twice the head's diameter.
const pinHead = GLOBE.pinHeadRadiusDegrees * Math.PI / 180;
export const PIN = { headRadius: pinHead, stemRadius: pinHead * GLOBE.pinStemRadiusRatio, stemLength: 4 * pinHead, height: 6 * pinHead };
export const eventColor = (layer: string) => GLOBE.colors[layer] ?? "#d3b9ff";
