"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { AdditiveBlending, AlwaysStencilFunc, AmbientLight, BackSide, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, DirectionalLight, EqualStencilFunc, FrontSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Raycaster, ReplaceStencilOp, ShaderMaterial, SphereGeometry, TubeGeometry, Vector2, Vector3, type Material, type Object3D } from "three";
import { CATEGORIES, LABELS, isCurated, type CategoryHeatmap, type CategoryId, type LayerId, type ViewTab } from "@/lib/layers";
import type { FeedEvent } from "@/lib/profile";
import StoryActions, { type Personal } from "@/components/story-actions";

/** My Feed's own controls, shown under the tabs. */
export type FeedControls = {
  section: "for-you" | "saved";
  onSection: (section: "for-you" | "saved") => void;
  saved: number;
  loading: boolean;
  error?: string;
  onStartOver: () => void;
};
import { densityField, heatmapSegments, sphereGrid, type SphereGrid } from "@/lib/heatmap-density";
import type { Event, EventLink } from "@/lib/api";
import { continentMaterial } from "@/lib/continent-material";
import { cardsOverlap, placeCard, type CardRect } from "@/lib/card-placement";
import { countryContains, type CountryFeature } from "@/lib/country-selection";
import countries from "@/data/countries.geojson.json";
import countryColors from "@/data/country-colors.json";
import { neighborBorders, borderContour } from "@/lib/country-borders";
import { globeClipPlanes } from "@/lib/globe-depth";
import RelatedEventControls, { relationLabel } from "@/components/related-event-controls";
import LinkCard from "@/components/link-card";
import DetailsPanel from "@/components/details-panel";
import { rankOf, tourOrder } from "@/lib/briefing";
import ClusterPanel from "@/components/cluster-panel";
import { Thumbnail, TimeAgo } from "@/components/event-media";
import { exactTime } from "@/lib/freshness";
import { easeFactor, hangsBelow, layoutRingCards, ringAnchor, type Rect, type RingCard } from "@/lib/card-ring";
import { angularSpread, clusterScreenPins, pickSpotlight, spreadAltitude, type PinCluster, type ScreenPin } from "@/lib/pin-clusters";
import FluidOrb from "@/components/ui/fluid-orb";
import { arcSpecs, floatingArc, growProgress, indexLinks, otherEnd, pickTarget, retractProgress, type ArcSpec, type Hit, type Pick } from "@/lib/related-events";
import { GLOBE, PIN, eventColor } from "@/lib/globe-config";
import { canSpin, clampViewLat, spinUpFrame, type View } from "@/lib/idle-spin";
import { alignStarField, createStarField } from "@/lib/star-field";

export type Location = { lat: number; lng: number };
/** Integration hook: these selections are local; they never submit a request. */
export type Selection = { kind: "location"; location: Location } | { kind: "event"; event: Event };
type Callout = Location & { id: string; color: string; event?: Event; retained?: boolean };

const coordinate = (value: number, latitude: boolean) => `${Math.abs(value).toFixed(4)}° ${latitude ? value < 0 ? "S" : "N" : value < 0 ? "W" : "E"}`;
const sourceHref = (value: string | null) => {
  try { const url = new URL(value ?? ""); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
};

// Stable accessors prevent unrelated React renders from recalculating density.
// Each country draws its own outline (so it rises with a selected country), split into
// runs by neighbor so shared borders can take both countries' colors.
const borders = neighborBorders(countries.features).map(({ countryId, neighborId, points }) => ({ countryId, neighborId, points: borderContour(points, GLOBE.landCurvatureDegrees).map(point => ({ lng: point[0], lat: point[1], countryId })) }));
const borderLongitude = (point: object) => (point as { lng: number }).lng;
const borderLatitude = (point: object) => (point as { lat: number }).lat;
const rendererConfig = { stencil: true }; // land writes a stencil mask that clips the heatmap
const LAND_STENCIL = 1;
// Visible land caps mark their pixels; the heatmap then draws only on those pixels,
// so density never spills past coastlines into the ocean.
function writeLandStencil<T extends Material>(material: T): T {
  material.stencilWrite = true;
  material.stencilRef = LAND_STENCIL;
  material.stencilFunc = AlwaysStencilFunc;
  material.stencilZPass = ReplaceStencilOp;
  return material;
}
function clipToLand(mesh: Mesh, renderOrder: number) {
  mesh.renderOrder = renderOrder;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    material.depthWrite = false;
    material.depthTest = false; // the stencil already limits it to visible land, including raised countries
    material.stencilWrite = true;
    material.stencilWriteMask = 0;
    material.stencilRef = LAND_STENCIL;
    material.stencilFunc = EqualStencilFunc;
  }
}
// three-globe's fixed globe radius in scene units.
const GLOBE_UNITS = 100;
// Shared pin geometry, built along +Z: three-globe orients objects so +Z points away
// from the surface. A gray stem runs from the ground to the colored sphere head.
const pinStem = new CylinderGeometry(PIN.stemRadius * GLOBE_UNITS, PIN.stemRadius * GLOBE_UNITS, PIN.stemLength * GLOBE_UNITS, 8)
  .rotateX(Math.PI / 2).translate(0, 0, PIN.stemLength * GLOBE_UNITS / 2);
const pinHead = new SphereGeometry(PIN.headRadius * GLOBE_UNITS, 16, 12)
  .translate(0, 0, (PIN.stemLength + PIN.headRadius) * GLOBE_UNITS);
const pinStemMaterial = new MeshLambertMaterial({ color: GLOBE.pinStemColor });
const pinDimStemMaterial = new MeshLambertMaterial({ color: GLOBE.pinDimStemColor });
const pinHeadMaterials = new Map<string, MeshLambertMaterial>();
// The selected pin's halo: a soft white shell around its head.
const pinHalo = new SphereGeometry(PIN.headRadius * GLOBE_UNITS * 1.9, 20, 14)
  .translate(0, 0, (PIN.stemLength + PIN.headRadius) * GLOBE_UNITS);
const pinHaloMaterial = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false });
// Headlines ping: a head-sized glow centred on the head, scaled up and faded each period
// by animatePings. Each pin gets its own material because opacity differs per pin.
const pingGeometry = new SphereGeometry(PIN.headRadius * GLOBE_UNITS, 16, 12);
const pings = new Set<Mesh>();
type PinTone = "normal" | "selected" | "linked" | "dim";
function pinObject(marker: object) {
  const { color: layerColor, tone, ping, pingOffset, scale } = marker as { color: string; tone: PinTone; ping: boolean; pingOffset: number; scale: number };
  const color = tone === "dim" ? GLOBE.pinDimColor : layerColor;
  if (!pinHeadMaterials.has(color)) pinHeadMaterials.set(color, new MeshLambertMaterial({ color }));
  const pin = new Group();
  pin.add(new Mesh(pinStem, tone === "dim" ? pinDimStemMaterial : pinStemMaterial), new Mesh(pinHead, pinHeadMaterials.get(color)!));
  if (tone === "selected") pin.add(new Mesh(pinHalo, pinHaloMaterial));
  pin.scale.setScalar(scale);
  if (ping) {
    const glow = new Mesh(pingGeometry, new MeshBasicMaterial({ color: lighten(layerColor, 0.15), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }));
    glow.position.set(0, 0, (PIN.stemLength + PIN.headRadius) * GLOBE_UNITS);
    glow.raycast = () => {}; // the ping never changes what a click hits
    glow.userData.pingOffset = pingOffset;
    pin.add(glow);
    pings.add(glow);
  }
  return pin;
}
/** Advance every ping; drop pings whose pin three-globe has removed. */
function animatePings(now: number, reduced: boolean) {
  for (const glow of pings) {
    if (!glow.parent?.parent) { pings.delete(glow); (glow.material as Material).dispose(); continue; }
    const phase = ((now + glow.userData.pingOffset) % GLOBE.pinPingPeriodMs) / GLOBE.pinPingPeriodMs;
    glow.visible = !reduced;
    glow.scale.setScalar(1 + (GLOBE.pinPingMaxScale - 1) * phase);
    (glow.material as MeshBasicMaterial).opacity = GLOBE.pinPingOpacity * (1 - phase) ** 2;
  }
}
// Stable per-event stagger so headline pins never pulse in unison.
const pingOffset = (id: string) => [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7) % GLOBE.pinPingPeriodMs;
// ATMOSPHERE — two additive shells. Both work in view space: `facing` is 1 where the
// surface points at the camera and 0 at the silhouette. Shaders output the plain color
// with glow as alpha: additive blending already scales color by alpha, and the page
// then shows mix(background, color, glow) instead of a darkened ring. colorspace_fragment
// converts three's linear working color back to sRGB so #333333 renders as #333333.
const ATMOSPHERE_VERTEX = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }`;
// Front faces just above the surface: haze that thickens toward the limb.
const ATMOSPHERE_RIM_FRAGMENT = `
  uniform vec3 color;
  uniform float strength;
  uniform float falloff;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    float glow = strength * pow(1.0 - facing, falloff);
    gl_FragColor = vec4(color, glow);
    #include <colorspace_fragment>
  }`;
// Back faces of a larger shell: brightest at Earth's limb, fading to 0 at its own edge.
// limbFacing is how far the back faces turn away from the camera at Earth's limb.
const ATMOSPHERE_HALO_FRAGMENT = `
  uniform vec3 color;
  uniform float strength;
  uniform float falloff;
  uniform float limbFacing;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float away = clamp(-dot(normalize(vNormal), normalize(vView)) / limbFacing, 0.0, 1.0);
    float glow = strength * pow(away, falloff);
    gl_FragColor = vec4(color, glow);
    #include <colorspace_fragment>
  }`;
function atmosphereShell(radius: number, rim: boolean) {
  const outer = 1 + GLOBE.atmosphereAltitude;
  const material = new ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: rim ? ATMOSPHERE_RIM_FRAGMENT : ATMOSPHERE_HALO_FRAGMENT,
    uniforms: {
      color: { value: new Color(GLOBE.atmosphereColor) },
      strength: { value: rim ? GLOBE.atmosphereRimStrength : GLOBE.atmosphereHaloStrength },
      falloff: { value: rim ? GLOBE.atmosphereRimFalloff : GLOBE.atmosphereHaloFalloff },
      limbFacing: { value: Math.sqrt(1 - 1 / outer ** 2) },
    },
    side: rim ? FrontSide : BackSide,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const shell = new Mesh(new SphereGeometry(radius * (rim ? 1 + GLOBE.landAltitude * 1.5 : outer), 96, 64), material);
  shell.raycast = () => {}; // never blocks POI or country picking
  shell.renderOrder = rim ? 5 : -5;
  return shell;
}
// Raise HSL lightness in sRGB, keeping hue and saturation.
function lighten(hex: string, amount: number) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), lightness = (max + min) / 2, chroma = max - min;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  const hue = chroma === 0 ? 0 : max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  const next = Math.min(1, lightness + amount);
  const c = (1 - Math.abs(2 * next - 1)) * saturation, x = c * (1 - Math.abs(hue % 2 - 1)), m = next - c / 2;
  const [red, green, blue] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
  return `#${[red, green, blue].map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
