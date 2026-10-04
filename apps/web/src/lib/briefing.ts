/** Headlines briefing: tour order, ranking, and the facts the details panel shows. Pure functions. */

type Brief = {
  id: string; source: string; layerId: string; significance: number; lat: number; lng: number;
  attributes: Record<string, unknown>; keywords: { text: string; type: string; relevance?: number; confidence?: number }[];
  entities: { text: string; type: string; confidence?: number }[];
};

/** Tour and ‹ › order: north to south, then west to east, so the camera sweeps the map. */
export function tourOrder<T extends Pick<Brief, "id" | "lat" | "lng">>(events: T[]): T[] {
  return [...events].sort((a, b) => b.lat - a.lat || a.lng - b.lng || a.id.localeCompare(b.id));
}

/** 1-based rank by significance among the headlines (0 when absent). */
export function rankOf(id: string, headlines: Pick<Brief, "id" | "significance">[]) {
  const ranked = [...headlines].sort((a, b) => b.significance - a.significance || a.id.localeCompare(b.id));
  return ranked.findIndex(event => event.id === id) + 1;
}

export type Vital = { value: string; label: string; tone?: "green" | "orange" | "red" };
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const titleCase = (value: string) => value.toLowerCase().replace(/(^|[\s/-])\p{L}/gu, match => match.toUpperCase());
const alert = (value: unknown): Vital | null => {
  const level = text(value)?.toLowerCase();
  return level && ["green", "orange", "red"].includes(level) ? { value: titleCase(level), label: "alert", tone: level as Vital["tone"] } : null;
};
const fmt = (value: number, digits = 0) => value.toLocaleString("en", { maximumFractionDigits: digits });

/** Satellite exposure line, or null when this event has not been scored. */
export function impactLabel(attributes: Record<string, unknown> | null | undefined): string | null {
  if (!attributes) return null;
  const klass = text(attributes.impact_class);
  const people = num(attributes.people_exposed);
  const radius = num(attributes.radius_km);
  if (!klass || people === null || radius === null) return null;
  return `${titleCase(klass)} impact · ${fmt(people)} people within ${fmt(radius)} km · JRC GHSL`;
}

/**
 * The (up to) three most telling figures for an event, from its category table. News has
 * no structured figures; its keywords appear as chips instead.
 */
export function vitalSigns(event: Pick<Brief, "source" | "layerId" | "attributes">): Vital[] {
  const a = event.attributes ?? {};
  const out: (Vital | null)[] = [];
  const magnitude = num(a.magnitude);
  if (event.layerId === "earthquake") {
    if (magnitude !== null) out.push({ value: `M ${fmt(magnitude, 1)}`, label: text(a.mag_type) ? `magnitude (${a.mag_type})` : "magnitude" });
    const depth = num(a.depth_km);
    if (depth !== null) out.push({ value: `${fmt(depth)} km`, label: "depth" });
    out.push(alert(a.alert ?? a.alert_level));
    if (a.tsunami === true || a.tsunami === 1) out.push({ value: "Possible", label: "tsunami", tone: "orange" });
    const felt = num(a.felt);
    if (felt) out.push({ value: fmt(felt), label: "felt reports" });
  } else if (event.layerId === "cyclone") {
    const wind = num(a.max_wind_kmh);
    if (wind !== null) out.push({ value: `${fmt(wind)} km/h`, label: "max wind" });
    out.push(alert(a.alert_level));
  } else if (event.layerId === "wildfire" && event.source === "firms") {
    const frp = num(a.max_frp), hotspots = num(a.hotspot_count);
    if (frp !== null) out.push({ value: `${fmt(frp)} MW`, label: "peak fire power" });
    if (hotspots !== null) out.push({ value: fmt(hotspots), label: hotspots === 1 ? "hotspot" : "hotspots" });
    const daynight = text(a.daynight);
    if (daynight) out.push({ value: daynight === "N" ? "Night" : "Day", label: "detected" });
  } else if (event.layerId === "wildfire") {
    const area = num(a.burned_area_ha);
    if (area !== null) out.push({ value: `${fmt(area)} ha`, label: "burned area" });
    out.push(alert(a.alert_level));
  } else if (event.layerId === "flood") {
    out.push(alert(a.alert_level));
    const country = text(a.country);
    if (country) out.push({ value: country, label: "country" });
  } else {
    // Conflict and protest rows name who was involved.
    const actor1 = text(a.actor1), actor2 = text(a.actor2);
    if (actor1) out.push({ value: titleCase(actor1), label: actor2 ? "side A" : "actor" });
    if (actor2) out.push({ value: titleCase(actor2), label: "side B" });
    const location = text(a.location);
    if (location) out.push({ value: location, label: "location" });
  }
  return out.filter((vital): vital is Vital => !!vital).slice(0, 3);
}

