"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { AlwaysStencilFunc, AmbientLight, CatmullRomCurve3, TubeGeometry, DirectionalLight, EqualStencilFunc, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, ReplaceStencilOp, Vector2, Vector3, type Material, type Object3D } from "three";
import { LABELS, type LayerId, type HeatmapPoint } from "@/lib/layers";
import type { Event } from "@/lib/api";
import { continentMaterial } from "@/lib/continent-material";
import { cardWorldAnchor } from "@/lib/card-anchor";
import { cardsOverlap, placeCard, type CardRect } from "@/lib/card-placement";
import { countryContains, type CountryFeature } from "@/lib/country-selection";
import countries from "@/data/countries.geojson.json";
import { countryBorders, borderContour } from "@/lib/country-borders";
import { globeClipPlanes } from "@/lib/globe-depth";
import RelatedEventControls from "@/components/related-event-controls";
import FluidOrb from "@/components/ui/fluid-orb";
import { connectTree, pruneBranch, type Connection, floatingArc } from "@/lib/related-events";
import { GLOBE, eventColor } from "@/lib/globe-config";

export type Location = { lat: number; lng: number };
/** Integration hook: these selections are local; they never submit a request. */
export type Selection = { kind: "location"; location: Location } | { kind: "event"; event: Event };
type Callout = Location & { id: string; color: string; event?: Event; retained?: boolean };

const coordinate = (value: number, latitude: boolean) => `${Math.abs(value).toFixed(4)}° ${latitude ? value < 0 ? "S" : "N" : value < 0 ? "W" : "E"}`;
const eventTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }).format(date) + " UTC";
};
const sourceHref = (value: string | null) => {
  try { const url = new URL(value ?? ""); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
};

// Stable accessors prevent unrelated React renders from recalculating density.
const borders = countries.features.flatMap(country => countryBorders([country]).map(points => ({ countryId: country.id, points: borderContour(points, GLOBE.landCurvatureDegrees).map(point => ({ lng: point[0], lat: point[1], countryId: country.id })) })));
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
function clipToLand(mesh: Mesh) {
  mesh.renderOrder = 10;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    material.depthWrite = false;
    material.depthTest = false; // the stencil already limits it to visible land, including raised countries
    material.stencilWrite = true;
    material.stencilWriteMask = 0;
    material.stencilRef = LAND_STENCIL;
    material.stencilFunc = EqualStencilFunc;
  }
}
const heatmapRgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const heatmapLow = heatmapRgb(GLOBE.heatmapLowColor), heatmapHigh = heatmapRgb(GLOBE.heatmapHighColor);
// Density 0 is fully transparent; denser areas warm toward the high color. The
// square root lifts sparse regions so a single dense cluster cannot hide the rest.
function heatmapRamp(density: number) {
  const t = Math.sqrt(Math.min(1, Math.max(0, density)));
  const [red, green, blue] = heatmapLow.map((channel, index) => Math.round(channel + (heatmapHigh[index] - channel) * t));
  return `rgba(${red},${green},${blue},${Math.min(GLOBE.heatmapMaxOpacity, t * GLOBE.heatmapOpacityGain)})`;
}

