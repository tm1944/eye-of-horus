"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { AmbientLight, DirectionalLight, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { LAYER_IDS, LABELS, type LayerId, type HeatmapData } from "@/lib/layers";
import type { Event } from "@/lib/api";
import { continentMaterial } from "@/lib/continent-material";
import { cardWorldAnchor } from "@/lib/card-anchor";
import { placeCard, type CardRect } from "@/lib/card-placement";
import { countryContains, type CountryFeature } from "@/lib/country-selection";
import countries from "@/data/countries.geojson.json";
import { countryBorders, borderContour } from "@/lib/country-borders";
import { globeClipPlanes } from "@/lib/globe-depth";
import FluidOrb from "@/components/ui/fluid-orb";
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
const heatmapAltitude = (layer: object) => GLOBE.heatmapBaseAltitude + LAYER_IDS.indexOf((layer as HeatmapData).id) * GLOBE.heatmapLayerGap;
const countryBorderColor = () => GLOBE.countryBorderColor;
const borders = countries.features.flatMap(country => countryBorders([country]).map(points => ({ countryId: country.id, points: borderContour(points, GLOBE.landCurvatureDegrees).map(point => ({ lng: point[0], lat: point[1], countryId: country.id })) })));
const borderLongitude = (point: object) => (point as { lng: number }).lng;
const borderLatitude = (point: object) => (point as { lat: number }).lat;
const heatmapColors = new Map(LAYER_IDS.map(id => {
  const color = eventColor(id);
  const red = parseInt(color.slice(1, 3), 16), green = parseInt(color.slice(3, 5), 16), blue = parseInt(color.slice(5, 7), 16);
  return [id, (density: number) => `rgba(${red},${green},${blue},${Math.min(GLOBE.heatmapMaxOpacity, Math.max(0, density) * GLOBE.heatmapMaxOpacity)})`];
}));
function heatmapColor(layer: object) {
  // three-globe binds the mesh before invoking this accessor on data updates.
  const data = layer as HeatmapData & { __threeObjHeatmap?: Mesh };
  const mesh = data.__threeObjHeatmap;
  if (mesh) {
    mesh.renderOrder = 10 + LAYER_IDS.indexOf(data.id);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach(material => { material.depthWrite = false; });
  }
  return heatmapColors.get(data.id)!;
}

