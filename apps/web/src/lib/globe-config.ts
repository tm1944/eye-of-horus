/** Visual-only settings. None are sent to FastAPI. Units are explicit below. */
export const GLOBE = {
  continentEdgeShadeStrength: 0.48, // 0 = flat land; 1 = black at the circular limb
  antarcticaColor: "#ffffff",
  hoverCountryColor: "#e6b77e", // hover changes color only, never altitude
  selectedCountryColor: "#ed963e",
  selectedCountrySideColor: "#9b501f", // darker orange extrusion walls
  countryAnimationMs: 600, // land and border tween; fixed-size markers follow the surface
  selectedCountryAltitude: 0.025, // raised country surface, fraction of globe radius
  landColor: "#9ebe8f", // dark forest green; opaque vector country surfaces
  countryBorderColor: "#759763", // country outlines/coastlines; WebGL one-pixel lines
  landAltitude: 0.001, // fraction of globe radius, below heatmaps and markers
  borderAltitude: 0.0018, // outlines above land, below heatmaps; prevents line/surface flicker
  landCurvatureDegrees: 1.5, // tessellation spacing; lower means smoother, more triangles
  orbTopColor: "#9edbff", // light blue at the screen-space north/top of the orb
  orbColor: "#083568", // deep blue at the bottom; fluid motion blends between these
  orbRenderSize: 512, // fixed CSS/backbuffer basis, scaled to the projected globe
  orbMaxFps: 30,
  orbMaxPixelRatio: 1.25,
  initialView: { lat: 30, lng: -110 }, // degrees, east-positive longitude
  interactionPauseMs: 3000, // resume automatic rotation this long after globe/card input ends
  relatedFocusMs: 1000, // camera travel time to a linked POI
  relatedFocusAltitude: 0.9, // minimum camera altitude for linked POIs; preserve wider current views
  relatedArcColor: "#ff3030", // floating relationship curve
  relatedArcClearance: 0.07, // both endpoints above even raised countries and markers
  relatedArcRise: 0.12, // extra height at the middle, in globe radii
  relatedArcRadius: 0.3, // red tube thickness in Three.js world units
  rotationSpeed: 1, // Three.js OrbitControls speed; 1 ≈ one revolution/minute at 60 fps
  atmosphereColor: "#87c8ef",
  atmosphereAltitude: 0.12, // fraction of globe radius
  ambientLightIntensity: 2.0,
  sunlightIntensity: 1.1,
  maxPixelRatio: 1.5, // limit GPU cost on high-density displays
  pointRadiusDegrees: 1.9, // unnumbered surface markers; 5× the original 0.38° radius
  heatmapBandwidthDegrees: 3, // smoothing radius; also bounds native heatmap mesh detail
  heatmapBaseAltitude: 0.002, // fraction of globe radius
  heatmapLayerGap: 0.0005, // separate flat shells to avoid intersecting surfaces
  heatmapMaxOpacity: 0.65, // allows overlapping layer colors to remain visible
  pointAltitude: 0.016, // fraction of globe radius
  surfaceFitWidth: 0.46, // projected sphere radius / canvas width
  surfaceFitHeight: 0.44, // projected sphere radius / canvas height
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
  colors: {
    technology: "#80e5ef",
    earthquake: "#ffc38b", wildfire: "#ff8d91", news: "#a0d9ff",
    humanitarian: "#d3b9ff", conflict: "#fba6bf", politics: "#e6d09c",
    terror: "#ffaeae", finance: "#94e5c9", selected: "#ceffe5",
  } as Record<string, string>,
};
export const eventColor = (layer: string) => GLOBE.colors[layer] ?? "#d3b9ff";