export default function EventGlobe({ allEvents, events, selectedCountries, onToggleCountry, heatmap, selection, onSelect, rotating, onRotationChange, fixture, resetViewKey, onReadyChange }: {
  allEvents: Event[];
  events: Event[];
  selectedCountries: { id: string; name: string; events: Event[] }[];
  onToggleCountry: (id: string) => void;
  heatmap: HeatmapPoint[];
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  rotating: boolean;
  onRotationChange: (rotating: boolean) => void;
  fixture: boolean;
  /** Increment to return the camera to the initial fitted view. */
  resetViewKey: number;
  onReadyChange: (ready: boolean) => void;
}) {
  // The native sphere keeps ocean picking and far-side occlusion without painting water.
  const oceanDepthMaterial = useMemo(() => new MeshBasicMaterial({ colorWrite: false }), []);
  const orbSurface = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const fittedDistance = useRef<number | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const cardPlacements = useRef(new Map<string, CardRect & { offsetX: number; offsetY: number }>());
  const cardAnchors = useRef(new Map<string, Vector3>());
  const drag = useRef<{ id: string; pointerId: number; captureTarget: Element; startX: number; startY: number; left: number; top: number; moved: boolean } | null>(null);
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
  const heatmapVisible = useRef(true);
  useEffect(() => onReadyChange(ready), [ready, onReadyChange]);
  useEffect(() => {
    if (resetViewKey && globe.current && fittedDistance.current) globe.current.pointOfView({ ...GLOBE.initialView, altitude: fittedDistance.current / globe.current.getGlobeRadius() - 1 });
  }, [resetViewKey]);
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const tick = () => {
      const instance = globe.current, fit = fittedDistance.current;
      if (instance && fit) setZoomedIn(instance.camera().position.length() < fit * GLOBE.zoomInThreshold);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  useEffect(() => {
    heatmapVisible.current = !zoomedIn;
    globe.current?.scene().traverse(object => {
      if ((object as Object3D & { __globeObjType?: string }).__globeObjType === "heatmap") object.visible = !zoomedIn;
    });
  }, [zoomedIn, ready]);
  const heatmapColor = useCallback((layer: object) => {
    // three-globe binds the mesh before invoking this accessor on data updates.
    const mesh = (layer as { __threeObjHeatmap?: Mesh }).__threeObjHeatmap;
    if (mesh) { clipToLand(mesh); mesh.visible = heatmapVisible.current; }
    return heatmapRamp;
  }, []);
  const [treeRoot, setTreeRoot] = useState<Event | null>(null);
  const [connections, setConnections] = useState<Connection<Event>[]>([]);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(() => new Set());

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

  useEffect(() => {
    if (!ready || !globe.current) return;
    const controls = globe.current.controls();
    controls.autoRotate = rotating;
    controls.autoRotateSpeed = GLOBE.rotationSpeed;
    const surface = stage.current;
    if (!surface) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const heldPointers = new Set<number>();
    // Temporary interaction pauses never change the user's manual rotation choice.
    const pause = () => {
      clearTimeout(timer);
      controls.autoRotate = false;
      if (!heldPointers.size) timer = setTimeout(() => {
        controls.autoRotate = rotating;
      }, GLOBE.interactionPauseMs);
    };
    const isRotationButton = (event: { target: EventTarget | null }) => event.target instanceof Element && !!event.target.closest("[data-rotation-toggle]");
    const down = (event: PointerEvent) => {
      if (isRotationButton(event)) return;
      heldPointers.add(event.pointerId);
      pause();
    };
    const up = (event: PointerEvent) => {
      if (heldPointers.delete(event.pointerId)) pause();
    };
    const click = (event: MouseEvent) => { if (!isRotationButton(event)) pause(); };
    const blur = () => { heldPointers.clear(); pause(); };
    // Capture also catches card gestures whose handlers stop propagation.
    surface.addEventListener("pointerdown", down, true);
    surface.addEventListener("click", click, true);
    surface.addEventListener("wheel", pause, { capture: true, passive: true });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", blur);
    return () => {
      clearTimeout(timer);
      surface.removeEventListener("pointerdown", down, true);
      surface.removeEventListener("click", click, true);
      surface.removeEventListener("wheel", pause, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [rotating, ready]);

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
  const rootEvent = treeRoot ?? (selection?.kind === "event" ? selection.event : null);
  const [hoveredCountryId, setHoveredCountryId] = useState<string | null>(null);
  const [hoveredBorderId, setHoveredBorderId] = useState<string | null>(null);
  const hoverId = hoveredBorderId ?? hoveredCountryId;
  const landMaterials = useMemo(() => new Map(countries.features.map(country => [country.id,
    writeLandStencil(continentMaterial(country.id === "ATA" ? GLOBE.antarcticaColor : GLOBE.landColor, GLOBE.continentEdgeShadeStrength)),
  ])), []);
  const sideMaterials = useMemo(() => new Map(countries.features.map(country => [country.id,
    continentMaterial(GLOBE.landColor, GLOBE.continentEdgeShadeStrength),
  ])), []);
  useEffect(() => {
    for (const country of countries.features) {
      const selected = selectedCountryIds.has(country.id);
      const baseColor = country.id === "ATA" ? GLOBE.antarcticaColor : GLOBE.landColor;
      landMaterials.get(country.id)!.color.set(country.id === "ATA" ? baseColor : selected ? GLOBE.selectedCountryColor : country.id === hoverId ? GLOBE.hoverCountryColor : baseColor);
      sideMaterials.get(country.id)!.color.set(selected ? GLOBE.selectedCountrySideColor : baseColor);
    }
  }, [selectedCountryIds, landMaterials, sideMaterials, hoverId]);
  const sideMaterial = useCallback((value: object) => sideMaterials.get((value as CountryFeature).id)!, [sideMaterials]);
  const landMaterial = useCallback((value: object) => landMaterials.get((value as CountryFeature).id)!, [landMaterials]);
  const countryBorderColor = useCallback((path: object) => selectedCountryIds.has((path as typeof borders[number]).countryId) ? "#000000" : GLOBE.countryBorderColor, [selectedCountryIds]);
  const polygonAltitude = useCallback((value: object) => selectedCountryIds.has((value as CountryFeature).id) ? GLOBE.selectedCountryAltitude : GLOBE.landAltitude, [selectedCountryIds]);
  const relationshipEvents = useMemo(() => [...new Map(connections.flatMap(link => [link.source, link.target]).map(event => [event.id, event])).values()], [connections]);
  const displayEvents = useMemo(() => rootEvent ? [...new Map([rootEvent, ...relationshipEvents].map(event => [event.id, event])).values()] : [...new Map([...events, ...selectedEvents, ...relationshipEvents].map(event => [event.id, event])).values()], [events, selectedEvents, relationshipEvents, rootEvent]);

  useEffect(() => {
    if (!ready || !globe.current || !connections.length) return;
    const instance = globe.current;
    const vector = (event: Event) => {
      const { x, y, z } = instance.getCoords(event.lat, event.lng);
      return new Vector3(x, y, z);
    };
    const arcs = connections.map(connection => {
      const curve = new CatmullRomCurve3(floatingArc(vector(connection.source), vector(connection.target), instance.getGlobeRadius(), GLOBE.relatedArcClearance, GLOBE.relatedArcRise));
      const geometry = new TubeGeometry(curve, 128, GLOBE.relatedArcRadius, 6, false);
      const material = new MeshBasicMaterial({ color: GLOBE.relatedArcColor });
      const arc = new Mesh(geometry, material);
      arc.raycast = () => {}; // The decorative link never blocks POI/country picking.
      instance.scene().add(arc);
      return arc;
    });
    return () => arcs.forEach(arc => { instance.scene().remove(arc); arc.geometry.dispose(); arc.material.dispose(); });
  }, [ready, connections]);

  function clearTree() {
    setConnections([]);
    setTreeRoot(null);
    setExpandedCards(new Set());
    onSelect(null);
  }
  function removeBranch(id: string) {
    if (id === rootEvent?.id) { clearTree(); return; }
    const next = pruneBranch(connections, id);
    setConnections(next.links);
    setExpandedCards(current => new Set([...current].filter(value => !next.removed.has(value))));
    if (selection?.kind === "event" && next.removed.has(selection.event.id) && rootEvent) onSelect({ kind: "event", event: rootEvent });
  }
  function clearChildren(source: Event) {
    let remaining = connections;
    const removed = new Set<string>();
    for (const child of connections.filter(link => link.source.id === source.id)) {
      const next = pruneBranch(remaining, child.target.id);
      remaining = next.links;
      next.removed.forEach(id => removed.add(id));
    }
    setConnections(remaining);
    setExpandedCards(current => new Set([...current].filter(id => !removed.has(id))));
    if (selection?.kind === "event" && removed.has(selection.event.id)) onSelect({ kind: "event", event: source });
  }
  function addConnection(source: Event, target: Event) {
    const root = rootEvent ?? source;
    setTreeRoot(root);
    setConnections(current => connectTree(current, root, source, target));
  }
  function visitRelated(source: Event, target: Event) {
    onRotationChange(false);
    addConnection(source, target);
    // Connection navigation opens only the headline; details remain opt-in.
    setExpandedCards(current => {
      const next = new Set(current);
      next.delete(target.id);
      return next;
    });
    onSelect({ kind: "event", event: target });
    const instance = globe.current;
    if (instance) instance.pointOfView({ lat: target.lat, lng: target.lng, altitude: Math.max(GLOBE.relatedFocusAltitude, instance.pointOfView().altitude) }, GLOBE.relatedFocusMs);
  }

  function selectCountry(country: CountryFeature) {
    onToggleCountry(country.id);
  }
  function selectCoordinates(lat: number, lng: number) {
    const country = countries.features.find(country => countryContains(country, {lat, lng}));
    if (country) selectCountry(country);
  }
  const callouts = useMemo<Callout[]>(() => {
    if (rootEvent) return displayEvents.map(event => ({ id: event.id, lat: event.lat, lng: event.lng, color: eventColor(event.layerId), event }));
    const selectedId = selection?.kind === "event" ? selection.event.id : null;
    const opened = allEvents.filter(event => expandedCards.has(event.id));
    const ranked = [...new Map([...opened, ...relationshipEvents, ...(selectedCountries.length ? selectedEvents : events), ...(selection?.kind === "event" ? [selection.event] : [])].map(event => [event.id, event])).values()].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) || Number(relationshipEvents.some(event => event.id === b.id)) - Number(relationshipEvents.some(event => event.id === a.id)) || b.significance - a.significance || a.id.localeCompare(b.id));
    // Keep opened cards mounted so their positions and source controls survive navigation.
    const included = ranked.filter((event, index) => expandedCards.has(event.id) || index < GLOBE.maxCallouts - Number(selection?.kind === "location"));
    const result = included.map((event) => ({ id: event.id, lat: event.lat, lng: event.lng, color: eventColor(event.layerId), event, retained: !displayEvents.some(visible => visible.id === event.id) }));
    return selection?.kind === "location" ? [{ id: "selected-location", ...selection.location, color: GLOBE.colors.selected }, ...result] : result;
  }, [events, selection, selectedEvents, rootEvent, selectedCountries.length, displayEvents, relationshipEvents, allEvents, expandedCards]);

  // Relationship trees always show their markers; otherwise markers wait for zoom-in.
  const showMarkers = zoomedIn || !!rootEvent;
  const points = useMemo(() => showMarkers ? displayEvents.map((event) => ({ ...event, color: selectedIds.has(event.id) ? GLOBE.colors.selected : eventColor(event.layerId), altitude: GLOBE.pointAltitude })) : [], [showMarkers, displayEvents, selectedIds]);
  const pointCountries = useMemo(() => new Map(displayEvents.map(event => [event.id,
    countries.features.find(country => countryContains(country, event))?.id,
  ])), [displayEvents]);

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
          const marker = point as typeof point & { __threeObjPoint?: Mesh };
          const mesh = marker.__threeObjPoint;
          if (!mesh) continue;
          const countryId = pointCountries.get(point.id);
          const surfaceAltitude = countryId ? countrySurfaces.get(countryId)?.__currentTargetD?.alt ?? GLOBE.landAltitude : 0;
          const base = instance.getCoords(point.lat, point.lng, surfaceAltitude);
          mesh.position.set(base.x, base.y, base.z);
          // Radius and height remain constant; only the base follows the country.
        }
        const visible: { item: Callout; x: number; y: number; front: boolean; side: "left" | "right" }[] = [];
        for (const item of callouts) {
          const surface = instance.getCoords(item.lat, item.lng);
          const normal = new Vector3(surface.x, surface.y, surface.z).normalize();
          // Perspective horizon: a point is visible only when n·camera > radius.
          const front = normal.dot(camera) > radius + 0.5;
          const countryId = pointCountries.get(item.id);
          const surfaceAltitude = countryId ? countrySurfaces.get(countryId)?.__currentTargetD?.alt ?? GLOBE.landAltitude : 0;
          const altitude = surfaceAltitude + GLOBE.pointAltitude;
          const point = instance.getScreenCoords(item.lat, item.lng, altitude);
          const card = cards.current.get(item.id), pin = pins.current.get(item.id), path = paths.current.get(item.id);
          if (!card || !pin || !path) continue;
          // Retained selections stay readable even when their layer is disabled.
          const x = item.retained && !expandedCards.has(item.id) ? GLOBE.cardEdgePaddingPx : point.x + offsetX;
          const y = item.retained && !expandedCards.has(item.id) ? centerY : point.y + offsetY;
          const shown = !item.retained && front && point.x > 0 && point.x < canvasRect.width && point.y > 0 && point.y < canvasRect.height;
          card.hidden = false;
          pin.hidden = !shown;
          path.style.display = item.retained || !front ? "none" : "";
          visible.push({ item, x, y, front: front || !!item.retained || expandedCards.has(item.id), side: x < centerX ? "left" : "right" });
        }
        // Release hidden cards, then move existing rectangles with their pins before
        // finding space for newcomers. Stored offsets never change during rotation.
        const activeIds = new Set(visible.filter(entry => entry.front).map(entry => entry.item.id));
        for (const id of cardPlacements.current.keys()) {
          if (!activeIds.has(id)) { cardPlacements.current.delete(id); cardAnchors.current.delete(id); }
        }
        for (const { item, x, y } of visible) {
          const placement = cardPlacements.current.get(item.id);
          if (placement) {
            const anchor = cardAnchors.current.get(item.id);
            if (drag.current?.id !== item.id && !expandedCards.has(item.id)) {
              if (anchor) {
                const projected = anchor.clone().project(instance.camera());
                placement.left = offsetX + (projected.x + 1) * canvasRect.width / 2;
                placement.top = offsetY + (1 - projected.y) * canvasRect.height / 2;
              } else {
                placement.left = x + placement.offsetX;
                placement.top = y + placement.offsetY;
              }
            }
          }
        }
        // Keep width stable; expansion changes height without changing the stored offset.
        visible.forEach(({ item }) => {
          const card = cards.current.get(item.id)!;
          const placement = cardPlacements.current.get(item.id);
          card.style.width = `${placement?.width ?? Math.min(278, stageRect.width - 2 * GLOBE.cardEdgePaddingPx)}px`;
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
              cardAnchors.current.delete(id);
            }
          }
        }
        for (const { item, x, y, front, side } of visible) {
          const card = cards.current.get(item.id)!;
          const { width, height } = measurements.get(item.id)!;
          let placement = cardPlacements.current.get(item.id);
          if (front && !placement) {
            const availablePlacement = placeCard({
              left: item.retained ? GLOBE.cardEdgePaddingPx : side === "left" ? x - GLOBE.pinToCardDistancePx - width : x + GLOBE.pinToCardDistancePx,
              top: y - height / 2, width, height,
            }, [...cardPlacements.current.values()], stageRect.width, canvasRect.height, GLOBE.cardEdgePaddingPx, 16, { x: centerX, y: centerY, radius: screenRadius * GLOBE.cardCenterExclusion, strict: true });
            const chosenPlacement = availablePlacement;
            if (chosenPlacement) {
              placement = { ...chosenPlacement, offsetX: chosenPlacement.left - x, offsetY: chosenPlacement.top - y };
              cardPlacements.current.set(item.id, placement);
              if (!item.retained) cardAnchors.current.set(item.id, screenAnchor(placement.left, placement.top, item));
            }
          }
          const displayed = front && !!placement;
          card.style.visibility = displayed ? "visible" : "hidden";
          card.inert = !displayed;
          card.setAttribute("aria-hidden", String(!displayed));
          paths.current.get(item.id)!.style.display = displayed && (expandedCards.has(item.id) || (!item.retained && !pins.current.get(item.id)!.hidden)) ? "" : "none";
          pins.current.get(item.id)!.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
          if (!placement) continue;
          const { left, top } = placement;
          card.style.left = "0px";
          card.style.top = "0px";
          const headlineCenter = headlineCenters.get(item.id)!;
          const flat = expandedCards.has(item.id) || item.retained || drag.current?.id === item.id;
          const dx = Math.max(-1, Math.min(1, (x - centerX) / screenRadius));
          const dy = Math.max(-1, Math.min(1, (y - centerY) / screenRadius));
          const edge = Math.min(1, Math.hypot(dx, dy));
          const scale = flat ? 1 : 1 - (1 - GLOBE.headlineMinScale) * edge;
          // Rotate around the headline center: its connector attachment stays exact.
          card.style.transformOrigin = `${headlineCenter.x}px ${headlineCenter.y}px`;
          card.style.transform = `translate(${left}px, ${top}px) perspective(${GLOBE.headlinePerspectivePx}px) rotateX(${flat ? 0 : -dy * GLOBE.headlineTiltDegrees}deg) rotateY(${flat ? 0 : dx * GLOBE.headlineTiltDegrees}deg) scale(${scale})`;
          card.dataset.side = side;
          if (item.retained && !expandedCards.has(item.id)) continue;
          // The transform origin stays fixed even as the rest of the headline tilts.
          const endpointX = left + headlineCenter.x;
          const endpointY = top + headlineCenter.y;
          const path = paths.current.get(item.id)!;
          path.setAttribute("d", `M ${x} ${y} L ${endpointX} ${endpointY}`);
          pins.current.get(item.id)!.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
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
  const activeHeatmaps = useMemo(() => rootEvent || !heatmap.length ? [] : [{ points: heatmap }], [heatmap, rootEvent]);

  function select(item: Callout) {
    onSelect(item.event ? { kind: "event", event: item.event } : { kind: "location", location: { lat: item.lat, lng: item.lng } });
  }

  // Unproject onto the pin's camera-depth plane. The resulting world-space
  // anchor travels along a curved projected path as the camera orbits Earth.
  function screenAnchor(left: number, top: number, item: Callout) {
    const instance = globe.current!;
    const viewport = container.current!.getBoundingClientRect();
    const bounds = stage.current!.getBoundingClientRect();
    const coords = instance.getCoords(item.lat, item.lng, GLOBE.pointAltitude);
    return cardWorldAnchor(left - viewport.left + bounds.left, top - viewport.top + bounds.top, viewport.width, viewport.height, coords, instance.camera());
  }
  function startCardDrag(event: ReactPointerEvent<HTMLElement>, item: Callout) {
    if (!event.isPrimary || event.button !== 0) return;
    const placement = cardPlacements.current.get(item.id);
    if (!placement) return;
    event.stopPropagation();
    suppressClick.current = null;
    // Capture on the original child so an ordinary button/link click keeps its target.
    const captureTarget = event.target as Element;
    drag.current = { id: item.id, pointerId: event.pointerId, captureTarget, startX: event.clientX, startY: event.clientY, left: placement.left, top: placement.top, moved: false };
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
      cardAnchors.current.set(item.id, screenAnchor(placement.left, placement.top, item));
      suppressClick.current = item.id;
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
    clickRaycaster.setFromCamera(new Vector2(2 * (event.clientX - bounds.left) / bounds.width - 1, 1 - 2 * (event.clientY - bounds.top) / bounds.height), instance.camera());
    type PickObject = Object3D & { __globeObjType?: string; __data?: unknown };
    for (const hit of clickRaycaster.intersectObjects(instance.scene().children, true)) {
      let owner: PickObject | null = hit.object;
      while (owner && !owner.__globeObjType) owner = owner.parent;
      if (!owner) continue;
      if (owner.__globeObjType === "point") {
        const point = owner.__data as Event;
        onSelect({ kind: "event", event: point });
        return;
      }
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
    {selection?.kind === "event" && <div className="earth-controls"><button onClick={clearTree}>Clear selection tree</button></div>}
    <div className="earth-canvas" ref={container} role="region" aria-label="Interactive Earth. Drag to rotate, scroll to zoom, click to select a location.">
      <div ref={orbSurface} className="earth-orb-surface" aria-hidden="true">
        <FluidOrb size={GLOBE.orbRenderSize} color={GLOBE.orbColor} topColor={GLOBE.orbTopColor} maxFps={GLOBE.orbMaxFps} maxPixelRatio={GLOBE.orbMaxPixelRatio} />
      </div>
      <div className="earth-renderer" onPointerDownCapture={beginGlobePress} onPointerMoveCapture={trackGlobePress}
        onPointerUpCapture={finishGlobePress} onPointerCancelCapture={() => { globePress.current = null; }}
        onPointerLeave={() => { globePress.current = null; }}>
      {size.width > 0 && <Globe ref={globe} width={size.width} height={size.height} rendererConfig={rendererConfig}
        backgroundColor="rgba(0,0,0,0)" globeMaterial={oceanDepthMaterial}
        polygonsData={countries.features} polygonGeoJsonGeometry="geometry"
        polygonCapMaterial={landMaterial} polygonSideMaterial={sideMaterial}
        polygonAltitude={polygonAltitude}
        polygonCapCurvatureResolution={GLOBE.landCurvatureDegrees} polygonsTransitionDuration={GLOBE.countryAnimationMs}
        onPolygonHover={country => setHoveredCountryId(country ? (country as CountryFeature).id : null)}
        pathsData={borders} pathPoints="points" pathPointLat={borderLatitude} pathPointLng={borderLongitude}
        pathPointAlt={GLOBE.borderAltitude} pathColor={countryBorderColor} pathStroke={null}
        pathResolution={360} pathTransitionDuration={0}
        onPathHover={path => setHoveredBorderId(path ? (path as typeof borders[number]).countryId : null)}
        atmosphereColor={GLOBE.atmosphereColor} atmosphereAltitude={GLOBE.atmosphereAltitude} animateIn={false}
        heatmapsData={activeHeatmaps} heatmapPoints="points"
        heatmapPointLat="lat" heatmapPointLng="lng" heatmapPointWeight="weight"
        heatmapColorFn={heatmapColor}
        heatmapBandwidth={GLOBE.heatmapBandwidthDegrees} heatmapBaseAltitude={GLOBE.heatmapBaseAltitude} heatmapTopAltitude={GLOBE.heatmapBaseAltitude} heatmapsTransitionDuration={0}
        pointsData={points} pointLat="lat" pointLng="lng" pointColor="color"
        pointRadius={GLOBE.pointRadiusDegrees} pointAltitude="altitude" pointsTransitionDuration={0}
        onGlobeReady={() => {
          const instance = globe.current;
          if (!instance) return;
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          instance.pointOfView(GLOBE.initialView);
          const sun = new DirectionalLight("#ffffff", GLOBE.sunlightIntensity);
          sun.position.set(-150, 200, 200);
          instance.lights([new AmbientLight("#ffffff", GLOBE.ambientLightIntensity), sun]);
          instance.controls().enablePan = false;
          instance.controls().enableDamping = !reduced;
          instance.renderer().setPixelRatio(Math.min(window.devicePixelRatio, GLOBE.maxPixelRatio));
          setReady(true); onRotationChange(!reduced);
        }}
      />}
      </div>
      {!ready && <div className="earth-loading" role="status">Rendering Earth…</div>}
    </div>
    <svg className="connectors" aria-hidden="true">{callouts.map((item) => <path key={item.id} ref={(node) => { if (node) paths.current.set(item.id, node); else paths.current.delete(item.id); }} stroke={item.color} />)}</svg>
    <div className="pins">{callouts.map((item, index) => <button hidden key={item.id} ref={(node) => { if (node) pins.current.set(item.id, node); else pins.current.delete(item.id); }}
      className="earth-pin" style={{ "--pin-color": item.color } as CSSProperties} aria-label={item.event?.title ?? "Selected location"} onClick={() => select(item)}>{index + 1}</button>)}</div>
    <div className="callouts" aria-label="Visible points of interest">{callouts.map((item, index) => {
      const event = item.event;
      const expanded = expandedCards.has(item.id);
      const active = event ? rootEvent ? displayEvents.some(node => node.id === event.id) : selectedIds.has(event.id) : true;
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
        {expanded && <div className="card-category"><span>{String(index + 1).padStart(2, "0")} / {event ? LABELS[event.layerId as LayerId] ?? event.layerId : "location"}</span>{fixture && event && <span className="sample-badge">Sample</span>}</div>}
        <button className="card-title" title="Drag to reposition; click to expand or collapse" aria-expanded={expanded}
          onClick={() => {
          if (!expanded) onRotationChange(false);
          else {
            const placement = cardPlacements.current.get(item.id);
            if (placement && !item.retained) cardAnchors.current.set(item.id, screenAnchor(placement.left, placement.top, item));
          }
          setExpandedCards(current => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
            return next;
          });
          if (!expanded) select(item);
        }}>{event?.title ?? "Selected location"}<span className="card-expand-icon" aria-hidden="true">{expanded ? "−" : "+"}</span></button>
        {expanded && <>
        {item.retained && <p className="retained-note">Selected event · hidden by map filters</p>}
        {event && <p className="card-summary">{event.summary ?? "No summary provided."}</p>}
        <p className="card-coordinates">{coordinate(item.lat, true)}<br />{coordinate(item.lng, false)}{event && <span>{event.geoPrecision} precision</span>}</p>
        {event && <RelatedEventControls key={event.id} event={event} allEvents={allEvents} connections={connections} rootId={rootEvent?.id}
          onVisit={visitRelated} onAdd={addConnection} onRemove={removeBranch} onClear={clearChildren} />}
        {event && <p className="card-time">{eventTime(event.occurredAt)}</p>}
        <div className="card-footer">{href ? <a href={href} target="_blank" rel="noreferrer">{event!.source.toUpperCase()} ↗</a> : <span>{event?.source.toUpperCase() ?? "Coordinates captured"}</span>}
          {active && <button onClick={() => event ? removeBranch(event.id) : clearTree()} aria-label={event?.id === rootEvent?.id ? "Clear root and all branches" : "Remove branch and descendants"}>{event?.id === rootEvent?.id ? "Clear entire tree" : "Remove branch"}</button>}</div>
        </>}
      </article>;
    })}</div>
    <p className="earth-hint">Drag to explore <span>·</span> Scroll to zoom <span>·</span> Click a place</p>
  </div>;
}