export default function EventGlobe({ events, selectedCountries, onToggleCountry, heatmaps, selection, onSelect, rotating, onRotationChange, fixture }: {
  events: Event[];
  selectedCountries: { id: string; name: string; events: Event[] }[];
  onToggleCountry: (id: string) => void;
  heatmaps: HeatmapData[];
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  rotating: boolean;
  onRotationChange: (rotating: boolean) => void;
  fixture: boolean;
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
  const drag = useRef<{ id: string; pointerId: number; startX: number; startY: number; left: number; top: number; moved: boolean } | null>(null);
  const dragNeedsUpdate = useRef(false);
  const suppressClick = useRef<string | null>(null);
  const pins = useRef(new Map<string, HTMLButtonElement>());
  const paths = useRef(new Map<string, SVGPathElement>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
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
  const [focusedCountryEvent, setFocusedCountryEvent] = useState<string | null>(null);
  const landMaterials = useMemo(() => new Map(countries.features.map(country => [country.id,
    continentMaterial(country.id === "ATA" ? GLOBE.antarcticaColor : GLOBE.landColor, GLOBE.continentEdgeShadeStrength),
  ])), []);
  const sideMaterials = useMemo(() => new Map(countries.features.map(country => [country.id,
    continentMaterial(GLOBE.landColor, GLOBE.continentEdgeShadeStrength),
  ])), []);
  useEffect(() => {
    for (const country of countries.features) {
      const selected = selectedCountryIds.has(country.id);
      const baseColor = country.id === "ATA" ? GLOBE.antarcticaColor : GLOBE.landColor;
      landMaterials.get(country.id)!.color.set(selected && country.id !== "ATA" ? GLOBE.selectedCountryColor : baseColor);
      sideMaterials.get(country.id)!.color.set(selected ? GLOBE.selectedCountrySideColor : baseColor);
    }
  }, [selectedCountryIds, landMaterials, sideMaterials]);
  const sideMaterial = useCallback((value: object) => sideMaterials.get((value as CountryFeature).id)!, [sideMaterials]);
  const landMaterial = useCallback((value: object) => landMaterials.get((value as CountryFeature).id)!, [landMaterials]);
  const polygonAltitude = useCallback((value: object) => selectedCountryIds.has((value as CountryFeature).id) ? GLOBE.selectedCountryAltitude : GLOBE.landAltitude, [selectedCountryIds]);
  const displayEvents = useMemo(() => [...events, ...selectedEvents.filter(event => !events.some(visible => visible.id === event.id))], [events, selectedEvents]);
  function selectCountry(country: CountryFeature) {
    setFocusedCountryEvent(null);
    onToggleCountry(country.id);
  }
  function selectCoordinates(lat: number, lng: number) {
    const country = countries.features.find(country => countryContains(country, {lat, lng}));
    if (country) selectCountry(country);
  }
  const callouts = useMemo<Callout[]>(() => {
    const selectedId = selection?.kind === "event" ? selection.event.id : focusedCountryEvent;
    const retained = selection?.kind === "event" && !displayEvents.some(event => event.id === selectedId) ? selection.event : null;
    const ranked = [...new Map([...(selectedCountries.length ? selectedEvents : events), ...(selection?.kind === "event" ? [selection.event] : [])].map(event => [event.id, event])).values()].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) || b.significance - a.significance || a.id.localeCompare(b.id));
    const result = ranked.slice(0, GLOBE.maxCallouts - Number(selection?.kind === "location")).map((event) => ({ id: event.id, lat: event.lat, lng: event.lng, color: eventColor(event.layerId), event, retained: event.id === retained?.id }));
    return selection?.kind === "location" ? [{ id: "selected-location", ...selection.location, color: GLOBE.colors.selected }, ...result] : result;
  }, [events, selection, selectedEvents, focusedCountryEvent, selectedCountries.length, displayEvents]);

  const points = useMemo(() => displayEvents.map((event) => ({ ...event, color: selectedIds.has(event.id) ? GLOBE.colors.selected : eventColor(event.layerId), altitude: GLOBE.pointAltitude })), [displayEvents, selectedIds]);
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
          const x = item.retained ? GLOBE.cardEdgePaddingPx : point.x + offsetX;
          const y = item.retained ? centerY : point.y + offsetY;
          const shown = !item.retained && front && point.x > 0 && point.x < canvasRect.width && point.y > 0 && point.y < canvasRect.height;
          card.hidden = false;
          pin.hidden = !shown;
          path.style.display = item.retained || !front ? "none" : "";
          visible.push({ item, x, y, front: front || !!item.retained, side: x < centerX ? "left" : "right" });
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
            if (drag.current?.id !== item.id) {
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
        const measurements = new Map(visible.map(({ item }) => [item.id, cards.current.get(item.id)!.getBoundingClientRect()]));
        // New cards avoid the current expanded rectangles as well as headlines.
        for (const { item } of visible) {
          const placement = cardPlacements.current.get(item.id);
          const measurement = measurements.get(item.id)!;
          if (placement) { placement.width = measurement.width; placement.height = measurement.height; }
        }
        for (const { item, x, y, front, side } of visible) {
          const card = cards.current.get(item.id)!;
          const { width, height } = measurements.get(item.id)!;
          let placement = cardPlacements.current.get(item.id);
          if (front && !placement) {
            const availablePlacement = placeCard({
              left: item.retained ? GLOBE.cardEdgePaddingPx : side === "left" ? x - GLOBE.pinToCardDistancePx - width : x + GLOBE.pinToCardDistancePx,
              top: y - height / 2, width, height,
            }, [...cardPlacements.current.values()], stageRect.width, canvasRect.height, GLOBE.cardEdgePaddingPx);
            if (availablePlacement) {
              placement = { ...availablePlacement, offsetX: availablePlacement.left - x, offsetY: availablePlacement.top - y };
              cardPlacements.current.set(item.id, placement);
              if (!item.retained) cardAnchors.current.set(item.id, screenAnchor(placement.left, placement.top, item));
            }
          }
          const displayed = front && !!placement;
          card.style.visibility = displayed ? "visible" : "hidden";
          card.inert = !displayed;
          card.setAttribute("aria-hidden", String(!displayed));
          paths.current.get(item.id)!.style.display = displayed && !item.retained ? "" : "none";
          pins.current.get(item.id)!.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
          if (!placement) continue;
          const { left, top } = placement;
          card.style.left = "0px";
          card.style.top = "0px";
          card.style.transform = `translate(${left}px, ${top}px)`;
          card.dataset.side = side;
          if (item.retained) continue;
          // Meet the pin-facing edge at its midpoint, slightly under the card.
          const inset = Math.min(GLOBE.connectorInsetPx, width / 2);
          const endpointX = x < left + width / 2 ? left + inset : left + width - inset;
          const endpointY = top + height / 2;
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

  const activeHeatmaps = useMemo(() => heatmaps.filter(layer => layer.points.length > 0), [heatmaps]);

  function select(item: Callout) {
    if (selectedCountries.length && item.event) { setFocusedCountryEvent(item.id); return; }
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
  function startCardDrag(event: ReactPointerEvent<HTMLButtonElement>, item: Callout) {
    if (event.button !== 0) return;
    const placement = cardPlacements.current.get(item.id);
    if (!placement) return;
    event.stopPropagation();
    suppressClick.current = null;
    drag.current = { id: item.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: placement.left, top: placement.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveCardDrag(event: ReactPointerEvent<HTMLButtonElement>, item: Callout) {
    const current = drag.current;
    if (!current || current.id !== item.id || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    current.moved = true;
    event.stopPropagation();
    const placement = cardPlacements.current.get(item.id);
    if (placement) { placement.left = current.left + dx; placement.top = current.top + dy; }
  }
  function endCardDrag(event: ReactPointerEvent<HTMLButtonElement>, item: Callout) {
    const current = drag.current;
    if (!current || current.id !== item.id) return;
    event.stopPropagation();
    const placement = cardPlacements.current.get(item.id);
    if (current.moved && placement) {
      cardAnchors.current.set(item.id, screenAnchor(placement.left, placement.top, item));
      suppressClick.current = item.id;
    }
    drag.current = null;
    dragNeedsUpdate.current = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className="earth-stage" ref={stage} style={{ "--connector-width": `${GLOBE.connectorWidthPx}px` } as CSSProperties}>
    <div className="earth-controls"><button disabled={!ready} onClick={() => {
      if (globe.current && fittedDistance.current) globe.current.pointOfView({ ...GLOBE.initialView, altitude: fittedDistance.current / globe.current.getGlobeRadius() - 1 });
    }}>Reset view</button><button onClick={() => onRotationChange(!rotating)} disabled={!ready} aria-pressed={rotating}>{rotating ? "Pause rotation" : "Resume rotation"}</button></div>
    <div className="earth-canvas" ref={container} role="region" aria-label="Interactive Earth. Drag to rotate, scroll to zoom, click to select a location.">
      <div ref={orbSurface} className="earth-orb-surface" aria-hidden="true">
        <FluidOrb size={GLOBE.orbRenderSize} color={GLOBE.orbColor} topColor={GLOBE.orbTopColor} maxFps={GLOBE.orbMaxFps} maxPixelRatio={GLOBE.orbMaxPixelRatio} />
      </div>
      <div className="earth-renderer">
      {size.width > 0 && <Globe ref={globe} width={size.width} height={size.height}
        backgroundColor="rgba(0,0,0,0)" globeMaterial={oceanDepthMaterial}
        polygonsData={countries.features} polygonGeoJsonGeometry="geometry"
        polygonCapMaterial={landMaterial} polygonSideMaterial={sideMaterial}
        polygonAltitude={polygonAltitude}
        polygonCapCurvatureResolution={GLOBE.landCurvatureDegrees} polygonsTransitionDuration={GLOBE.countryAnimationMs}
        onPolygonClick={(country) => selectCountry(country as CountryFeature)}
        pathsData={borders} pathPoints="points" pathPointLat={borderLatitude} pathPointLng={borderLongitude}
        pathPointAlt={GLOBE.borderAltitude} pathColor={countryBorderColor} pathStroke={null}
        pathResolution={360} pathTransitionDuration={0}
        onPathClick={(path) => { const country = countries.features.find(country => country.id === (path as typeof borders[number]).countryId); if (country) selectCountry(country); }}
        atmosphereColor={GLOBE.atmosphereColor} atmosphereAltitude={GLOBE.atmosphereAltitude} animateIn={false}
        heatmapsData={activeHeatmaps} heatmapPoints="points"
        heatmapPointLat="lat" heatmapPointLng="lng" heatmapPointWeight="weight"
        heatmapColorFn={heatmapColor}
        heatmapBandwidth={GLOBE.heatmapBandwidthDegrees} heatmapBaseAltitude={heatmapAltitude} heatmapTopAltitude={heatmapAltitude} heatmapsTransitionDuration={0}
        onHeatmapClick={(_, __, { lat, lng }) => selectCoordinates(lat, lng)}
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
        onGlobeClick={({ lat, lng }) => selectCoordinates(lat, lng)}
        onPointClick={(point) => { if (selectedCountries.length && selectedIds.has((point as Event).id)) setFocusedCountryEvent((point as Event).id); else onSelect({ kind: "event", event: point as Event }); }}
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
      const active = event ? selection?.kind === "event" && selection.event.id === event.id || selectedIds.has(event.id) : true;
      const href = event && sourceHref(event.sourceUrl);
      return <article hidden key={item.id} ref={(node) => { if (node) cards.current.set(item.id, node); else cards.current.delete(item.id); }} className={`earth-card${active ? " is-selected" : ""}${expanded ? " is-expanded" : " is-collapsed"}`} style={{ "--pin-color": item.color } as CSSProperties}>
        {expanded && <div className="card-category"><span>{String(index + 1).padStart(2, "0")} / {event ? LABELS[event.layerId as LayerId] ?? event.layerId : "location"}</span>{fixture && event && <span className="sample-badge">Sample</span>}</div>}
        <button className="card-title" aria-expanded={expanded}
          onPointerDown={event => startCardDrag(event, item)} onPointerMove={event => moveCardDrag(event, item)}
          onPointerUp={event => endCardDrag(event, item)} onPointerCancel={event => endCardDrag(event, item)}
          onClick={() => {
          if (suppressClick.current === item.id) { suppressClick.current = null; return; }
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
        {event && <p className="card-time">{eventTime(event.occurredAt)}</p>}
        <div className="card-footer">{href ? <a href={href} target="_blank" rel="noreferrer">{event!.source.toUpperCase()} ↗</a> : <span>{event?.source.toUpperCase() ?? "Coordinates captured"}</span>}
          {active && <button onClick={() => onSelect(null)} aria-label="Clear selection">Clear</button>}</div>
        </>}
      </article>;
    })}</div>
    <p className="earth-hint">Drag to explore <span>·</span> Scroll to zoom <span>·</span> Click a place</p>
  </div>;
}
