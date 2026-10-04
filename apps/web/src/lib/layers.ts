import type { Event } from "./api";

export const LAYER_IDS = ["earthquake", "wildfire", "conflict", "politics", "terror", "finance", "humanitarian", "news"] as const;
export type LayerId = typeof LAYER_IDS[number];
export const supportsHeatmap = (id: LayerId) => id === "earthquake" || id === "wildfire";
export type LayerMode = "heatmap" | "markers" | "both";
export type WeightField = "weight";
export type LayerState = Record<LayerId, { enabled: boolean; mode: LayerMode; weightField: WeightField }>;
export type TimeWindow = { startIso: string; endIso: string } | null;
export type Filters = { layers: LayerState; time: TimeWindow };
export type HeatmapData = { id: LayerId; points: { lat: number; lng: number; weight: number }[] };
export const LABELS: Record<LayerId, string> = { earthquake: "Earthquakes", wildfire: "Wildfires", conflict: "Conflict", politics: "Politics", terror: "Terror", finance: "Finance", humanitarian: "Humanitarian", news: "News" };
export function defaultLayers(): LayerState {
  return Object.fromEntries(LAYER_IDS.map(id => [id, { enabled: ["earthquake", "wildfire", "humanitarian"].includes(id), mode: "markers", weightField: "weight" }])) as LayerState;
}
export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const layers = defaultLayers();
  if (params.has("layers")) {
    const enabled = new Set(params.get("layers")!.split(","));
    LAYER_IDS.forEach(id => { layers[id].enabled = enabled.has(id); });
  }
  for (const entry of (params.get("modes") ?? "").split(",")) {
    const [id, mode] = entry.split(":");
    if (LAYER_IDS.includes(id as LayerId) && supportsHeatmap(id as LayerId) && ["markers", "heatmap", "both"].includes(mode)) layers[id as LayerId].mode = mode as LayerMode;
  }
  let time: TimeWindow = null;
  const parts = (params.get("t") ?? "").split(",");
  if (parts.length === 2 && parts.every(value => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) && Date.parse(parts[0]) < Date.parse(parts[1])) {
    time = { startIso: new Date(parts[0]).toISOString(), endIso: new Date(parts[1]).toISOString() };
  }
  return { layers, time };
}
export function writeFilters(search: string, filters: Filters) {
  const params = new URLSearchParams(search);
  params.set("layers", LAYER_IDS.filter(id => filters.layers[id].enabled).join(","));
  params.set("t", filters.time ? `${filters.time.startIso},${filters.time.endIso}` : "all");
  const modes = LAYER_IDS.filter(id => supportsHeatmap(id) && filters.layers[id].mode !== "markers").map(id => `${id}:${filters.layers[id].mode}`);
  if (modes.length) params.set("modes", modes.join(",")); else params.delete("modes");
  // Retire old weight overrides so shared URLs always use backend-supplied weight.
  params.delete("weights");
  return params.toString();
}
export function deriveVisuals(events: Event[], { layers, time }: Filters) {
  const start = time ? Date.parse(time.startIso) : -Infinity;
  const end = time ? Date.parse(time.endIso) : Infinity;
  const visible = events.filter(event => {
    const layer = layers[event.layerId as LayerId];
    const occurred = Date.parse(event.occurredAt);
    return layer?.enabled && occurred >= start && occurred < end;
  });
  const markers = visible.filter(event => !supportsHeatmap(event.layerId as LayerId) || layers[event.layerId as LayerId].mode !== "heatmap");
  // Keep every layer configured; disabled/non-heatmap layers receive empty data.
  const heatmaps: HeatmapData[] = LAYER_IDS.map(id => ({ id, points: supportsHeatmap(id) && layers[id].enabled && layers[id].mode !== "markers" ? visible.filter(event => event.layerId === id).map(event => ({ lat: event.lat, lng: event.lng, weight: Math.max(0, Number(event[layers[id].weightField]) || 0) })) : [] }));
  return { visible, markers, heatmaps };
}
