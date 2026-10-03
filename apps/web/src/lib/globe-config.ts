/** Visual-only settings. None are sent to FastAPI. Units are explicit below. */
export const GLOBE = {
  initialView: { lat: 30, lng: -110 }, // degrees, east-positive longitude
  rotationSpeed: 0.28, // Three.js OrbitControls speed; 1 ≈ one revolution/minute at 60 fps
  atmosphereColor: "#87c8ef",
  atmosphereAltitude: 0.12, // fraction of globe radius
  ambientLightIntensity: 2.0,
  sunlightIntensity: 1.1,
  maxPixelRatio: 2, // limit GPU cost on high-density displays
  pointRadiusDegrees: 0.38,
  pointAltitude: 0.016, // fraction of globe radius
  surfaceFitWidth: 0.43, // projected sphere radius / canvas width
  surfaceFitHeight: 0.39, // projected sphere radius / canvas height
  zoomOutMultiplier: 1.7,
  maxCallouts: 4, // highest-significance events; selected event takes priority
  cardGapPx: 16,
  desktopBreakpointPx: 1100,
  colors: {
    earthquake: "#ffc38b", wildfire: "#ff8d91", news: "#a0d9ff",
    humanitarian: "#d3b9ff", conflict: "#fba6bf", politics: "#e6d09c",
    terror: "#ffaeae", finance: "#94e5c9", selected: "#ceffe5",
  } as Record<string, string>,
};
export const eventColor = (layer: string) => GLOBE.colors[layer] ?? "#d3b9ff";
