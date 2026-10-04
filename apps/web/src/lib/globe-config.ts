/** Visual-only settings. None are sent to FastAPI. Units are explicit below. */
export const GLOBE = {
  continentEdgeShadeStrength: 0.72, // 0 = flat land; 1 = black at the circular limb (1.5× the earlier 0.48); also shades the water orb
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
  landCurvatureDegrees: 1.5, // tessellation spacing; lower means smoother, more triangles
  orbTopColor: "#86bad9", // light blue at the screen-space north/top of the orb (15% darker than #9edbff)
  orbColor: "#072d58", // deep blue at the bottom (15% darker than #083568); fluid motion blends between these
  orbRenderSize: 512, // fixed CSS/backbuffer basis, scaled to the projected globe
  orbMaxFps: 30,
  orbMaxPixelRatio: 1.25,
  initialView: { lat: 30, lng: -110 }, // degrees, east-positive longitude
  interactionPauseMs: 1000, // resume automatic rotation this long after globe/card input ends, unless paused
  relatedFocusMs: 1000, // camera travel time to a linked POI
  relatedFocusAltitude: 0.9, // minimum camera altitude for linked POIs; preserve wider current views
  relatedArcColor: "#ff3030", // floating relationship curve
  relatedArcClearance: 0.07, // both endpoints above even raised countries and markers
  relatedArcRise: 0.12, // extra height at the middle, in globe radii
  relatedArcRadius: 0.3, // red tube thickness in Three.js world units
  rotationSpeed: 1, // Three.js OrbitControls speed; 1 ≈ one revolution/minute at 60 fps
  atmosphereColor: "#333333", // one shade lighter than the #242424 page background
  atmosphereAltitude: 0.12, // outer halo thickness, fraction of globe radius
  atmosphereHaloStrength: 1, // 1 = exactly atmosphereColor at the limb, fading to the background
  atmosphereHaloFalloff: 2.2, // higher = halo fades faster into space
  atmosphereRimStrength: 0.35, // haze over land and water near the limb
  atmosphereRimFalloff: 3, // higher = haze hugs the edge more tightly
  ambientLightIntensity: 2.0,
  sunlightIntensity: 1.1,
  maxPixelRatio: 1.5, // limit GPU cost on high-density displays
  pinHeadRadiusDegrees: 0.315, // pin-shaped markers: sphere head, half the earlier 0.63° marker radius
  pinStemRadiusRatio: 0.25, // stem radius / head radius
  pinStemColor: "#9a9a9a", // neutral gray stems; heads keep their layer color
  heatmapBandwidthDegrees: 3, // smoothing radius; also bounds native heatmap mesh detail
  heatmapBaseAltitude: 0.002, // fraction of globe radius
  heatmapMaxOpacity: 0.75, // densest areas keep the land faintly visible
  heatmapOpacityGain: 1.6, // opacity per unit of normalized density, capped above
  heatmapLowColor: "#ffd27a", // sparse marker density
  heatmapHighColor: "#ff4d2e", // dense marker density
  markerZoomMagnification: 2.07, // markers replace the heatmap once Earth looks this many times larger than the default fit (was ≈1.03)
  surfaceFitWidth: 0.36, // projected sphere radius / canvas width
  surfaceFitHeight: 0.34, // projected sphere radius / canvas height
  zoomOutMultiplier: 1.7,
  minZoomAltitude: 0.04, // nearest camera height / globe radius (~255 km on Earth)
  pinToCardDistancePx: 80, // preferred horizontal gap when a card first appears
  connectorWidthPx: 4, // CSS pixels, constant as the globe zooms
  cardCenterExclusion: 0.5, // new cards avoid the central half of Earth's visible radius
  headlineMinScale: 0.88, // 88% at the limb, full size at the front
  headlineTiltDegrees: 12, // subtle X/Y perspective tilt; expanded/dragged cards stay flat
  headlinePerspectivePx: 900, // larger values flatten perspective
  cardEdgePaddingPx: 24, // responsive card width margin and retained-selection inset
  maxCallouts: 4, // highest-significance events; selected event takes priority
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
