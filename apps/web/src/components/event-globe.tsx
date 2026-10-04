"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { AmbientLight, DirectionalLight, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { LAYER_IDS, LABELS, type LayerId, type HeatmapData } from "@/lib/layers";
import type { Event } from "@/lib/api";
import { placeCard, type CardRect } from "@/lib/card-placement";
import countries from "@/data/countries.geojson.json";
import { countryBorders } from "@/lib/country-borders";
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
const landColor = () => GLOBE.landColor;
const countryBorderColor = () => GLOBE.countryBorderColor;
const borders = countryBorders(countries.features);
const borderLongitude = (point: object) => (point as number[])[0];
const borderLatitude = (point: object) => (point as number[])[1];
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

export default function EventGlobe({ events, heatmaps, selection, onSelect, rotating, onRotationChange, fixture }: {
  events: Event[];
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
  const pins = useRef(new Map<string, HTMLButtonElement>());
  const paths = useRef(new Map<string, SVGPathElement>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);

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

  const callouts = useMemo<Callout[]>(() => {
    const selectedId = selection?.kind === "event" ? selection.event.id : null;
    const retained = selection?.kind === "event" && !events.some(event => event.id === selectedId) ? selection.event : null;
    const ranked = [...events, ...(retained ? [retained] : [])].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) || b.significance - a.significance || a.id.localeCompare(b.id));
    const result = ranked.slice(0, GLOBE.maxCallouts - Number(selection?.kind === "location")).map((event) => ({ id: event.id, lat: event.lat, lng: event.lng, color: eventColor(event.layerId), event, retained: event.id === retained?.id }));
    return selection?.kind === "location" ? [{ id: "selected-location", ...selection.location, color: GLOBE.colors.selected }, ...result] : result;
  }, [events, selection]);

  // Update only projected DOM positions each frame, not React state or backend data.
  useEffect(() => {
    if (!ready) return;
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
    const update = () => {
      const instance = globe.current;
      if (dirty && instance && stage.current && container.current) {
        dirty = false;
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
        const visible: { item: Callout; x: number; y: number; front: boolean; side: "left" | "right" }[] = [];
        for (const item of callouts) {
          const surface = instance.getCoords(item.lat, item.lng);
          const normal = new Vector3(surface.x, surface.y, surface.z).normalize();
          // Perspective horizon: a point is visible only when n·camera > radius.
          const front = normal.dot(camera) > radius + 0.5;
          const point = instance.getScreenCoords(item.lat, item.lng, GLOBE.pointAltitude);
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
          if (!activeIds.has(id)) cardPlacements.current.delete(id);
        }
        for (const { item, x, y } of visible) {
          const placement = cardPlacements.current.get(item.id);
          if (placement) {
            placement.left = x + placement.offsetX;
            placement.top = y + placement.offsetY;
          }
        }
        // Freeze dimensions too: adding cards cannot resize an existing card.
        visible.forEach(({ item }) => {
          const card = cards.current.get(item.id)!;
          const placement = cardPlacements.current.get(item.id);
          card.style.width = `${placement?.width ?? Math.min(278, stageRect.width - 2 * GLOBE.cardEdgePaddingPx)}px`;
          card.style.height = placement ? `${placement.height}px` : "auto";
          card.style.maxHeight = placement ? "none" : `${Math.max(1, canvasRect.height - 2 * GLOBE.cardEdgePaddingPx)}px`;
        });
        // One measurement phase after visibility updates; all position writes follow.
        const measurements = new Map(visible.map(({ item }) => [item.id, cards.current.get(item.id)!.getBoundingClientRect()]));
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
  }, [ready, callouts]);

  const activeHeatmaps = useMemo(() => heatmaps.filter(layer => layer.points.length > 0), [heatmaps]);
  const points = useMemo(() => events.map((event) => ({ ...event, color: eventColor(event.layerId) })), [events]);
  function select(item: Callout) {
    onSelect(item.event ? { kind: "event", event: item.event } : { kind: "location", location: { lat: item.lat, lng: item.lng } });
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
        polygonCapColor={landColor} polygonSideColor={landColor}
        polygonAltitude={GLOBE.landAltitude}
        polygonCapCurvatureResolution={GLOBE.landCurvatureDegrees} polygonsTransitionDuration={0}
        onPolygonClick={(_, __, { lat, lng }) => { onSelect({ kind: "location", location: { lat, lng: ((lng + 180) % 360 + 360) % 360 - 180 } }); }}
        pathsData={borders} pathPointLat={borderLatitude} pathPointLng={borderLongitude}
        pathPointAlt={GLOBE.borderAltitude} pathColor={countryBorderColor} pathStroke={null}
        pathResolution={GLOBE.landCurvatureDegrees} pathTransitionDuration={0}
        onPathClick={(_, __, { lat, lng }) => { onSelect({ kind: "location", location: { lat, lng: ((lng + 180) % 360 + 360) % 360 - 180 } }); }}
        atmosphereColor={GLOBE.atmosphereColor} atmosphereAltitude={GLOBE.atmosphereAltitude} animateIn={false}
        heatmapsData={activeHeatmaps} heatmapPoints="points"
        heatmapPointLat="lat" heatmapPointLng="lng" heatmapPointWeight="weight"
        heatmapColorFn={heatmapColor}
        heatmapBandwidth={GLOBE.heatmapBandwidthDegrees} heatmapBaseAltitude={heatmapAltitude} heatmapTopAltitude={heatmapAltitude} heatmapsTransitionDuration={0}
        onHeatmapClick={(_, __, { lat, lng }) => { onSelect({ kind: "location", location: { lat, lng } }); }}
        pointsData={points} pointLat="lat" pointLng="lng" pointColor="color"
        pointRadius={GLOBE.pointRadiusDegrees} pointAltitude={GLOBE.pointAltitude} pointsTransitionDuration={0}
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
        onGlobeClick={({ lat, lng }) => { onSelect({ kind: "location", location: { lat, lng: ((lng + 180) % 360 + 360) % 360 - 180 } }); }}
        onPointClick={(point) => { onSelect({ kind: "event", event: point as Event }); }}
      />}
      </div>
      {!ready && <div className="earth-loading" role="status">Rendering Earth…</div>}
    </div>
    <svg className="connectors" aria-hidden="true">{callouts.map((item) => <path key={item.id} ref={(node) => { if (node) paths.current.set(item.id, node); else paths.current.delete(item.id); }} stroke={item.color} />)}</svg>
    <div className="pins">{callouts.map((item, index) => <button hidden key={item.id} ref={(node) => { if (node) pins.current.set(item.id, node); else pins.current.delete(item.id); }}
      className="earth-pin" style={{ "--pin-color": item.color } as CSSProperties} aria-label={item.event?.title ?? "Selected location"} onClick={() => select(item)}>{index + 1}</button>)}</div>
    <div className="callouts" aria-label="Visible points of interest">{callouts.map((item, index) => {
      const event = item.event;
      const active = event ? selection?.kind === "event" && selection.event.id === event.id : true;
      const href = event && sourceHref(event.sourceUrl);
      return <article hidden key={item.id} ref={(node) => { if (node) cards.current.set(item.id, node); else cards.current.delete(item.id); }} className={`earth-card${active ? " is-selected" : ""}`} style={{ "--pin-color": item.color } as CSSProperties}>
        <div className="card-category"><span>{String(index + 1).padStart(2, "0")} / {event ? LABELS[event.layerId as LayerId] ?? event.layerId : "location"}</span>{fixture && event && <span className="sample-badge">Sample</span>}</div>
        <button className="card-title" onClick={() => select(item)} aria-pressed={active}>{event?.title ?? "Selected location"}</button>
        {item.retained && <p className="retained-note">Selected event · hidden by map filters</p>}
        {event && <p className="card-summary">{event.summary ?? "No summary provided."}</p>}
        <p className="card-coordinates">{coordinate(item.lat, true)}<br />{coordinate(item.lng, false)}{event && <span>{event.geoPrecision} precision</span>}</p>
        {event && <p className="card-time">{eventTime(event.occurredAt)}</p>}
        <div className="card-footer">{href ? <a href={href} target="_blank" rel="noreferrer">{event!.source.toUpperCase()} ↗</a> : <span>{event?.source.toUpperCase() ?? "Coordinates captured"}</span>}
          {active && <button onClick={() => onSelect(null)} aria-label="Clear selection">Clear</button>}</div>
      </article>;
    })}</div>
    <p className="earth-hint">Drag to explore <span>·</span> Scroll to zoom <span>·</span> Click a place</p>
  </div>;
}
