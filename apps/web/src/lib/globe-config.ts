/** Visual-only settings. None are sent to FastAPI. Units are explicit below. */
export const GLOBE = {
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
  surfaceFitWidth: 0.43, // projected sphere radius / canvas width
  surfaceFitHeight: 0.39, // projected sphere radius / canvas height
  zoomOutMultiplier: 1.7,
  minZoomAltitude: 0.04, // nearest camera height / globe radius (~255 km on Earth)
  pinToCardDistancePx: 80, // preferred horizontal gap when a card first appears
  connectorInsetPx: 6, // extend under the card edge to avoid visible seams
  connectorWidthPx: 8, // CSS pixels, constant as the globe zooms
  cardEdgePaddingPx: 24, // responsive card width margin and retained-selection inset
  maxCallouts: 4, // highest-significance events; selected event takes priority
  colors: {
    technology: "#80e5ef",
    earthquake: "#ffc38b", wildfire: "#ff8d91", news: "#a0d9ff",
    humanitarian: "#d3b9ff", conflict: "#fba6bf", protest: "#f6c86b", strategic_development: "#9ec1ff", politics: "#e6d09c",
    terror: "#ffaeae", crime: "#e7a6ff", finance: "#94e5c9", selected: "#ceffe5",
  } as Record<string, string>,
};
export const eventColor = (layer: string) => GLOBE.colors[layer] ?? "#d3b9ff";
