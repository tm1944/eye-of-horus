import type { Event } from "./api";

export const LAYER_IDS = ["technology", "politics", "finance", "humanitarian", "conflict", "news", "earthquake", "wildfire", "terror"] as const;
export type LayerId = typeof LAYER_IDS[number];
export const supportsHeatmap = (id: LayerId) => id === "earthquake" || id === "wildfire";
export type LayerMode = "heatmap" | "markers" | "both";
export type WeightField = "weight";
export type LayerState = Record<LayerId, { enabled: boolean; mode: LayerMode; weightField: WeightField }>;
export type TimeWindow = { startIso: string; endIso: string } | null;
export const MAX_MARKERS = 5000;
export const DEFAULT_MIN_SIGNIFICANCE = 50;
export type DensityLayerId = "earthquake" | "wildfire";
export type Filters = { layers: LayerState; time: TimeWindow; minSignificance: number; heatmapLayer: DensityLayerId };
export type HeatmapData = { id: LayerId; points: { lat: number; lng: number; weight: number }[] };
export const LABELS: Record<LayerId, string> = { technology: "Technology", politics: "Government & Politics", finance: "Finance", humanitarian: "Society", conflict: "Conflict", news: "News", earthquake: "Earthquakes", wildfire: "Wildfires", terror: "Terror" };
export function defaultLayers(): LayerState {
  return Object.fromEntries(LAYER_IDS.map(id => [id, { enabled: ["technology", "politics", "finance", "humanitarian"].includes(id), mode: supportsHeatmap(id) ? "both" : "markers", weightField: "weight" }])) as LayerState;
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
  const rawThreshold = params.get("minSignificance");
  const threshold = rawThreshold?.trim() ? Number(rawThreshold) : NaN;
  const minSignificance = Number.isFinite(threshold) && threshold >= 0 ? threshold : DEFAULT_MIN_SIGNIFICANCE;
  const heatmapLayer = params.get("heatmap") === "earthquake" ? "earthquake" : "wildfire";
  return { layers, time, minSignificance, heatmapLayer };
}
export function writeFilters(search: string, filters: Filters) {
  const params = new URLSearchParams(search);
  params.set("layers", LAYER_IDS.filter(id => filters.layers[id].enabled).join(","));
  params.set("t", filters.time ? `${filters.time.startIso},${filters.time.endIso}` : "all");
  const modes = LAYER_IDS.filter(id => supportsHeatmap(id) && filters.layers[id].mode !== "both").map(id => `${id}:${filters.layers[id].mode}`);
  if (modes.length) params.set("modes", modes.join(",")); else params.delete("modes");
  params.set("minSignificance", String(filters.minSignificance));
  params.set("heatmap", filters.heatmapLayer);
  // Retire old weight overrides so shared URLs always use backend-supplied weight.
  params.delete("weights");
  return params.toString();
}
export function deriveVisuals(events: Event[], { layers, time, minSignificance, heatmapLayer }: Filters) {
  const start = time ? Date.parse(time.startIso) : -Infinity;
  const end = time ? Date.parse(time.endIso) : Infinity;
  const visible = events.filter(event => {
    const layer = layers[event.layerId as LayerId];
    const occurred = Date.parse(event.occurredAt);
    return layer?.enabled && occurred >= start && occurred < end;
  });
  const markerCandidates = visible.filter(event => event.significance >= minSignificance && (!supportsHeatmap(event.layerId as LayerId) || layers[event.layerId as LayerId].mode !== "heatmap"))
    .sort((a, b) => b.significance - a.significance || a.id.localeCompare(b.id));
  const markers = markerCandidates.slice(0, MAX_MARKERS);
  // Density retains low-significance events; the threshold/cap only affect markers.
  const densityLayers = LAYER_IDS.filter(id => supportsHeatmap(id) && layers[id].enabled && layers[id].mode !== "markers" && visible.some(event => event.layerId === id));
  const activeHeatmapId = densityLayers.includes(heatmapLayer) ? heatmapLayer : densityLayers[0] ?? null;
  // All layer configs persist, but at most one receives heatmap data.
  const heatmaps: HeatmapData[] = LAYER_IDS.map(id => ({ id, points: id === activeHeatmapId ? visible.filter(event => event.layerId === id).map(event => ({ lat: event.lat, lng: event.lng, weight: Math.max(0, Number(event[layers[id].weightField]) || 0) })) : [] }));
  return { visible, markers, heatmaps, activeHeatmapId, markerCandidateCount: markerCandidates.length };
}