// Each country's base color is its average in a satellite image (scripts/build-country-colors.py),
// brightened for legibility on the dark page.
const landRelief = { strength: GLOBE.reliefStrength, heightScale: GLOBE.reliefHeightScale, sampleDegrees: GLOBE.reliefFacetDegrees, lightDirection: GLOBE.reliefLightDirection, slopeSmoothing: GLOBE.reliefSlopeSmoothing, shadeLimit: GLOBE.reliefShadeLimit };
const satelliteColors = new Map(Object.entries(countryColors as Record<string, string>).map(([id, hex]) => [id, lighten(hex, GLOBE.landLightnessBoost)]));
const satelliteColor = (id: string) => satelliteColors.get(id) ?? GLOBE.landColor;
const hexChannels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
// Shared borders average both countries' land colors; coastlines use the one country.
// Either way the result is darkened by GLOBE.borderDarkness.
const borderColors = new Map(borders.map(border => {
  const [own, other] = [border.countryId, border.neighborId ?? border.countryId].map(id => hexChannels(satelliteColor(id)));
  const channels = own.map((channel, index) => Math.round((channel + other[index]) / 2 * (1 - GLOBE.borderDarkness)));
  return [border, `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`];
}));
// HEATMAPS — one mesh per category, colored like its rail icon. Density 0 is transparent
// and denser areas grow more opaque (the square root lifts sparse regions so one dense
// cluster cannot hide the rest). All meshes share one sphere grid; a category's density is
// recomputed only when its own points change, so toggling one category leaves the rest alone.
const HEATMAP_VERTEX = `
  attribute float density;
  varying float vDensity;
  void main() {
    vDensity = density;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const HEATMAP_FRAGMENT = `
  uniform vec3 color;
  uniform float maxOpacity;
  uniform float gain;
  varying float vDensity;
  void main() {
    float alpha = min(maxOpacity, sqrt(max(vDensity, 0.0)) * gain);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }`;
type HeatmapBase = { radius: number; geometry: SphereGeometry; grid: SphereGrid };
let heatmapBase: HeatmapBase | null = null;
function sharedHeatmapGrid(globeRadius: number): HeatmapBase {
  const radius = globeRadius * (1 + GLOBE.heatmapBaseAltitude);
  if (heatmapBase?.radius !== radius) {
    const { widthSegments, heightSegments } = heatmapSegments(GLOBE.heatmapBandwidthDegrees);
    const geometry = new SphereGeometry(radius, widthSegments, heightSegments);
    geometry.computeBoundingSphere();
    heatmapBase = { radius, geometry, grid: sphereGrid(geometry.getAttribute("position").array, widthSegments, heightSegments) };
  }
  return heatmapBase;
}
function createHeatmapMesh(id: CategoryId, base: HeatmapBase) {
  const geometry = new BufferGeometry();
  geometry.setIndex(base.geometry.getIndex());
  geometry.setAttribute("position", base.geometry.getAttribute("position"));
  geometry.setAttribute("density", new BufferAttribute(new Float32Array(base.grid.lats.length), 1));
  geometry.boundingSphere = base.geometry.boundingSphere;
  const index = CATEGORIES.findIndex(category => category.id === id);
  const material = new ShaderMaterial({
    vertexShader: HEATMAP_VERTEX,
    fragmentShader: HEATMAP_FRAGMENT,
    uniforms: {
      color: { value: new Color(eventColor(CATEGORIES[index].layers[0])) },
      maxOpacity: { value: GLOBE.heatmapMaxOpacity },
      gain: { value: GLOBE.heatmapOpacityGain },
    },
    transparent: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.raycast = () => {}; // never blocks POI or country picking
  clipToLand(mesh, 10 + index);
  return mesh;
}
const heatmapKey = (heatmap: CategoryHeatmap) => heatmap.points.map(point => `${point.lat},${point.lng},${point.weight}`).join(";");

// RELATIONSHIP ARCS — tubes whose uv.x runs 0 at the origin pin to 1 at the linked pin.
// `progress` hides everything past it, so animating it flies the arc out (or reels it
// back in). A bright head rides the leading edge while growing; `glow` lifts the core
// and fades in an additive halo tube on hover.
const ARC_VERTEX = `
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vAlong = uv.x;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }`;
const ARC_CORE_FRAGMENT = `
  uniform vec3 color;
  uniform float progress;
  uniform float glow;
  uniform float growing;
  varying float vAlong;
  void main() {
    if (vAlong > progress) discard;
    float head = growing * smoothstep(progress - 0.06, progress, vAlong);
    gl_FragColor = vec4(mix(color, vec3(1.0), clamp(0.35 * glow + 0.7 * head, 0.0, 1.0)), 1.0);
    #include <colorspace_fragment>
  }`;
const ARC_HALO_FRAGMENT = `
  uniform vec3 color;
  uniform float progress;
  uniform float glow;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    if (vAlong > progress || glow < 0.003) discard;
    float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    gl_FragColor = vec4(color, glow * 0.6 * facing * facing);
    #include <colorspace_fragment>
  }`;
// Picking only: thick enough to hover comfortably, but never drawn.
const arcHitMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
const noRaycast = () => {};
type ArcState = "grow" | "shown" | "retract";
type Arc = {
  originId: string; group: Group; hit: Mesh; uniforms: { progress: { value: number }; glow: { value: number }; growing: { value: number } }[];
  state: ArcState; start: number; from: number; progress: number; glow: number;
};
function createArc(spec: ArcSpec<EventLink>, start: Vector3, end: Vector3, globeRadius: number): Omit<Arc, "state" | "start" | "from" | "progress" | "glow"> {
  const curve = new CatmullRomCurve3(floatingArc(start, end, globeRadius, GLOBE.relatedArcClearance, GLOBE.relatedArcRise));
  const radius = GLOBE.relatedArcRadius * (GLOBE.relatedArcMinRadiusScale + (1 - GLOBE.relatedArcMinRadiusScale) * Math.max(0, Math.min(1, spec.link.confidence)));
  const shared = () => ({ color: { value: new Color(GLOBE.relatedArcColor) }, progress: { value: 0 }, glow: { value: 0 }, growing: { value: 1 } });
  const coreUniforms = shared(), haloUniforms = shared();
  const core = new Mesh(new TubeGeometry(curve, 128, radius, 8, false), new ShaderMaterial({ vertexShader: ARC_VERTEX, fragmentShader: ARC_CORE_FRAGMENT, uniforms: coreUniforms }));
  const halo = new Mesh(new TubeGeometry(curve, 128, radius * GLOBE.relatedArcHaloScale, 12, false), new ShaderMaterial({
    vertexShader: ARC_VERTEX, fragmentShader: ARC_HALO_FRAGMENT, uniforms: haloUniforms,
    blending: AdditiveBlending, transparent: true, depthWrite: false,
  }));
  const hit = new Mesh(new TubeGeometry(curve, 48, radius * GLOBE.relatedArcHitScale, 6, false), arcHitMaterial);
  core.raycast = noRaycast;
  halo.raycast = noRaycast;
  halo.renderOrder = 20;
  hit.userData.linkId = spec.link.id;
  const group = new Group();
  group.add(core, halo, hit);
  return { originId: spec.from, group, hit, uniforms: [coreUniforms, haloUniforms] };
}
function disposeArc(arc: Arc) {
  arc.group.removeFromParent();
  for (const child of arc.group.children as Mesh[]) {
    child.geometry.dispose();
    if (child.material !== arcHitMaterial) (child.material as Material).dispose();
  }
}

export default function EventGlobe({ view, headlines, personal, feed, allEvents, links, events, selectedCountries, onToggleCountry, heatmaps, selection, onSelect, fixture }: {
  /** headlines / feed: a curated list as pins with floating cards. explore: every filtered event, clustered. */
  view: ViewTab;
  /** The curated list: the Headlines feed, or My Feed. Map filters do not apply to it. */
  headlines: FeedEvent[];
  /** Save and More/Less like this, when the profile API is available. */
  personal: Personal | null;
  /** My Feed's own controls: For you vs Reading list, plus loading and empty states. */
  feed: FeedControls | null;
  allEvents: Event[];
  /** Every relationship hypothesis, loaded once; undefined links means still loading. */
  links: { links?: EventLink[]; error?: string };
  events: Event[];
  selectedCountries: { id: string; name: string; events: Event[] }[];
  onToggleCountry: (id: string) => void;
  heatmaps: CategoryHeatmap[];
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  fixture: boolean;
}) {
  // Headlines and My Feed share one presentation: pins, ring cards, the briefing and the tour.
  const curated = isCurated(view);
  // The native sphere keeps ocean picking and far-side occlusion without painting water.
  const oceanDepthMaterial = useMemo(() => new MeshBasicMaterial({ colorWrite: false }), []);
  const orbSurface = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const fittedDistance = useRef<number | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  // `shown` is where the card is actually drawn after being kept inside the visible area.
  const cardPlacements = useRef(new Map<string, CardRect & { offsetX: number; offsetY: number; shown?: { left: number; top: number } }>());
  // Last projected pin position per card, so a moved card can re-measure its offset.
  const pinScreen = useRef(new Map<string, { x: number; y: number }>());
  // Collapsed cards ride their pin's ring (lib/card-ring.ts) unless the user dragged them
  // off it; `drawn` is each card's last drawn position, for easing and hand-offs.
  const manualCards = useRef(new Set<string>());
  // Headlines' docked details panel; ring cards stay to its left.
  const detailsPanel = useRef<HTMLElement>(null);
  const drawn = useRef(new Map<string, { left: number; top: number }>());
  const drag = useRef<{ id: string; pointerId: number; captureTarget: Element; startX: number; startY: number; left: number; top: number; moved: boolean; fromRing: boolean } | null>(null);
  const dragNeedsUpdate = useRef(false);
  const globePress = useRef<{ id: number; x: number; y: number; maxDistance: number; tolerance: number } | null>(null);
  const clickRaycaster = useMemo(() => new Raycaster(), []);
  const suppressClick = useRef<string | null>(null);
  const pins = useRef(new Map<string, HTMLButtonElement>());
  const paths = useRef(new Map<string, SVGPathElement>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  // At the default fit or farther out the globe shows only the heatmap; zooming in
  // swaps it for individual markers.
  const [zoomedIn, setZoomedIn] = useState(false);
  const heatmapLayers = useRef(new Map<CategoryId, { key: string; mesh: Mesh }>());
  const heatmapVisible = useRef(true);
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const tick = () => {
      const instance = globe.current, fit = fittedDistance.current;
      if (!instance || !fit) { frame = requestAnimationFrame(tick); return; }
      // Apparent globe size scales with 1/√(d² − r²); compare it with the default fit.
      const radius = instance.getGlobeRadius(), distance = instance.camera().position.length();
      const magnification = Math.sqrt(fit ** 2 - radius ** 2) / Math.sqrt(Math.max(1e-9, distance ** 2 - radius ** 2));
      setZoomedIn(magnification > GLOBE.markerZoomMagnification);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  useEffect(() => {
    heatmapVisible.current = !zoomedIn;
    heatmapLayers.current.forEach(layer => { layer.mesh.visible = !zoomedIn; });
  }, [zoomedIn]);
  useEffect(() => {
    const layers = heatmapLayers.current;
    return () => layers.forEach(layer => {
      layer.mesh.removeFromParent();
      layer.mesh.geometry.dispose();
      (layer.mesh.material as ShaderMaterial).dispose();
    });
  }, []);
  // Hover is pin-first: an arc only hovers where no pin is under the pointer.
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);
  const [hoveredArcId, setHoveredArcId] = useState<string | null>(null);
  // The open card keeps its arc (and that arc's origin) drawn until it closes.
  const [openLink, setOpenLink] = useState<{ id: string; origin: string; x: number; y: number; width: number; height: number } | null>(null);
  const arcs = useRef(new Map<string, Arc>());
  const hoveredArcRef = useRef<string | null>(null);
  const openLinkRef = useRef<string | null>(null);
  const pointer = useRef<{ x: number; y: number; inside: boolean; dirty: boolean }>({ x: 0, y: 0, inside: false, dirty: false });
  const tooltip = useRef<HTMLDivElement>(null);
  const hoverRaycaster = useMemo(() => new Raycaster(), []);
  useEffect(() => { hoveredArcRef.current = hoveredArcId; }, [hoveredArcId]);
  useEffect(() => { openLinkRef.current = openLink?.id ?? null; }, [openLink]);
  const linkIndex = useMemo(() => indexLinks(links.links ?? []), [links.links]);
  const linksById = useMemo(() => new Map((links.links ?? []).map(link => [link.id, link])), [links.links]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(container.current);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      if (globe.current) globe.current.controls().enableDamping = !media.matches;
    };
    media.addEventListener("change", change);
    return () => { observer.disconnect(); media.removeEventListener("change", change); };
  }, []);

  useEffect(() => {
    if (!ready || !globe.current) return;
    const instance = globe.current;
    const shells = [atmosphereShell(instance.getGlobeRadius(), false)];
    if (GLOBE.atmosphereRimStrength > 0) shells.push(atmosphereShell(instance.getGlobeRadius(), true));
    shells.forEach(shell => instance.scene().add(shell));
    return () => shells.forEach(shell => {
      instance.scene().remove(shell);
      shell.geometry.dispose();
      (shell.material as ShaderMaterial).dispose();
    });
  }, [ready]);

  useEffect(() => {
    if (!ready || !globe.current) return;
    const instance = globe.current;
    // Draw the native depth-only sphere before opaque land and event markers.
    instance.scene().traverse(object => {
      if ((object as Mesh & { __globeObjType?: string }).__globeObjType === "globe") {
        const surface = object.children.find(child => (child as Mesh).isMesh);
        if (surface) surface.renderOrder = -10;
      }
    });
    const camera = instance.camera() as PerspectiveCamera;
    const updateDepthRange = () => {
      const { near, far } = globeClipPlanes(camera.position.length(), instance.getGlobeRadius(), GLOBE.atmosphereAltitude);
      if (camera.near === near && camera.far === far) return;
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    };
    updateDepthRange();
    instance.controls().addEventListener("change", updateDepthRange);
    return () => instance.controls().removeEventListener("change", updateDepthRange);
  }, [ready]);

  // IDLE ROTATION — any globe or card interaction stops the spin at once. After
  // GLOBE.idleResumeMs without one, and while no card holds the view, the globe eases into
  // rotation and its tilt and zoom ease back to the default view.
  const viewHeld = useRef(false);
  const lastInteraction = useRef(-Infinity);
  const [spinning, setSpinning] = useState(false);
  // Switching modes skips the idle wait and eases back to the default view at once.
  const resetView = useRef(false);
  useEffect(() => { lastInteraction.current = -Infinity; resetView.current = true; }, [view]);
  useEffect(() => {
    if (!ready || !globe.current || !stage.current) return;
    const instance = globe.current, controls = instance.controls(), surface = stage.current;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const heldPointers = new Set<number>();
    // Speed ramps from spinStart; tilt and zoom return from returnStart (restarted by a mode switch).
    let spinStart: number | null = null, returnStart = 0, from: View | null = null, frame = 0, shown = false;
    const show = (value: boolean) => { if (value !== shown) setSpinning(shown = value); };
    const stop = () => { controls.autoRotate = false; spinStart = null; show(false); };
    const interact = () => { lastInteraction.current = performance.now(); stop(); };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const held = viewHeld.current || heldPointers.size > 0;
      if (held) lastInteraction.current = now; // the idle countdown starts once the view is released
      if (!canSpin({ held, reduced: media.matches, now, lastInteraction: lastInteraction.current, idleMs: GLOBE.idleResumeMs })) {
        if (spinStart !== null || controls.autoRotate) stop();
        return;
      }
      const fit = fittedDistance.current;
      if (!fit) return;
      const target = { lat: GLOBE.initialView.lat, altitude: fit / instance.getGlobeRadius() - 1 };
      if (spinStart === null || resetView.current) {
        const current = instance.pointOfView();
        spinStart ??= now;
        returnStart = now;
        from = { lat: current.lat, altitude: current.altitude };
        resetView.current = false;
        controls.autoRotate = true;
        show(true);
      }
      controls.autoRotateSpeed = GLOBE.rotationSpeed * spinUpFrame(now - spinStart, GLOBE.spinUpMs, GLOBE.viewReturnMs, from!, target).speed;
      const step = spinUpFrame(now - returnStart, GLOBE.spinUpMs, GLOBE.viewReturnMs, from!, target);
      if (step.returning) instance.pointOfView({ ...step.view, lng: instance.pointOfView().lng });
    };
    frame = requestAnimationFrame(tick);
    const down = (event: PointerEvent) => { heldPointers.add(event.pointerId); interact(); };
    const up = (event: PointerEvent) => { if (heldPointers.delete(event.pointerId)) interact(); };
    // Leaving the window is not an interaction: only drop pointers whose release we will never see.
    const blur = () => heldPointers.clear();
    // Capture also catches card gestures whose handlers stop propagation.
    surface.addEventListener("pointerdown", down, true);
    surface.addEventListener("click", interact, true);
    surface.addEventListener("keydown", interact, true);
    surface.addEventListener("wheel", interact, { capture: true, passive: true });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(frame);
      controls.autoRotate = false;
      surface.removeEventListener("pointerdown", down, true);
      surface.removeEventListener("click", interact, true);
      surface.removeEventListener("keydown", interact, true);
      surface.removeEventListener("wheel", interact, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [ready]);

  // STARRY BACKDROP — the real sky for "now". Stars are fixed in the scene while the camera orbits,
  // so they turn with the Earth, both during idle rotation and manual drags.
  useEffect(() => {
    if (!ready || !globe.current) return;
    const instance = globe.current;
    const stars = createStarField({
      brightness: GLOBE.skyBrightness, magnitudeCutoff: GLOBE.skyMagnitudeCutoff, minSizePx: GLOBE.skyStarMinSizePx,
      maxSizePx: GLOBE.skyStarMaxSizePx, saturation: GLOBE.skyColorSaturation,
    }, instance.renderer().getPixelRatio());
    alignStarField(stars, new Date());
    instance.scene().add(stars);
    const timer = setInterval(() => alignStarField(stars, new Date()), GLOBE.skyRealignMs);
    return () => {
      clearInterval(timer);
      instance.scene().remove(stars);
      stars.geometry.dispose();
      (stars.material as ShaderMaterial).dispose();
    };
  }, [ready]);

  // Start at a whole-Earth fit, but allow close country-scale zoom inside the central canvas.
  useEffect(() => {
    if (!ready || !globe.current || !size.width || !size.height) return;
    const instance = globe.current;
    const camera = instance.camera() as PerspectiveCamera;
    const radius = instance.getGlobeRadius();
    const focalPixels = size.height / (2 * Math.tan(camera.fov * Math.PI / 360));
    const screenRadius = Math.min(size.width * GLOBE.surfaceFitWidth, size.height * GLOBE.surfaceFitHeight);
    const distance = Math.sqrt(radius ** 2 + (focalPixels * radius / screenRadius) ** 2);
    const minimum = radius * (1 + GLOBE.minZoomAltitude);
    const previousFit = fittedDistance.current;
    const nextDistance = previousFit ? instance.camera().position.length() / previousFit * distance : distance;
    fittedDistance.current = distance;
    instance.controls().minDistance = minimum;
    instance.controls().maxDistance = distance * GLOBE.zoomOutMultiplier;
    instance.pointOfView({ altitude: Math.max(minimum, Math.min(distance * GLOBE.zoomOutMultiplier, nextDistance)) / radius - 1 });
  }, [ready, size]);

  const selectedCountryIds = useMemo(() => new Set(selectedCountries.map(country => country.id)), [selectedCountries]);
  const selectedEvents = useMemo(() => [...new Map(selectedCountries.flatMap(country => country.events).map(event => [event.id, event])).values()], [selectedCountries]);
  const selectedIds = useMemo(() => new Set(selectedEvents.map(event => event.id)), [selectedEvents]);
  // One selection at a time; its details card is the only expanded card.
  const selectedEvent = selection?.kind === "event" ? selection.event : null;
  // Headlines shows details in the side panel; only Explore expands the card itself.
  const expandedCards = useMemo(() => new Set(view === "explore" && selectedEvent ? [selectedEvent.id] : []), [view, selectedEvent]);
  const headlineEvents = headlines;
  // Add, update or remove category heatmaps; unchanged categories keep their density.
  useEffect(() => {
    if (!ready || !globe.current) return;
    const scene = globe.current.scene();
    const base = sharedHeatmapGrid(globe.current.getGlobeRadius());
    const wanted = new Map((view === "explore" ? heatmaps : []).map(heatmap => [heatmap.id, heatmap]));
    for (const [id, layer] of heatmapLayers.current) {
      if (wanted.has(id)) continue;
      scene.remove(layer.mesh);
      layer.mesh.geometry.dispose();
      (layer.mesh.material as ShaderMaterial).dispose();
      heatmapLayers.current.delete(id);
    }
    for (const heatmap of wanted.values()) {
      const key = heatmapKey(heatmap);
      let layer = heatmapLayers.current.get(heatmap.id);
      if (layer?.key === key) continue;
      if (!layer) {
        layer = { key, mesh: createHeatmapMesh(heatmap.id, base) };
        layer.mesh.visible = heatmapVisible.current;
        scene.add(layer.mesh);
        heatmapLayers.current.set(heatmap.id, layer);
      }
      const density = layer.mesh.geometry.getAttribute("density") as BufferAttribute;
      (density.array as Float32Array).set(densityField(base.grid, heatmap.points, GLOBE.heatmapBandwidthDegrees));
      density.needsUpdate = true;
      layer.key = key;
    }
  }, [ready, heatmaps, view]);
  const [hoveredCountryId, setHoveredCountryId] = useState<string | null>(null);
  const [hoveredBorderId, setHoveredBorderId] = useState<string | null>(null);
  // Country hover highlighting belongs to Explore; Headlines has no country interactions.
  const hoverId = view === "explore" ? hoveredBorderId ?? hoveredCountryId : null;
  const landMaterials = useMemo(() => new Map(countries.features.map(country => [country.id,
    writeLandStencil(continentMaterial(satelliteColor(country.id), GLOBE.continentEdgeShadeStrength, landRelief)),
  ])), []);
  const sideMaterials = useMemo(() => new Map(countries.features.map(country => [country.id,
    continentMaterial(satelliteColor(country.id), GLOBE.continentEdgeShadeStrength),
  ])), []);
  useEffect(() => {
    for (const country of countries.features) {
      const selected = selectedCountryIds.has(country.id);
      const baseColor = satelliteColor(country.id);
      landMaterials.get(country.id)!.color.set(country.id === "ATA" ? baseColor : selected ? GLOBE.selectedCountryColor : country.id === hoverId ? GLOBE.hoverCountryColor : baseColor);
      sideMaterials.get(country.id)!.color.set(selected ? GLOBE.selectedCountrySideColor : baseColor);
    }
  }, [selectedCountryIds, landMaterials, sideMaterials, hoverId]);
  const sideMaterial = useCallback((value: object) => sideMaterials.get((value as CountryFeature).id)!, [sideMaterials]);
  const landMaterial = useCallback((value: object) => landMaterials.get((value as CountryFeature).id)!, [landMaterials]);
  const countryBorderColor = useCallback((path: object) => selectedCountryIds.has((path as typeof borders[number]).countryId) ? "#000000" : borderColors.get(path as typeof borders[number])!, [selectedCountryIds]);
  const polygonAltitude = useCallback((value: object) => selectedCountryIds.has((value as CountryFeature).id) ? GLOBE.selectedCountryAltitude : GLOBE.landAltitude, [selectedCountryIds]);
  // Explore: a selected event shows its linked events that the filters allow.
  // Headlines shows no relationships at all (no linked pins, no arcs, no graying).
  const relationshipEvents = useMemo(() => {
    if (!selectedEvent || curated) return [];
    const visible = new Map(events.map(event => [event.id, event]));
    const linked = (linkIndex.get(selectedEvent.id) ?? []).map(link => visible.get(otherEnd(link, selectedEvent.id)));
    return [...new Map(linked.filter((event): event is Event => !!event && event.id !== selectedEvent.id).map(event => [event.id, event])).values()];
  }, [selectedEvent, view, events, linkIndex]);
  const linkedIds = useMemo(() => new Set(selectedEvent && view === "explore" ? (linkIndex.get(selectedEvent.id) ?? []).map(link => otherEnd(link, selectedEvent.id)) : []), [selectedEvent, view, linkIndex]);
  // 3D pins. Headlines: the top events at every zoom. Explore: every filtered event once
  // zoomed in (the heatmap and clusters stand in for them further out). Either way the
  // selection and its linked events always keep their pins.
  const displayEvents = useMemo(() => {
    const base = curated ? headlineEvents : zoomedIn ? [...events, ...selectedEvents] : [];
    return [...new Map([...(selectedEvent ? [selectedEvent] : []), ...relationshipEvents, ...base].map(event => [event.id, event])).values()];
  }, [view, headlineEvents, zoomedIn, events, selectedEvents, selectedEvent, relationshipEvents]);

  // A connection card belongs to the selection it was opened from.
  useEffect(() => { setOpenLink(null); }, [selectedEvent?.id]);
  // Explore view: an opened cluster lists its events; one headline is occasionally spotlit.
  const [openCluster, setOpenCluster] = useState<{ ids: string[]; x: number; y: number; width: number; height: number } | null>(null);
  const [spotlight, setSpotlight] = useState<Event | null>(null);
  useEffect(() => { setOpenCluster(null); setSpotlight(null); }, [view, selectedEvent?.id]);
  // A selection, connection card, or cluster list holds the view: rotation never resumes under it.
  useEffect(() => { viewHeld.current = !!selection || !!openLink || !!openCluster; }, [selection, openLink, openCluster]);
  // Center the camera on a newly selected pin or place, keeping the zoom (unless a linked-pin
  // visit asked for a wider minimum). Latitude stays inside the tilt lock.
  const focusMinAltitude = useRef(0);
  const focusTarget = selection?.kind === "event" ? selection.event : selection?.kind === "location" ? selection.location : null;
  const focusKey = focusTarget ? `${focusTarget.lat},${focusTarget.lng}` : null;
  useEffect(() => {
    const instance = globe.current;
    if (!ready || !instance || !focusKey) return;
    const [lat, lng] = focusKey.split(",").map(Number);
    const altitude = Math.max(focusMinAltitude.current, instance.pointOfView().altitude);
    focusMinAltitude.current = 0;
    instance.pointOfView({ lat: clampViewLat(lat, GLOBE.maxTiltDegrees), lng, altitude }, GLOBE.relatedFocusMs);
  }, [ready, focusKey]);

  const closeLink = useCallback(() => setOpenLink(null), []);
  function clearSelection() {
    setOpenLink(null);
    onSelect(null);
  }
  /** One pin at a time: choosing the selected event again deselects it. */
  function toggleEvent(event: Event) {
    setOpenLink(null);
    setOpenCluster(null);
    if (selectedEvent?.id === event.id) { onSelect(null); return; }
    onSelect({ kind: "event", event });
  }
  function visitEvent(target: Event) {
    setOpenLink(null);
    setOpenCluster(null);
    focusMinAltitude.current = GLOBE.relatedFocusAltitude; // the selection effect flies there
    onSelect({ kind: "event", event: target });
  }

  function selectCountry(country: CountryFeature) {
    onToggleCountry(country.id);
  }
  function selectCoordinates(lat: number, lng: number) {
    const country = countries.features.find(country => countryContains(country, {lat, lng}));
    if (country) selectCountry(country);
  }
  // Cards: the selection's details card, plus headline bubbles (headlines view) or the
  // occasional spotlight (explore view). Card placement hides cards that cannot fit.
  const callouts = useMemo<Callout[]>(() => {
    const bubbles = curated ? headlineEvents : spotlight ? [spotlight] : [];
    const listed = [...new Map([...(selectedEvent ? [selectedEvent] : []), ...bubbles].map(event => [event.id, event])).values()];
    const result = listed.map(event => ({ id: event.id, lat: event.lat, lng: event.lng, color: eventColor(event.layerId), event, retained: !displayEvents.some(visible => visible.id === event.id) && event.id !== spotlight?.id }));
    return selection?.kind === "location" ? [{ id: "selected-location", ...selection.location, color: GLOBE.colors.selected }, ...result] : result;
  }, [view, headlineEvents, spotlight, selectedEvent, selection, displayEvents]);

  // With a selection, linked pins keep their color and every other pin turns gray.
  const points = useMemo(() => displayEvents.map(event => ({
    ...event,
    color: selectedIds.has(event.id) ? GLOBE.colors.selected : eventColor(event.layerId),
    // Headlines only marks the selection; Explore also grays pins unrelated to it.
    tone: !selectedEvent ? "normal" : event.id === selectedEvent.id ? "selected" : curated ? "normal" : linkedIds.has(event.id) ? "linked" : "dim",
    // Headline pins ping for attention until something is selected.
    ping: curated && !selectedEvent,
    pingOffset: pingOffset(event.id),
    // Headlines uses large pins throughout; Explore enlarges only the selection.
    scale: curated ? GLOBE.headlinePinScale : event.id === selectedEvent?.id ? GLOBE.pinSelectedScale : 1,
    altitude: GLOBE.landAltitude,
  })), [displayEvents, selectedIds, selectedEvent, linkedIds, view]);
  const pointCountries = useMemo(() => new Map(displayEvents.map(event => [event.id,
    countries.features.find(country => countryContains(country, event))?.id,
  ])), [displayEvents]);

  // ARCS — fan out from the selected pin, the hovered pin, and the arc whose card is open.
  // Both ends must be shown pins, so links to filtered-out events are skipped.
  const pointsRef = useRef(points);
  useEffect(() => { pointsRef.current = points; }, [points]);
  const shownIds = useMemo(() => new Set(points.map(point => point.id)), [points]);
  // Headlines draws no arcs.
  const desiredArcs = useMemo(() => curated ? [] : arcSpecs([selectedEvent?.id, hoveredPinId, openLink?.origin], linkIndex, shownIds),
    [view, selectedEvent?.id, hoveredPinId, openLink?.origin, linkIndex, shownIds]);
  useEffect(() => {
    const instance = globe.current;
    if (!ready || !instance) return;
    const now = performance.now();
    const wanted = new Map(desiredArcs.map(spec => [spec.link.id, spec]));
    for (const [id, arc] of arcs.current) {
      const spec = wanted.get(id);
      if (spec && spec.from !== arc.originId) { disposeArc(arc); arcs.current.delete(id); continue; } // a new origin redraws it outward from there
      if (spec && arc.state === "retract") Object.assign(arc, { state: "grow", start: now, from: arc.progress });
      if (!spec && arc.state !== "retract") Object.assign(arc, { state: "retract", start: now, from: arc.progress });
    }
    const located = new Map(points.map(point => [point.id, point]));
    const vector = (id: string) => {
      const { lat, lng } = located.get(id)!;
      const { x, y, z } = instance.getCoords(lat, lng);
      return new Vector3(x, y, z);
    };
    const fanned = new Map<string, number>();
    for (const spec of desiredArcs) {
      if (arcs.current.has(spec.link.id)) continue;
      const order = fanned.get(spec.from) ?? 0;
      fanned.set(spec.from, order + 1);
      const arc: Arc = { ...createArc(spec, vector(spec.from), vector(spec.to), instance.getGlobeRadius()), state: "grow", start: now + order * GLOBE.relatedArcStaggerMs, from: 0, progress: 0, glow: 0 };
      instance.scene().add(arc.group);
      arcs.current.set(spec.link.id, arc);
    }
  }, [ready, desiredArcs, points]);
  useEffect(() => {
    const live = arcs.current;
    return () => { live.forEach(disposeArc); live.clear(); };
  }, []);

  // Find the pin or arc under a client point. Pins win; the globe hides its far side.
  const globeSurface = useRef<Mesh | null>(null);
  function pickAt(clientX: number, clientY: number): Pick {
    const instance = globe.current;
    if (!instance) return null;
    const bounds = instance.renderer().domElement.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return null;
    if (!globeSurface.current) instance.scene().traverse(object => {
      if ((object as Object3D & { __globeObjType?: string }).__globeObjType === "globe") globeSurface.current = (object.children.find(child => (child as Mesh).isMesh) as Mesh) ?? null;
    });
    instance.camera().updateMatrixWorld();
    hoverRaycaster.setFromCamera(new Vector2(2 * (clientX - bounds.left) / bounds.width - 1, 1 - 2 * (clientY - bounds.top) / bounds.height), instance.camera());
    const pinObjects = pointsRef.current.map(point => (point as typeof point & { __threeObjObject?: Object3D }).__threeObjObject).filter((pin): pin is Object3D => !!pin && pin.visible); // clustered pins are hidden
    const arcHits = [...arcs.current.values()].filter(arc => arc.state !== "retract" && arc.progress > 0.9).map(arc => arc.hit);
    const surface = globeSurface.current;
    type PickObject = Object3D & { __globeObjType?: string; __data?: unknown };
    const hits: Hit[] = [];
    for (const hit of hoverRaycaster.intersectObjects([...pinObjects, ...arcHits, ...(surface ? [surface] : [])], true)) {
      if (hit.object.userData.linkId) { hits.push({ kind: "arc", id: hit.object.userData.linkId, distance: hit.distance }); continue; }
      if (hit.object === surface) { hits.push({ kind: "surface", distance: hit.distance }); continue; }
      let owner: PickObject | null = hit.object;
      while (owner && !owner.__globeObjType) owner = owner.parent;
      if (owner?.__globeObjType === "object") hits.push({ kind: "pin", id: (owner.__data as Event).id, distance: hit.distance });
    }
    return pickTarget(hits);
  }
  // A hovered pin keeps its preview arcs briefly after the pointer leaves, and for as long
  // as the pointer rests on one of them, so they can be reached and clicked.
  const hover = useRef<Pick>(null);
  const hoverOrigin = useRef<string | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function setHoverOrigin(id: string | null) {
    clearTimeout(releaseTimer.current);
    hoverOrigin.current = id;
    setHoveredPinId(id);
  }
  function applyHover(pick: Pick) {
    const previous = hover.current;
    if (previous?.kind === pick?.kind && previous?.id === pick?.id) return;
    hover.current = pick;
    setHoveredArcId(pick?.kind === "arc" ? pick.id : null);
    if (container.current) container.current.style.cursor = pick ? "pointer" : "";
    if (pick?.kind === "pin") setHoverOrigin(pick.id);
    else if (pick?.kind === "arc" && arcs.current.get(pick.id)?.originId === hoverOrigin.current) clearTimeout(releaseTimer.current);
    else if (hoverOrigin.current) {
      clearTimeout(releaseTimer.current);
      releaseTimer.current = setTimeout(() => setHoverOrigin(null), GLOBE.relatedArcHoverReleaseMs);
    }
  }
  function placeTooltip() {
    const element = tooltip.current, surface = stage.current;
    if (!element || !surface) return;
    const bounds = surface.getBoundingClientRect();
    element.style.transform = `translate(${pointer.current.x - bounds.left + 14}px, ${pointer.current.y - bounds.top + 14}px)`;
  }
  useEffect(placeTooltip, [hoveredArcId]);
  useEffect(() => () => clearTimeout(releaseTimer.current), []);

  // Animate arcs and resolve hover once per frame, never per pointer event.
  useEffect(() => {
    if (!ready || !globe.current) return;
    const controls = globe.current.controls();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      animatePings(now, media.matches);
      for (const [id, arc] of arcs.current) {
        if (arc.state === "grow") {
          arc.progress = media.matches ? 1 : arc.from + (1 - arc.from) * growProgress(now - arc.start, GLOBE.relatedArcGrowMs);
          if (arc.progress >= 1) arc.state = "shown";
        } else if (arc.state === "retract") {
          arc.progress = media.matches ? 0 : retractProgress(arc.from, now - arc.start, GLOBE.relatedArcRetractMs);
          if (arc.progress <= 0) { disposeArc(arc); arcs.current.delete(id); continue; }
        }
        const target = arc.state !== "retract" && (id === hoveredArcRef.current || id === openLinkRef.current) ? 1 : 0;
        const step = media.matches ? 1 : elapsed / GLOBE.relatedArcHoverMs;
        arc.glow = target > arc.glow ? Math.min(target, arc.glow + step) : Math.max(target, arc.glow - step);
        for (const uniforms of arc.uniforms) {
          uniforms.progress.value = arc.progress;
          uniforms.glow.value = arc.glow;
          uniforms.growing.value = arc.state === "grow" ? 1 : 0;
        }
      }
      const current = pointer.current;
      if (current.dirty) {
        current.dirty = false;
        const press = globePress.current;
        const dragging = !!press && press.maxDistance > press.tolerance;
        applyHover(current.inside && !dragging ? pickAt(current.x, current.y) : null);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Rotation and zoom move things under a still pointer.
    const moved = () => { pointer.current.dirty = true; };
    controls.addEventListener("change", moved);
    return () => { cancelAnimationFrame(frame); controls.removeEventListener("change", moved); };
    // pickAt and applyHover read only refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // CLUSTERS (explore view) — pins closer than clusterRadiusPx on screen merge into a
  // numbered bubble, recomputed whenever the camera moves. The selection never clusters.
  const eventsById = useMemo(() => new Map(allEvents.map(event => [event.id, event])), [allEvents]);
  const clusterCandidates = useMemo(() => view === "explore"
    ? [...new Map([...events, ...selectedEvents].map(event => [event.id, event])).values()]
      .filter(event => event.id !== selectedEvent?.id)
      .sort((a, b) => b.significance - a.significance || a.id.localeCompare(b.id))
    : [], [view, events, selectedEvents, selectedEvent?.id]);
  const [clusters, setClusters] = useState<PinCluster[]>([]);
  const clusteredIds = useRef(new Set<string>());
  const clusterButtons = useRef(new Map<string, HTMLButtonElement>());
  const clusterPositions = useRef(new Map<string, { x: number; y: number }>());
  const placeCluster = (key: string, button: HTMLButtonElement) => {
    const position = clusterPositions.current.get(key);
    if (position) button.style.transform = `translate(${position.x}px, ${position.y}px) translate(-50%, -50%)`;
  };
  useEffect(() => {
    const instance = globe.current;
    if (!ready || !instance || !container.current || !stage.current) return;
    const canvas = container.current, surface = stage.current;
    let frame = 0, dirty = true, signature: string | null = null; // the first pass always publishes
    const mark = () => { dirty = true; };
    const controls = instance.controls();
    controls.addEventListener("change", mark);
    const observer = new ResizeObserver(mark);
    observer.observe(canvas);
    const tick = () => {
      if (dirty) {
        dirty = false;
        const canvasBounds = canvas.getBoundingClientRect(), stageBounds = surface.getBoundingClientRect();
        const offsetX = canvasBounds.left - stageBounds.left, offsetY = canvasBounds.top - stageBounds.top;
        const camera = instance.camera().position, radius = instance.getGlobeRadius();
        const screen: ScreenPin[] = [];
        for (const event of clusterCandidates) {
          const surfacePoint = instance.getCoords(event.lat, event.lng);
          if (new Vector3(surfacePoint.x, surfacePoint.y, surfacePoint.z).normalize().dot(camera) <= radius + 0.5) continue; // far side
          const point = instance.getScreenCoords(event.lat, event.lng, PIN.height);
          screen.push({ id: event.id, x: point.x + offsetX, y: point.y + offsetY, lat: event.lat, lng: event.lng });
        }
        const groups = clusterScreenPins(screen, GLOBE.clusterRadiusPx).filter(group => group.ids.length > 1);
        clusteredIds.current = new Set(groups.flatMap(group => group.ids));
        clusterPositions.current = new Map(groups.map(group => [group.key, { x: group.x, y: group.y }]));
        clusterButtons.current.forEach((button, key) => placeCluster(key, button));
        const next = groups.map(group => group.ids.join(",")).join("|");
        if (next !== signature) { signature = next; setClusters(groups); }
      }
      // Every frame: three-globe rebuilds pin objects a moment after their data changes.
      for (const point of pointsRef.current) {
        const pin = (point as typeof point & { __threeObjObject?: Object3D }).__threeObjObject;
        if (pin) pin.visible = !clusteredIds.current.has(point.id);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      controls.removeEventListener("change", mark);
      observer.disconnect();
    };
  }, [ready, clusterCandidates, points]);

  function openClusterAt(cluster: PinCluster, button: HTMLButtonElement) {
    const instance = globe.current;
    if (!instance || !stage.current || !container.current) return;
    setOpenLink(null);
    const members = cluster.ids.map(id => eventsById.get(id)).filter((event): event is Event => !!event);
    // Too many to list: fly in until they spread apart. Identical coordinates never
    // spread, so those always list.
    if (members.length > GLOBE.clusterOpenMax && !cluster.colocated) {
      setOpenCluster(null);
      const { center, angle } = angularSpread(members);
      const camera = instance.camera() as PerspectiveCamera;
      const focal = container.current.clientHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
      const altitude = spreadAltitude({
        angle, focalPx: focal, currentAltitude: instance.pointOfView().altitude, minAltitude: GLOBE.minZoomAltitude,
        targetPx: GLOBE.clusterRadiusPx * Math.sqrt(members.length) * GLOBE.clusterSpreadFactor,
      });
      instance.pointOfView({ lat: clampViewLat(center.lat, GLOBE.maxTiltDegrees), lng: center.lng, altitude }, GLOBE.clusterZoomMs);
      return;
    }
    const bounds = button.getBoundingClientRect(), stageBounds = stage.current.getBoundingClientRect();
    setOpenCluster({ ids: cluster.ids, x: bounds.left + bounds.width / 2 - stageBounds.left, y: bounds.top + bounds.height / 2 - stageBounds.top, width: stageBounds.width, height: stageBounds.height });
  }

  // SPOTLIGHT (explore view) — while idly rotating with nothing selected, now and then one
  // significant event near the middle of the view gets a brief headline card.
  const spotlightRecent = useRef<string[]>([]);
  useEffect(() => {
    if (!ready || view !== "explore" || !spinning || selectedEvent || openCluster) return;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      const instance = globe.current, canvas = container.current;
      if (!instance || !canvas) return;
      const camera = instance.camera().position, radius = instance.getGlobeRadius();
      const candidates = events.map(event => {
        const surfacePoint = instance.getCoords(event.lat, event.lng);
        const point = instance.getScreenCoords(event.lat, event.lng);
        return { id: event.id, significance: event.significance, x: point.x, y: point.y, front: new Vector3(surfacePoint.x, surfacePoint.y, surfacePoint.z).normalize().dot(camera) > radius + 0.5 };
      });
      const id = pickSpotlight(candidates, canvas.clientWidth, canvas.clientHeight, new Set(spotlightRecent.current));
      if (!id) return;
      spotlightRecent.current = [...spotlightRecent.current, id].slice(-GLOBE.spotlightMemory);
      setSpotlight(events.find(event => event.id === id) ?? null);
      clearTimeout(hide);
      hide = setTimeout(() => setSpotlight(null), GLOBE.spotlightShowMs);
    }, GLOBE.spotlightEveryMs);
    return () => { clearInterval(timer); clearTimeout(hide); };
  }, [ready, view, spinning, selectedEvent, openCluster, events]);

  // Escape closes the innermost layer: connection card, then cluster list, then selection.
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openLink) setOpenLink(null);
      else if (openCluster) setOpenCluster(null);
      else if (selectedEvent) onSelect(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [openLink, openCluster, selectedEvent, onSelect]);

  // HEADLINES BRIEFING — ‹ ›, the arrow keys and the tour step through the headlines from
  // north to south like a feed; each selection flies the camera there (focus effect above).
  const tourStops = useMemo(() => curated ? tourOrder(headlineEvents) : [], [view, headlineEvents]);
  const stopIndex = selectedEvent ? tourStops.findIndex(event => event.id === selectedEvent.id) : -1;
  const [tour, setTour] = useState<"off" | "playing" | "paused">("off");
  function stepHeadline(delta: number) {
    if (!tourStops.length) return;
    const from = stopIndex < 0 ? (delta > 0 ? -1 : 0) : stopIndex;
    setOpenLink(null);
    setOpenCluster(null);
    onSelect({ kind: "event", event: tourStops[(from + delta + tourStops.length) % tourStops.length] });
  }
  function startTour() {
    if (stopIndex < 0 && tourStops.length) onSelect({ kind: "event", event: tourStops[0] });
    setTour("playing");
  }
  /** Re-centre on demand (selection already centres once; this brings it back after a drag). */
  function centerOn(target: Event) {
    const instance = globe.current;
    if (instance) instance.pointOfView({ lat: clampViewLat(target.lat, GLOBE.maxTiltDegrees), lng: target.lng, altitude: instance.pointOfView().altitude }, GLOBE.relatedFocusMs);
  }
  // The tour ends with the briefing (closed or deselected) or when leaving Headlines.
  useEffect(() => { if (!curated || !selectedEvent) setTour("off"); }, [view, selectedEvent]);
  // Playing: advance after each story's dwell time. Manual steps restart the clock.
  useEffect(() => {
    if (tour !== "playing" || !selectedEvent) return;
    const timer = setTimeout(() => stepHeadline(1), GLOBE.tourStepMs);
    return () => clearTimeout(timer);
    // stepHeadline reads the current selection and order, both keyed here by the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, selectedEvent?.id]);
  // Dragging or zooming the globe pauses the tour; the controls and cards do not.
  useEffect(() => {
    const canvas = container.current;
    if (tour !== "playing" || !canvas) return;
    const pause = () => setTour("paused");
    canvas.addEventListener("pointerdown", pause, true);
    canvas.addEventListener("wheel", pause, { capture: true, passive: true });
    return () => { canvas.removeEventListener("pointerdown", pause, true); canvas.removeEventListener("wheel", pause, true); };
  }, [tour]);
  // ← → step through the briefing while it is open.
  useEffect(() => {
    if (!curated || !selectedEvent) return;
    const keys = (event: KeyboardEvent) => {
      // Leave arrow keys to form fields and to the tab bars, which use them to switch tabs.
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [role=tablist]")) return;
      if (event.key === "ArrowRight") { event.preventDefault(); stepHeadline(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); stepHeadline(-1); }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedEvent?.id, tourStops]);

  // Update only projected DOM positions each frame, not React state or backend data.
  useEffect(() => {
    if (!ready || !globe.current || !stage.current || !container.current) return;
    let frame = 0;
    let dirty = true;
    const instance = globe.current!;
    const invalidate = () => { dirty = true; };
    const observer = new ResizeObserver(invalidate);
    observer.observe(stage.current!);
    observer.observe(container.current!);
    cards.current.forEach(card => observer.observe(card));
    instance.controls().addEventListener("change", invalidate);
    window.addEventListener("scroll", invalidate, true);
    // Native polygon groups expose their current elevation. Read one group per
    // country, then move each fixed-size POI with that surface (no POI tween).
    const countrySurfaces = new Map<string, { __currentTargetD?: { alt: number } }>();
    const borderGroups: { object: import("three").Object3D; countryId: string }[] = [];
    instance.scene().traverse(object => {
      const path = object as typeof object & { __globeObjType?: string; __data?: { countryId?: string } };
      if (path.__globeObjType === "path" && path.__data?.countryId) borderGroups.push({ object, countryId: path.__data.countryId });
      const polygon = object as typeof object & { __globeObjType?: string; __data?: { data?: { id: string } }; __currentTargetD?: { alt: number } };
      if (polygon.__globeObjType === "polygon" && polygon.__data?.data?.id) countrySurfaces.set(polygon.__data.data.id, polygon);
    });
    const animationUntil = performance.now() + GLOBE.countryAnimationMs + 100;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lastFrame = performance.now();
    const update = () => {
      const instance = globe.current;
      if ((dirty || dragNeedsUpdate.current || drag.current || performance.now() < animationUntil) && instance && stage.current && container.current) {
        dirty = false;
        dragNeedsUpdate.current = false;
        const stageRect = stage.current.getBoundingClientRect();
        const canvasRect = container.current.getBoundingClientRect();
        const offsetX = canvasRect.left - stageRect.left;
        const offsetY = canvasRect.top - stageRect.top;
        const camera = instance.camera().position;
        const radius = instance.getGlobeRadius();
        const cameraObject = instance.camera() as PerspectiveCamera;
        const focal = canvasRect.height / (2 * Math.tan(cameraObject.fov * Math.PI / 360));
        const screenRadius = focal * radius / Math.sqrt(camera.lengthSq() - radius * radius);
        const centerX = offsetX + canvasRect.width / 2;
        const centerY = offsetY + canvasRect.height / 2;
        if (orbSurface.current) {
          orbSurface.current.style.transform = `translate(-50%, -50%) scale(${2 * screenRadius / GLOBE.orbRenderSize})`;
          orbSurface.current.style.visibility = "visible";
        }
        // Borders are built at base altitude and scaled by the *same* live
        // polygon elevation, eliminating independent border interpolation/tweens.
        for (const border of borderGroups) {
          const altitude = countrySurfaces.get(border.countryId)?.__currentTargetD?.alt ?? GLOBE.landAltitude;
          border.object.scale.setScalar((1 + altitude + GLOBE.borderAltitude - GLOBE.landAltitude) / (1 + GLOBE.borderAltitude));
        }
        for (const point of points) {
          const marker = point as typeof point & { __threeObjObject?: Object3D };
          const pin = marker.__threeObjObject;
          if (!pin) continue;
          const countryId = pointCountries.get(point.id);
          const surfaceAltitude = countryId ? countrySurfaces.get(countryId)?.__currentTargetD?.alt ?? GLOBE.landAltitude : 0;
          const base = instance.getCoords(point.lat, point.lng, surfaceAltitude);
          pin.position.set(base.x, base.y, base.z);
          // Pin size and orientation remain constant; only the base follows the country.
        }
        const visible: { item: Callout; x: number; y: number; front: boolean; side: "left" | "right"; world: Vector3 }[] = [];
        const pinScales = new Map(points.map(point => [point.id, point.scale]));
        for (const item of callouts) {
          const surface = instance.getCoords(item.lat, item.lng);
          const normal = new Vector3(surface.x, surface.y, surface.z).normalize();
          // Perspective horizon: a point is visible only when n·camera > radius.
          const front = normal.dot(camera) > radius + 0.5;
          const countryId = pointCountries.get(item.id);
          const surfaceAltitude = countryId ? countrySurfaces.get(countryId)?.__currentTargetD?.alt ?? GLOBE.landAltitude : 0;
          // Connectors meet the top of the pin at its drawn size.
          const altitude = surfaceAltitude + PIN.height * (pinScales.get(item.id) ?? 1);
          const point = instance.getScreenCoords(item.lat, item.lng, altitude);
          const card = cards.current.get(item.id), pin = pins.current.get(item.id), path = paths.current.get(item.id);
          if (!card || !pin || !path) continue;
          // Retained selections stay readable even when their layer is disabled.
          const x = item.retained && !expandedCards.has(item.id) ? GLOBE.cardEdgePaddingPx : point.x + offsetX;
          const y = item.retained && !expandedCards.has(item.id) ? centerY : point.y + offsetY;
          const shown = !item.retained && front && point.x > 0 && point.x < canvasRect.width && point.y > 0 && point.y < canvasRect.height;
          card.hidden = false;
          // Events are marked by their 3D pins; numbered markers are reserved for Explore's
          // clusters, so only a picked location keeps one. Connectors follow `onscreen`.
          pin.dataset.onscreen = String(shown);
          pin.hidden = !shown || !!item.event;
          path.style.display = item.retained || !front ? "none" : "";
          const top3d = instance.getCoords(item.lat, item.lng, altitude);
          visible.push({ item, x, y, front: front || !!item.retained || expandedCards.has(item.id), side: x < centerX ? "left" : "right", world: new Vector3(top3d.x, top3d.y, top3d.z) });
        }
        // Release hidden cards, then move existing rectangles with their pins before
        // finding space for newcomers. Each card keeps a fixed on-screen offset from its
        // pin, so zooming never pushes it farther away (or behind the camera).
        const activeIds = new Set(visible.filter(entry => entry.front).map(entry => entry.item.id));
        for (const id of cardPlacements.current.keys()) {
          if (!activeIds.has(id)) cardPlacements.current.delete(id);
        }
        // A card that rotated away rejoins its ring (and enters fresh) next time.
        for (const id of manualCards.current) if (!activeIds.has(id)) manualCards.current.delete(id);
        for (const id of drawn.current.keys()) if (!activeIds.has(id)) drawn.current.delete(id);
        for (const { item, x, y } of visible) {
          pinScreen.current.set(item.id, { x, y });
          const placement = cardPlacements.current.get(item.id);
          if (placement && drag.current?.id !== item.id && !expandedCards.has(item.id)) {
            placement.left = x + placement.offsetX;
            placement.top = y + placement.offsetY;
          }
        }
        // Collapsed headline cards are narrower than the open details card.
        visible.forEach(({ item }) => {
          const card = cards.current.get(item.id)!;
          card.style.width = `${Math.min(expandedCards.has(item.id) ? 278 : GLOBE.headlineCardWidthPx, stageRect.width - 2 * GLOBE.cardEdgePaddingPx)}px`;
          card.style.height = "auto";
          card.style.maxHeight = `${Math.max(1, canvasRect.height - 2 * GLOBE.cardEdgePaddingPx)}px`;
        });
        // One measurement phase after visibility updates; all position writes follow.
        // Layout dimensions ignore visual perspective, avoiding scale feedback each frame.
        const measurements = new Map(visible.map(({ item }) => {
          const card = cards.current.get(item.id)!;
          return [item.id, { width: card.offsetWidth, height: card.offsetHeight }];
        }));
        const headlineCenters = new Map(visible.map(({ item }) => {
          const card = cards.current.get(item.id)!;
          const title = card.querySelector<HTMLButtonElement>(".card-title")!;
          return [item.id, { x: card.clientLeft + title.offsetLeft - card.scrollLeft + title.offsetWidth / 2, y: card.clientTop + title.offsetTop - card.scrollTop + title.offsetHeight / 2 }];
        }));
        // A newly expanded card may need a new slot; neighbors never move for it.
        const grownCards: string[] = [];
        for (const { item } of visible) {
          const placement = cardPlacements.current.get(item.id);
          const measurement = measurements.get(item.id)!;
          if (placement) {
            if (measurement.height > placement.height + 1) grownCards.push(item.id);
            placement.width = measurement.width; placement.height = measurement.height;
          }
        }
        for (const id of grownCards) {
          const rect = cardPlacements.current.get(id)!;
          if ([...cardPlacements.current].some(([otherId, other]) => otherId !== id && cardsOverlap(rect, other))) {
            // Never discard the current slot before a replacement exists.
            const replacement = placeCard(rect, [...cardPlacements.current].filter(([otherId]) => otherId !== id).map(([, other]) => other), stageRect.width, canvasRect.height, GLOBE.cardEdgePaddingPx, 16, { x: centerX, y: centerY, radius: screenRadius * GLOBE.cardCenterExclusion, strict: true });
            if (replacement) {
              Object.assign(rect, replacement);
              rebaseCard(id);
            }
          }
        }
        const pad = GLOBE.cardEdgePaddingPx;
        const frameNow = performance.now();
        const ease = reducedMotion.matches ? 1 : easeFactor(frameNow - lastFrame, GLOBE.cardEaseMs);
        lastFrame = frameNow;
        const onscreen = (id: string) => pins.current.get(id)!.dataset.onscreen === "true";
        // Collapsed event cards ride their pin's ring. The open details card, dragged cards
        // and retained selections keep a placement instead, and the ring flows around them.
        const ringManaged = (item: Callout) => !!item.event && !item.retained && !expandedCards.has(item.id)
          && !manualCards.current.has(item.id) && drag.current?.id !== item.id;
        type Entry = typeof visible[number];
        // Draw one card (or hide it with rect = null). Connectors end at the headline for
        // placed cards, and at the edge facing the pin for ring cards.
        const draw = ({ item, x, y, side }: Entry, rect: Rect | null, attach: "headline" | "bottom" | "top") => {
          const card = cards.current.get(item.id)!, path = paths.current.get(item.id)!;
          card.style.visibility = rect ? "visible" : "hidden";
          card.inert = !rect;
          card.setAttribute("aria-hidden", String(!rect));
          path.style.display = rect && (expandedCards.has(item.id) || (!item.retained && onscreen(item.id))) ? "" : "none";
          pins.current.get(item.id)!.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
          if (!rect) { drawn.current.delete(item.id); return; }
          drawn.current.set(item.id, { left: rect.left, top: rect.top });
          card.style.left = "0px";
          card.style.top = "0px";
          card.style.transform = `translate(${rect.left}px, ${rect.top}px)`; // always flat to the viewer
          card.dataset.side = side;
          if (item.retained && !expandedCards.has(item.id)) return;
          const headline = headlineCenters.get(item.id)!;
          const end = attach === "headline"
            ? { x: rect.left + headline.x, y: rect.top + headline.y }
            : { x: rect.left + rect.width / 2, y: attach === "bottom" ? rect.top + rect.height : rect.top };
          path.setAttribute("d", `M ${x} ${y} L ${end.x} ${end.y}`);
        };

        // 1) Placed cards, kept inside the visible area; they become obstacles for the ring.
        const fixedRects: Rect[] = [];
        for (const entry of visible) {
          const { item, x, y, front, side } = entry;
          if (ringManaged(item)) { cardPlacements.current.delete(item.id); continue; }
          const { width, height } = measurements.get(item.id)!;
          let placement = cardPlacements.current.get(item.id);
          if (front && !placement) {
            // A card leaving the ring (opened or dragged) starts exactly where it was drawn.
            const from = drawn.current.get(item.id);
            const chosen = from ? { left: from.left, top: from.top, width, height } : placeCard({
              left: item.retained ? pad : side === "left" ? x - GLOBE.pinToCardDistancePx - width : x + GLOBE.pinToCardDistancePx,
              top: y - height / 2, width, height,
            }, [...cardPlacements.current.values()], stageRect.width, canvasRect.height, pad, 16, { x: centerX, y: centerY, radius: screenRadius * GLOBE.cardCenterExclusion, strict: true });
            if (chosen) {
              placement = { ...chosen, offsetX: chosen.left - x, offsetY: chosen.top - y };
              cardPlacements.current.set(item.id, placement);
            }
          }
          // The open details card and retained selections stay readable when their pin is off screen.
          if (!placement || !front || !(onscreen(item.id) || expandedCards.has(item.id) || item.retained)) { draw(entry, null, "headline"); continue; }
          const left = Math.max(pad, Math.min(placement.left, stageRect.width - width - pad));
          const top = Math.max(pad, Math.min(placement.top, canvasRect.height - height - pad));
          placement.shown = { left, top };
          const rect = { left, top, width, height };
          fixedRects.push(rect);
          draw(entry, rect, "headline");
        }

        // 2) Ring cards: project each pin's ring anchor, lay the cards out most significant
        //    first around the placed ones, then glide each toward its target.
        const ringEntries = visible.filter(entry => ringManaged(entry.item));
        const toCamera = camera.clone().normalize();
        const north = instance.getCoords(90, 0, 0);
        const tilt = GLOBE.cardRingTiltDegrees * Math.PI / 180;
        const ringCards: RingCard[] = [];
        for (const { item, front, world } of ringEntries) {
          if (!front || !onscreen(item.id)) continue;
          // Split at the default viewing latitude: the visual "middle" of the globe as seen.
          const below = hangsBelow(item.lat, GLOBE.initialView.lat);
          const anchor = ringAnchor([world.x, world.y, world.z], [north.x, north.y, north.z], [toCamera.x, toCamera.y, toCamera.z], tilt, below, GLOBE.cardRingLift);
          const projected = new Vector3(...anchor).project(cameraObject);
          if (projected.z > 1) continue; // behind the camera at extreme zoom
          const { width, height } = measurements.get(item.id)!;
          ringCards.push({
            id: item.id, width, height, below, priority: item.event!.significance,
            anchorX: offsetX + (projected.x + 1) / 2 * canvasRect.width,
            anchorY: offsetY + (1 - projected.y) / 2 * canvasRect.height,
          });
        }
        // An open details panel takes space from the cards, so none slide underneath it:
        // width when it is docked right, height when it is a bottom sheet (narrow screens).
        const panel = detailsPanel.current?.getBoundingClientRect();
        const docked = panel && panel.left - stageRect.left > stageRect.width / 2;
        const usableWidth = panel && docked ? Math.min(stageRect.width, panel.left - stageRect.left + pad - GLOBE.cardRingGapPx) : stageRect.width;
        const usableHeight = panel && !docked ? Math.min(canvasRect.height, panel.top - stageRect.top + pad - GLOBE.cardRingGapPx) : canvasRect.height;
        const targets = layoutRingCards(ringCards, fixedRects, { width: usableWidth, height: usableHeight, pad }, GLOBE.cardRingGapPx);
        const hanging = new Map(ringCards.map(card => [card.id, card.below]));
        for (const entry of ringEntries) {
          const target = targets.get(entry.item.id);
          if (!target) { draw(entry, null, "bottom"); continue; }
          const previous = drawn.current.get(entry.item.id);
          const left = previous ? previous.left + (target.left - previous.left) * ease : target.left;
          const top = previous ? previous.top + (target.top - previous.top) * ease : target.top;
          if (Math.abs(target.left - left) > 0.5 || Math.abs(target.top - top) > 0.5) dirty = true; // keep gliding
          draw(entry, { ...target, left, top }, hanging.get(entry.item.id) ? "top" : "bottom");
        }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      instance.controls().removeEventListener("change", invalidate);
      window.removeEventListener("scroll", invalidate, true);
    };
  }, [ready, callouts, expandedCards, selectedIds, points, pointCountries]);

  // Data stays loaded while zoomed in (the mesh is hidden) so zooming out needs no new density pass.

  function select(item: Callout) {
    if (item.event) toggleEvent(item.event);
    else onSelect({ kind: "location", location: { lat: item.lat, lng: item.lng } });
  }

  // After a card moves away from its pin (dragged, or re-slotted when it grew), keep
  // following the pin from wherever the card now sits.
  function rebaseCard(id: string) {
    const placement = cardPlacements.current.get(id), pin = pinScreen.current.get(id);
    if (!placement || !pin) return;
    placement.offsetX = placement.left - pin.x;
    placement.offsetY = placement.top - pin.y;
  }
  function startCardDrag(event: ReactPointerEvent<HTMLElement>, item: Callout) {
    if (!event.isPrimary || event.button !== 0) return;
    let placement = cardPlacements.current.get(item.id);
    const fromRing = !placement;
    if (!placement) {
      // A ring card gets a placement where it is drawn; only a real drag keeps it off the ring.
      const at = drawn.current.get(item.id), pin = pinScreen.current.get(item.id), card = cards.current.get(item.id);
      if (!at || !pin || !card) return;
      placement = { left: at.left, top: at.top, width: card.offsetWidth, height: card.offsetHeight, offsetX: at.left - pin.x, offsetY: at.top - pin.y };
      cardPlacements.current.set(item.id, placement);
    }
    event.stopPropagation();
    suppressClick.current = null;
    // Capture on the original child so an ordinary button/link click keeps its target.
    const captureTarget = event.target as Element;
    // Start from where the card is drawn, so a card held inside the view never jumps.
    const from = placement.shown ?? placement;
    drag.current = { id: item.id, pointerId: event.pointerId, captureTarget, startX: event.clientX, startY: event.clientY, left: from.left, top: from.top, moved: false, fromRing };
    captureTarget.setPointerCapture(event.pointerId);
  }
  function moveCardDrag(event: ReactPointerEvent<HTMLElement>, item: Callout) {
    const current = drag.current;
    if (!current || current.id !== item.id || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    current.moved = true;
    event.currentTarget.dataset.dragging = "true";
    event.stopPropagation();
    const placement = cardPlacements.current.get(item.id);
    if (placement) { placement.left = current.left + dx; placement.top = current.top + dy; }
  }
  function endCardDrag(event: ReactPointerEvent<HTMLElement>, item: Callout) {
    const current = drag.current;
    if (!current || current.id !== item.id || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const placement = cardPlacements.current.get(item.id);
    if (current.moved && placement) {
      rebaseCard(item.id);
      manualCards.current.add(item.id); // dragged off its ring: stays where it was put
      suppressClick.current = item.id;
    } else if (current.fromRing) {
      cardPlacements.current.delete(item.id); // just a click: back on the ring
    }
    drag.current = null;
    dragNeedsUpdate.current = true;
    delete event.currentTarget.dataset.dragging;
    if (current.captureTarget.hasPointerCapture(event.pointerId)) current.captureTarget.releasePointerCapture(event.pointerId);
  }

  function beginGlobePress(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) { globePress.current = null; return; }
    globePress.current = { id: event.pointerId, x: event.clientX, y: event.clientY, maxDistance: 0, tolerance: event.pointerType === "mouse" ? 6 : 10 };
  }
  function trackGlobePress(event: ReactPointerEvent<HTMLDivElement>) {
    const press = globePress.current;
    if (press?.id === event.pointerId) press.maxDistance = Math.max(press.maxDistance, Math.hypot(event.clientX - press.x, event.clientY - press.y));
  }
  function finishGlobePress(event: ReactPointerEvent<HTMLDivElement>) {
    trackGlobePress(event);
    const press = globePress.current;
    globePress.current = null;
    const instance = globe.current;
    if (!press || press.id !== event.pointerId || press.maxDistance > press.tolerance || !instance) return;
    const bounds = instance.renderer().domElement.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
    instance.camera().updateMatrixWorld();
    instance.scene().updateMatrixWorld(true);
    // Arcs open their connection card; pins still beat arcs, and any other click closes it.
    const pick = pickAt(event.clientX, event.clientY);
    const arc = pick?.kind === "arc" ? arcs.current.get(pick.id) : undefined;
    if (pick?.kind === "arc" && arc && stage.current) {
      const stageBounds = stage.current.getBoundingClientRect();
      setOpenLink({ id: pick.id, origin: arc.originId, x: event.clientX - stageBounds.left, y: event.clientY - stageBounds.top, width: stageBounds.width, height: stageBounds.height });
      return;
    }
    setOpenLink(null);
    if (pick?.kind === "pin") {
      const point = pointsRef.current.find(item => item.id === pick.id);
      if (point) toggleEvent(allEvents.find(item => item.id === point.id) ?? point);
      return;
    }
    setOpenCluster(null);
    if (curated) return; // Headlines is deliberately limited: no country selection
    clickRaycaster.setFromCamera(new Vector2(2 * (event.clientX - bounds.left) / bounds.width - 1, 1 - 2 * (event.clientY - bounds.top) / bounds.height), instance.camera());
    type PickObject = Object3D & { __globeObjType?: string; __data?: unknown };
    for (const hit of clickRaycaster.intersectObjects(instance.scene().children, true)) {
      let owner: PickObject | null = hit.object;
      while (owner && !owner.__globeObjType) owner = owner.parent;
      if (!owner || owner.__globeObjType === "object") continue; // pins were resolved above
      if (owner.__globeObjType === "polygon") {
        selectCountry((owner.__data as { data: CountryFeature }).data);
        return;
      }
      if (owner.__globeObjType === "path") {
        const country = countries.features.find(country => country.id === (owner.__data as { countryId: string }).countryId);
        if (country) { selectCountry(country); return; }
      }
      if (owner.__globeObjType === "globe") {
        const location = instance.toGeoCoords(hit.point);
        selectCoordinates(location.lat, location.lng);
        return;
      }
    }
  }

  return <div className="earth-stage" ref={stage} style={{ "--connector-width": `${GLOBE.connectorWidthPx}px` } as CSSProperties}>
    {selection?.kind === "event" && view === "explore" && <div className="earth-controls"><button onClick={clearSelection}>Clear selection</button></div>}
    {curated && selectedEvent && <DetailsPanel key={selectedEvent.id} panelRef={detailsPanel} event={selectedEvent} fixture={fixture} onClose={clearSelection}
      personal={personal} reasons={view === "feed" ? headlineEvents.find(item => item.id === selectedEvent.id)?.reasons : undefined}
      position={stopIndex >= 0 ? { index: stopIndex, total: tourStops.length } : null}
      rank={{ place: rankOf(selectedEvent.id, headlineEvents), of: headlineEvents.length }}
      onPrev={() => stepHeadline(-1)} onNext={() => stepHeadline(1)} onCenter={() => centerOn(selectedEvent)} />}
    {/* My Feed: "For you" (ranked by your profile) or your reading list, under the tabs. */}
    {view === "feed" && feed && <>
      <div className="feed-sections" role="tablist" aria-label="My Feed sections" onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") feed.onSection(feed.section === "saved" ? "for-you" : "saved");
      }}>
        <button role="tab" aria-selected={feed.section === "for-you"} tabIndex={feed.section === "for-you" ? 0 : -1} onClick={() => feed.onSection("for-you")}>For you</button>
        <button role="tab" aria-selected={feed.section === "saved"} tabIndex={feed.section === "saved" ? 0 : -1} onClick={() => feed.onSection("saved")}>
          Reading list <span className="feed-count">{feed.saved}</span>
        </button>
      </div>
      {(feed.loading || feed.error || headlineEvents.length === 0) && <p className="feed-status" role="status">
        {feed.loading ? "Finding stories for you…"
          : feed.error ? feed.error
          : feed.section === "saved" ? "Nothing saved yet. Use “Save to reading list” on any story, in any tab."
          : "Nothing matches your interests yet. Try “More like this” on stories you like."}
      </p>}
      <button className="feed-reset" onClick={feed.onStartOver} title="Forget interests, saves and history, and pick interests again">Start over</button>
    </>}
    {/* The tour sits under the feed tabs: a quiet "start" pill, then a small control bar. */}
    {curated && tourStops.length > 0 && (tour === "off"
      ? <button className="tour-start" data-view={view} onClick={startTour}><span aria-hidden="true">▶</span> {view === "feed" ? feed?.section === "saved" ? "Tour my reading list" : "Tour my feed" : "Tour the headlines"}</button>
      : <div className="tour-bar" role="group" aria-label={view === "feed" ? "My Feed tour" : "Headlines tour"} data-view={view}>
        <button onClick={() => stepHeadline(-1)} aria-label="Previous headline">‹</button>
        <button onClick={() => setTour(state => state === "playing" ? "paused" : "playing")} aria-label={tour === "playing" ? "Pause tour" : "Resume tour"}>{tour === "playing" ? "❚❚" : "▶"}</button>
        <button onClick={() => stepHeadline(1)} aria-label="Next headline">›</button>
        <span className="tour-status">{stopIndex + 1} / {tourStops.length}{tour === "paused" ? " · paused" : ""}</span>
        <button onClick={() => setTour("off")} aria-label="End tour">✕</button>
        <span className="tour-progress" key={`${selectedEvent?.id}-${tour}`} data-state={tour} style={{ animationDuration: `${GLOBE.tourStepMs}ms` }} />
      </div>)}
    <div className="earth-canvas" ref={container} role="region" aria-label="Interactive Earth. Drag to rotate, scroll to zoom, click to select a location.">
      <div ref={orbSurface} className="earth-orb-surface" aria-hidden="true">
        <FluidOrb size={GLOBE.orbRenderSize} color={GLOBE.orbColor} topColor={GLOBE.orbTopColor} maxFps={GLOBE.orbMaxFps} maxPixelRatio={GLOBE.orbMaxPixelRatio} edgeShade={GLOBE.continentEdgeShadeStrength} />
      </div>
      <div className="earth-renderer" onPointerDownCapture={beginGlobePress} onPointerMoveCapture={trackGlobePress}
        onPointerUpCapture={finishGlobePress} onPointerCancelCapture={() => { globePress.current = null; }}
        onPointerMove={event => { pointer.current = { x: event.clientX, y: event.clientY, inside: true, dirty: true }; placeTooltip(); }}
        onPointerLeave={() => { globePress.current = null; pointer.current = { ...pointer.current, inside: false, dirty: true }; }}>
      {size.width > 0 && <Globe ref={globe} width={size.width} height={size.height} rendererConfig={rendererConfig}
        backgroundColor="rgba(0,0,0,0)" globeMaterial={oceanDepthMaterial}
        polygonsData={countries.features} polygonGeoJsonGeometry="geometry"
        polygonCapMaterial={landMaterial} polygonSideMaterial={sideMaterial}
        polygonAltitude={polygonAltitude}
        polygonCapCurvatureResolution={GLOBE.reliefFacetDegrees} polygonsTransitionDuration={GLOBE.countryAnimationMs}
        onPolygonHover={country => setHoveredCountryId(country ? (country as CountryFeature).id : null)}
        pathsData={borders} pathPoints="points" pathPointLat={borderLatitude} pathPointLng={borderLongitude}
        pathPointAlt={GLOBE.borderAltitude} pathColor={countryBorderColor} pathStroke={null}
        pathResolution={360} pathTransitionDuration={0}
        onPathHover={path => setHoveredBorderId(path ? (path as typeof borders[number]).countryId : null)}
        showAtmosphere={false} animateIn={false}
        objectsData={points} objectLat="lat" objectLng="lng" objectAltitude="altitude" objectThreeObject={pinObject}
        onGlobeReady={() => {
          const instance = globe.current;
          if (!instance) return;
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          instance.pointOfView(GLOBE.initialView);
          const sun = new DirectionalLight("#ffffff", GLOBE.sunlightIntensity);
          sun.position.set(-150, 200, 200);
          instance.lights([new AmbientLight("#ffffff", GLOBE.ambientLightIntensity), sun]);
          instance.controls().enablePan = false;
          // Upright Earth: free spin around the poles, tilt toward/away by at most maxTiltDegrees, no roll.
          instance.controls().minPolarAngle = (90 - GLOBE.maxTiltDegrees) * Math.PI / 180;
          instance.controls().maxPolarAngle = (90 + GLOBE.maxTiltDegrees) * Math.PI / 180;
          instance.controls().enableDamping = !reduced;
          instance.renderer().setPixelRatio(Math.min(window.devicePixelRatio, GLOBE.maxPixelRatio));
          setReady(true);
        }}
      />}
      </div>
      {!ready && <div className="earth-loading" role="status">Rendering Earth…</div>}
    </div>
    <svg className="connectors" aria-hidden="true">{callouts.map((item) => <path key={item.id} ref={(node) => { if (node) paths.current.set(item.id, node); else paths.current.delete(item.id); }} stroke={item.color} />)}</svg>
    <div className="pins">{callouts.map((item, index) => <button hidden key={item.id} ref={(node) => { if (node) pins.current.set(item.id, node); else pins.current.delete(item.id); }}
      className="earth-pin" style={{ "--pin-color": item.color } as CSSProperties} aria-label={item.event?.title ?? "Selected location"} onClick={() => select(item)}>{index + 1}</button>)}</div>
    <div className="clusters" aria-label="Grouped events">{clusters.map(cluster => {
      const tone = !selectedEvent ? "" : cluster.ids.some(id => linkedIds.has(id)) ? " is-linked" : " is-dim";
      const zooms = cluster.ids.length > GLOBE.clusterOpenMax && !cluster.colocated;
      const leader = eventsById.get(cluster.key);
      return <button key={cluster.key} className={`earth-cluster${tone}`} style={{ "--pin-color": leader ? eventColor(leader.layerId) : GLOBE.colors.selected } as CSSProperties}
        ref={node => { if (node) { clusterButtons.current.set(cluster.key, node); placeCluster(cluster.key, node); } else clusterButtons.current.delete(cluster.key); }}
        aria-label={zooms ? `${cluster.ids.length} events. Zoom in to separate them` : `${cluster.ids.length} events. Show the list`}
        onClick={event => openClusterAt(cluster, event.currentTarget)}>{cluster.ids.length}</button>;
    })}</div>
    {openCluster && <ClusterPanel events={openCluster.ids.map(id => eventsById.get(id)).filter((event): event is Event => !!event)}
      linkCount={id => linkIndex.get(id)?.length ?? 0} x={openCluster.x} y={openCluster.y} stageWidth={openCluster.width} stageHeight={openCluster.height}
      onPick={event => { setOpenCluster(null); toggleEvent(event); }} onClose={() => setOpenCluster(null)} />}
    <div className="callouts" aria-label="Visible points of interest">{callouts.map((item, index) => {
      const event = item.event;
      const expanded = expandedCards.has(item.id);
      const active = event ? event.id === selectedEvent?.id || selectedIds.has(event.id) : true;
      const href = event && sourceHref(event.sourceUrl);
      return <article hidden key={item.id} ref={(node) => { if (node) cards.current.set(item.id, node); else cards.current.delete(item.id); }} className={`earth-card${active ? " is-selected" : ""}${expanded ? " is-expanded" : " is-collapsed"}`} style={{ "--pin-color": item.color } as CSSProperties}
        onPointerDown={event => startCardDrag(event, item)} onPointerMove={event => moveCardDrag(event, item)}
        onPointerUp={event => endCardDrag(event, item)} onPointerCancel={event => endCardDrag(event, item)}
        onDragStart={event => event.preventDefault()}
        onClickCapture={event => {
          if (suppressClick.current === item.id) {
            suppressClick.current = null;
            event.preventDefault(); event.stopPropagation();
          }
        }}>
        {expanded && <div className="card-category"><span>{event ? LABELS[event.layerId as LayerId] ?? event.layerId : "location"}</span>{fixture && event && <span className="sample-badge">Sample</span>}</div>}
        {/* Thumbnail left, headline and freshness right. Without an image the text takes the row. */}
        <div className="card-headline">
        <Thumbnail src={event?.imageUrl} />
        <div className="card-headline-text">
        <button className="card-title" title={expanded ? "Drag to reposition; click to close and deselect" : "Drag to reposition; click to select"} aria-expanded={expanded}
          onClick={() => {
          // A closing details card resumes following its pin from where it stands.
          if (expanded && !item.retained) rebaseCard(item.id);
          select(item);
        }}>{event?.title ?? "Selected location"}<span className="card-expand-icon" aria-hidden="true">{expanded ? "×" : "+"}</span></button>
        {event && <TimeAgo iso={event.occurredAt} />}
        </div>
        </div>
        {expanded && <>
        {item.retained && <p className="retained-note">Selected event · hidden by map filters</p>}
        {event && <p className="card-summary">{event.summary ?? "No summary provided."}</p>}
        <p className="card-coordinates">{coordinate(item.lat, true)}<br />{coordinate(item.lng, false)}</p>
        {event && <RelatedEventControls key={event.id} event={event} allEvents={allEvents}
          links={links.links ? linkIndex.get(event.id) ?? [] : undefined} error={links.error} onVisit={visitEvent} />}
        {event && personal && <StoryActions event={event} personal={personal} />}
        {event && <p className="card-time">{exactTime(event.occurredAt)}</p>}
        <div className="card-footer">{href ? <a href={href} target="_blank" rel="noreferrer" onClick={() => event && personal?.onSource(event)}>{event!.source.toUpperCase()} ↗</a> : <span>{event?.source.toUpperCase() ?? "Coordinates captured"}</span>}
          {(event ? event.id === selectedEvent?.id : selection?.kind === "location") && <button onClick={clearSelection}>Close</button>}</div>
        </>}
      </article>;
    })}</div>
    {hoveredArcId && linksById.get(hoveredArcId) && <div className="arc-tooltip" ref={tooltip} aria-hidden="true">
      {relationLabel(linksById.get(hoveredArcId)!.relation)} · {Math.round(linksById.get(hoveredArcId)!.confidence * 100)}%
    </div>}
    {openLink && linksById.get(openLink.id) && (() => {
      const link = linksById.get(openLink.id)!;
      const byId = new Map(allEvents.map(item => [item.id, item]));
      return <LinkCard link={link} source={byId.get(link.sourceId)} target={byId.get(link.targetId)}
        x={openLink.x} y={openLink.y} stageWidth={openLink.width} stageHeight={openLink.height}
        onVisit={visitEvent} onClose={closeLink} />;
    })()}
    <p className="earth-hint">Drag to explore <span>·</span> Scroll to zoom <span>·</span> Click a place</p>
  </div>;
}
