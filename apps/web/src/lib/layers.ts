import type { Event } from "./api";

export const CATEGORIES = [
  { id: "security", label: "Conflict & Security", layers: ["conflict", "terror", "crime", "protest", "strategic_development"] },
  { id: "politics", label: "Politics & World", layers: ["politics", "world", "news", "media"] },
  { id: "economy", label: "Economy & Tech", layers: ["finance", "business", "technology", "science"] },
  { id: "society", label: "Humanitarian & Health", layers: ["humanitarian", "famine", "health", "education"] },
  { id: "culture", label: "Culture & Lifestyle", layers: ["culture", "entertainment", "sports", "fashion", "travel", "food"] },
  // Last, so Natural Hazards sits at the bottom of the layer rail.
  { id: "hazards", label: "Natural Hazards", layers: ["earthquake", "wildfire", "cyclone", "flood", "volcano", "drought", "environment"] },
] as const;
export type CategoryId = typeof CATEGORIES[number]["id"];
export const LAYER_IDS = CATEGORIES.flatMap(category => category.layers);
export type LayerId = typeof CATEGORIES[number]["layers"][number];
export const CATEGORY_OF = new Map<LayerId, CategoryId>(CATEGORIES.flatMap(category => category.layers.map(layer => [layer, category.id] as const)));
export type LayerState = Record<LayerId, { enabled: boolean }>;
export type TimeWindow = { startIso: string; endIso: string } | null;
export const MAX_MARKERS = 5000;
export const DEFAULT_MIN_SIGNIFICANCE = 50;
export type Filters = { layers: LayerState; time: TimeWindow; minSignificance: number };
export type HeatmapPoint = { lat: number; lng: number; weight: number };
export type CategoryHeatmap = { id: CategoryId; points: HeatmapPoint[] };
export const LABELS: Record<LayerId, string> = {
  earthquake: "Earthquakes", wildfire: "Wildfires", cyclone: "Cyclones", flood: "Floods", volcano: "Volcanoes", drought: "Droughts", environment: "Environment",
  conflict: "Conflict", terror: "Terror", crime: "Crime", protest: "Protests", strategic_development: "Strategic developments",
  politics: "Government & Politics", world: "World", news: "News", media: "Media",
  finance: "Finance", business: "Business", technology: "Technology", science: "Science",
  humanitarian: "Society", famine: "Famine", health: "Health", education: "Education",
  culture: "Culture", entertainment: "Entertainment", sports: "Sports", fashion: "Fashion", travel: "Travel", food: "Food",
};
// Every layer in these categories starts on; all other categories start off.
export const DEFAULT_CATEGORIES: CategoryId[] = ["security", "politics", "economy"];
export function defaultLayers(): LayerState {
  return Object.fromEntries(LAYER_IDS.map(id => [id, { enabled: DEFAULT_CATEGORIES.includes(CATEGORY_OF.get(id)!) }])) as LayerState;
}
export type CategoryState = "on" | "off" | "partial";
export function categoryState(layers: LayerState, id: CategoryId): CategoryState {
  const members = CATEGORIES.find(category => category.id === id)!.layers;
  const enabled = members.filter(layer => layers[layer].enabled).length;
  return enabled === 0 ? "off" : enabled === members.length ? "on" : "partial";
}
// Enabling a category enables every subcategory; disabling it closes them all.
export function setCategoryEnabled(filters: Filters, id: CategoryId, enabled: boolean): Filters {
  const layers = { ...filters.layers };
  for (const layer of CATEGORIES.find(category => category.id === id)!.layers) layers[layer] = { ...layers[layer], enabled };
  return { ...filters, layers };
}
export function setLayerEnabled(filters: Filters, id: LayerId, enabled: boolean): Filters {
  return { ...filters, layers: { ...filters.layers, [id]: { ...filters.layers[id], enabled } } };
}
export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const layers = defaultLayers();
  if (params.has("layers")) {
    const enabled = new Set(params.get("layers")!.split(","));
    LAYER_IDS.forEach(id => { layers[id].enabled = enabled.has(id); });
  }
  let time: TimeWindow = null;
  const parts = (params.get("t") ?? "").split(",");
  if (parts.length === 2 && parts.every(value => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) && Date.parse(parts[0]) < Date.parse(parts[1])) {
    time = { startIso: new Date(parts[0]).toISOString(), endIso: new Date(parts[1]).toISOString() };
  }
  const rawThreshold = params.get("minSignificance");
  const threshold = rawThreshold?.trim() ? Number(rawThreshold) : NaN;
  const minSignificance = Number.isFinite(threshold) && threshold >= 0 ? threshold : DEFAULT_MIN_SIGNIFICANCE;
  return { layers, time, minSignificance };
}
export function writeFilters(search: string, filters: Filters) {
  const params = new URLSearchParams(search);
  params.set("layers", LAYER_IDS.filter(id => filters.layers[id].enabled).join(","));
  params.set("t", filters.time ? `${filters.time.startIso},${filters.time.endIso}` : "all");
  params.set("minSignificance", String(filters.minSignificance));
  // Retire per-layer heatmap settings; zoom level now chooses heatmap vs markers.
  for (const legacy of ["modes", "heatmap", "weights"]) params.delete(legacy);
  return params.toString();
}
/** Headlines: a top-stories overview for everyone. Explore: every event your filters allow. */
export type ViewTab = "headlines" | "explore" | "feed";
const TABS: ViewTab[] = ["headlines", "explore", "feed"];
export const parseTab = (search: string): ViewTab => {
  const tab = new URLSearchParams(search).get("tab");
  return TABS.includes(tab as ViewTab) ? tab as ViewTab : "headlines";
};
/** Headlines and My Feed are curated lists shown the same way (pins, ring cards, briefing, tour). */
export const isCurated = (tab: ViewTab) => tab !== "explore";
export function writeTab(search: string, tab: ViewTab) {
  const params = new URLSearchParams(search);
  if (tab === "headlines") params.delete("tab"); else params.set("tab", tab);
  return params.toString();
}
/**
 * The Headlines feed ignores map filters: the most significant events overall, at most
 * `perCategory` from any one category so no single category crowds out the rest. If the
 * cap leaves slots empty (few categories have events), the next most significant fill them.
 */