/** A readable place for the event, if the data names one. */
export function placeLabel(event: Pick<Brief, "attributes" | "keywords">): string | null {
  const a = event.attributes ?? {};
  return text(a.place) ?? text(a.country) ?? text(a.location)
    ?? event.keywords.find(keyword => keyword.type === "location" || keyword.type === "place")?.text ?? null;
}

export type ChipKind = "person" | "organization" | "place" | "actor" | "topic";
const KIND: Record<string, ChipKind> = {
  person: "person", organization: "organization", org: "organization", location: "place", place: "place", actor: "actor",
};
const ORDER: ChipKind[] = ["person", "organization", "actor", "place", "topic"];

/** People, organisations, places and topics named by the event, deduplicated, most relevant first. */
export function chips(event: Pick<Brief, "keywords" | "entities" | "attributes">, limit = 10) {
  const place = placeLabel(event)?.toLowerCase();
  const terms = [...event.entities, ...event.keywords]
    .map((term: { text: string; type: string; relevance?: number; confidence?: number }) =>
      ({ text: term.text.trim(), kind: KIND[term.type] ?? "topic", weight: term.relevance ?? term.confidence ?? 0 }))
    .filter(term => term.text && term.text.toLowerCase() !== place);
  const seen = new Set<string>();
  return terms
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.weight - a.weight)
    .filter(term => !seen.has(term.text.toLowerCase()) && seen.add(term.text.toLowerCase()))
    .slice(0, limit)
    .map(({ text, kind }) => ({ text: kind === "actor" ? titleCase(text) : text, kind }));
}

/**
 * Orthographic projection of country outlines for the locator globe, centred on (lat0, lng0)
 * with radius r and the centre at (0, 0); SVG y points down. Rings fully on the near side
 * are filled shapes; rings crossing the horizon are drawn as visible coastline segments only.
 */
export function locatorPaths(polygons: number[][][][], lat0: number, lng0: number, r: number) {
  const rad = Math.PI / 180, phi0 = lat0 * rad, sin0 = Math.sin(phi0), cos0 = Math.cos(phi0);
  const project = ([lng, lat]: number[]) => {
    const phi = lat * rad, dl = (lng - lng0) * rad, cosPhi = Math.cos(phi);
    const near = sin0 * Math.sin(phi) + cos0 * cosPhi * Math.cos(dl) >= 0;
    return { near, x: r * cosPhi * Math.sin(dl), y: -r * (cos0 * Math.sin(phi) - sin0 * cosPhi * Math.cos(dl)) };
  };
  const p = (v: number) => v.toFixed(1);
  let fill = "", line = "";
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const points = ring.map(project);
      if (points.every(point => point.near)) {
        fill += points.map((point, i) => `${i ? "L" : "M"}${p(point.x)} ${p(point.y)}`).join("") + "Z";
      } else {
        let open = false;
        for (const point of points) {
          if (!point.near) { open = false; continue; }
          line += `${open ? "L" : "M"}${p(point.x)} ${p(point.y)}`;
          open = true;
        }
      }
    }
  }
  return { fill, line };
}
