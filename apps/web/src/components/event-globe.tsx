"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { AmbientLight, DirectionalLight, PerspectiveCamera, Vector3 } from "three";
import type { Event } from "@/lib/api";
import { GLOBE, eventColor } from "@/lib/globe-config";

export type Location = { lat: number; lng: number };
/** Integration hook: these selections are local; they never submit a request. */
export type Selection = { kind: "location"; location: Location } | { kind: "event"; event: Event };
type Callout = Location & { id: string; color: string; event?: Event };

const coordinate = (value: number, latitude: boolean) => `${Math.abs(value).toFixed(4)}° ${latitude ? value < 0 ? "S" : "N" : value < 0 ? "W" : "E"}`;
const eventTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }).format(date) + " UTC";
};
const sourceHref = (value: string | null) => {
  try { const url = new URL(value ?? ""); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
};

export default function EventGlobe({ events, selection, onSelect, rotating, onRotationChange, fixture }: {
  events: Event[];
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  rotating: boolean;
  onRotationChange: (rotating: boolean) => void;
  fixture: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const cards = useRef(new Map<string, HTMLElement>());
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
      if (media.matches) onRotationChange(false);
    };
    media.addEventListener("change", change);
    return () => { observer.disconnect(); media.removeEventListener("change", change); };
  }, [onRotationChange]);

  useEffect(() => {
    if (!ready || !globe.current) return;
    const controls = globe.current.controls();
    controls.autoRotate = rotating;
    controls.autoRotateSpeed = GLOBE.rotationSpeed;
  }, [rotating, ready]);

  // Fit the entire sphere inside the central canvas, keeping side cards outside Earth.
  useEffect(() => {
    if (!ready || !globe.current || !size.width || !size.height) return;
    const instance = globe.current;
    const camera = instance.camera() as PerspectiveCamera;
    const radius = instance.getGlobeRadius();
    const focalPixels = size.height / (2 * Math.tan(camera.fov * Math.PI / 360));
    const screenRadius = Math.min(size.width * GLOBE.surfaceFitWidth, size.height * GLOBE.surfaceFitHeight);
    const distance = Math.sqrt(radius ** 2 + (focalPixels * radius / screenRadius) ** 2);
    instance.controls().minDistance = distance;
    instance.controls().maxDistance = distance * GLOBE.zoomOutMultiplier;
    instance.pointOfView({ altitude: distance / radius - 1 });
  }, [ready, size]);

  const callouts = useMemo<Callout[]>(() => {
    const selectedId = selection?.kind === "event" ? selection.event.id : null;
    const ranked = [...events].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) || b.significance - a.significance || a.id.localeCompare(b.id));
    const result = ranked.slice(0, GLOBE.maxCallouts - Number(selection?.kind === "location")).map((event) => ({ id: event.id, lat: event.lat, lng: event.lng, color: eventColor(event.layerId), event }));
    return selection?.kind === "location" ? [{ id: "selected-location", ...selection.location, color: GLOBE.colors.selected }, ...result] : result;
  }, [events, selection]);

  // Update only projected DOM positions each frame, not React state or backend data.
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const update = () => {
      const instance = globe.current;
      if (instance && stage.current && container.current) {
        const stageRect = stage.current.getBoundingClientRect();
        const canvasRect = container.current.getBoundingClientRect();
        const offsetX = canvasRect.left - stageRect.left;
        const offsetY = canvasRect.top - stageRect.top;
        const camera = instance.camera().position;
        const radius = instance.getGlobeRadius();
        const desktop = stageRect.width >= GLOBE.desktopBreakpointPx;
        const visible: { item: Callout; x: number; y: number; side: "left" | "right" }[] = [];
        for (const item of callouts) {
          const surface = instance.getCoords(item.lat, item.lng);
          const normal = new Vector3(surface.x, surface.y, surface.z).normalize();
          // Perspective horizon: a point is visible only when n·camera > radius.
          const front = normal.dot(camera) > radius + 0.5;
          const point = instance.getScreenCoords(item.lat, item.lng, GLOBE.pointAltitude);
          const shown = front && point.x > 0 && point.x < canvasRect.width && point.y > 0 && point.y < canvasRect.height;
          const card = cards.current.get(item.id), pin = pins.current.get(item.id), path = paths.current.get(item.id);
          if (!card || !pin || !path) continue;
          card.hidden = !shown; pin.hidden = !shown; path.style.display = shown ? "" : "none";
          if (!shown) continue;
          const x = point.x + offsetX, y = point.y + offsetY;
          pin.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
          visible.push({ item, x, y, side: point.x < canvasRect.width / 2 ? "left" : "right" });
        }
        // Balance crowded hemispheres across two rails, then sort vertically to reduce crossings.
        if (desktop) {
          for (const side of ["left", "right"] as const) {
            const group = visible.filter((entry) => entry.side === side);
            group.slice(2).forEach((entry) => { entry.side = side === "left" ? "right" : "left"; });
          }
          for (const side of ["left", "right"] as const) {
            const group = visible.filter((entry) => entry.side === side).sort((a, b) => a.y - b.y);
            const totalHeight = group.reduce((sum, entry) => sum + (cards.current.get(entry.item.id)?.offsetHeight ?? 0), 0) + Math.max(0, group.length - 1) * GLOBE.cardGapPx;
            let top = Math.max(80, (canvasRect.height - totalHeight) / 2);
            for (const entry of group) {
              const card = cards.current.get(entry.item.id)!;
              card.style.left = side === "left" ? "24px" : `${stageRect.width - card.offsetWidth - 24}px`;
              card.style.top = `${top}px`;
              top += card.offsetHeight + GLOBE.cardGapPx;
            }
          }
        } else {
          visible.forEach(({ item }) => { const card = cards.current.get(item.id)!; card.style.left = ""; card.style.top = ""; });
        }
        const placedPins: { x: number; y: number }[] = [];
        for (const { item, x, y, side } of visible) {
          // Keep nearby events separately clickable without moving their true anchors.
          let pinY = y;
          while (placedPins.some((pin) => Math.hypot(pin.x - x, pin.y - pinY) < 34)) pinY += 36;
          placedPins.push({ x, y: pinY });
          pins.current.get(item.id)!.style.transform = `translate(${x}px, ${pinY}px) translate(-50%, -50%)`;
          const rect = cards.current.get(item.id)!.getBoundingClientRect();
          const endX = desktop ? (side === "left" ? rect.right : rect.left) - stageRect.left : rect.left - stageRect.left + rect.width / 2;
          const endY = desktop ? rect.top - stageRect.top + rect.height / 2 : rect.top - stageRect.top;
          const bendX = desktop ? (side === "left" ? offsetX - 12 : offsetX + canvasRect.width + 12) : x;
          const bendY = desktop ? y : canvasRect.bottom - stageRect.top + 12;
          paths.current.get(item.id)!.setAttribute("d", `M ${x - 3} ${y} a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0 M ${x} ${y} L ${x} ${pinY} L ${bendX} ${desktop ? pinY : bendY} L ${endX} ${endY}`);
        }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [ready, callouts]);

  const points = useMemo(() => events.map((event) => ({ ...event, color: eventColor(event.layerId) })), [events]);
  function pause() {
    if (globe.current) globe.current.controls().autoRotate = false;
    onRotationChange(false);
  }
  function select(item: Callout) {
    pause();
    onSelect(item.event ? { kind: "event", event: item.event } : { kind: "location", location: { lat: item.lat, lng: item.lng } });
  }

  return <div className="earth-stage" ref={stage}>
    <div className="earth-controls"><button onClick={() => onRotationChange(!rotating)} disabled={!ready} aria-pressed={rotating}>{rotating ? "Pause rotation" : "Resume rotation"}</button></div>
    <div className="earth-canvas" ref={container} role="region" aria-label="Interactive Earth. Drag to rotate, scroll to zoom, click to select a location."
      onPointerDownCapture={pause} onWheelCapture={pause}>
      {size.width > 0 && <Globe ref={globe} width={size.width} height={size.height}
        backgroundColor="rgba(0,0,0,0)" globeImageUrl="/textures/earth-blue-marble.jpg"
        atmosphereColor={GLOBE.atmosphereColor} atmosphereAltitude={GLOBE.atmosphereAltitude} animateIn={false}
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
        onGlobeClick={({ lat, lng }) => { pause(); onSelect({ kind: "location", location: { lat, lng: ((lng + 180) % 360 + 360) % 360 - 180 } }); }}
        onPointClick={(point) => { pause(); onSelect({ kind: "event", event: point as Event }); }}
      />}
      {!ready && <div className="earth-loading" role="status">Rendering Earth…</div>}
    </div>
    <svg className="connectors" aria-hidden="true">{callouts.map((item) => <path key={item.id} ref={(node) => { if (node) paths.current.set(item.id, node); else paths.current.delete(item.id); }} stroke={item.color} />)}</svg>
    <div className="pins">{callouts.map((item, index) => <button hidden key={item.id} ref={(node) => { if (node) pins.current.set(item.id, node); else pins.current.delete(item.id); }}
      className="earth-pin" style={{ "--pin-color": item.color } as CSSProperties} aria-label={item.event?.title ?? "Selected location"} onClick={() => select(item)}>{index + 1}</button>)}</div>
    <div className="callouts" aria-label="Visible points of interest">{callouts.map((item, index) => {
      const event = item.event;
      const active = event ? selection?.kind === "event" && selection.event.id === event.id : true;
      const href = event && sourceHref(event.sourceUrl);
      return <article hidden key={item.id} onPointerEnter={pause} onFocus={pause} ref={(node) => { if (node) cards.current.set(item.id, node); else cards.current.delete(item.id); }} className={`earth-card${active ? " is-selected" : ""}`} style={{ "--pin-color": item.color } as CSSProperties}>
        <div className="card-category"><span>{String(index + 1).padStart(2, "0")} / {event?.layerId ?? "location"}</span>{fixture && event && <span className="sample-badge">Sample</span>}</div>
        <button className="card-title" onClick={() => select(item)} aria-pressed={active}>{event?.title ?? "Selected location"}</button>
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