export function headlineFeed(events: Event[], count: number, perCategory: number) {
  const ranked = [...events].sort((a, b) => b.significance - a.significance || a.id.localeCompare(b.id));
  const taken = new Map<CategoryId, number>();
  const picked: Event[] = [];
  for (const event of ranked) {
    const category = CATEGORY_OF.get(event.layerId as LayerId);
    if (!category || (taken.get(category) ?? 0) >= perCategory) continue;
    taken.set(category, (taken.get(category) ?? 0) + 1);
    picked.push(event);
    if (picked.length === count) return picked;
  }
  const chosen = new Set(picked.map(event => event.id));
  return [...picked, ...ranked.filter(event => !chosen.has(event.id)).slice(0, count - picked.length)]
    .sort((a, b) => b.significance - a.significance || a.id.localeCompare(b.id));
}
export function deriveVisuals(events: Event[], { layers, time, minSignificance }: Filters) {
  const start = time ? Date.parse(time.startIso) : -Infinity;
  const end = time ? Date.parse(time.endIso) : Infinity;
  const visible = events.filter(event => {
    const layer = layers[event.layerId as LayerId];
    const occurred = Date.parse(event.occurredAt);
    return layer?.enabled && occurred >= start && occurred < end;
  });
  const markerCandidates = visible.filter(event => event.significance >= minSignificance)
    .sort((a, b) => b.significance - a.significance || a.id.localeCompare(b.id));
  const markers = markerCandidates.slice(0, MAX_MARKERS);
  return { visible, markers, heatmaps: categoryHeatmaps(markers), markerCandidateCount: markerCandidates.length };
}
/** Zoomed-out heatmaps are the density of exactly these markers, one unit each, with one
 * heatmap per category (in the category's color); empty categories are omitted. */
export function categoryHeatmaps(markers: Event[]): CategoryHeatmap[] {
  return CATEGORIES
    .map(category => ({ id: category.id, points: markers.filter(event => CATEGORY_OF.get(event.layerId as LayerId) === category.id).map(event => ({ lat: event.lat, lng: event.lng, weight: 1 })) }))
    .filter(heatmap => heatmap.points.length > 0);
}
/** Keep only markers whose ids are allowed (e.g. events inside selected countries) and
 * rebuild the heatmaps from them, so clusters, pins and heat outside disappear. */
export function restrictVisuals<T extends { markers: Event[] }>(visuals: T, allowed: Set<string>) {
  const markers = visuals.markers.filter(event => allowed.has(event.id));
  return { ...visuals, markers, heatmaps: categoryHeatmaps(markers) };
}
