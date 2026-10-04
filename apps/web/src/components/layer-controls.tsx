"use client";
import { LAYER_IDS, LABELS, supportsHeatmap, MAX_MARKERS, type DensityLayerId, type LayerId, type Filters, type LayerMode } from "@/lib/layers";
export default function LayerControls({ filters, onChange, count, markerCount, markerCandidateCount, activeHeatmapId }: { filters: Filters; onChange: (value: Filters) => void; count: number; markerCount: number; markerCandidateCount: number; activeHeatmapId: LayerId | null }) {
  return <details className="layer-menu" open>
    <summary>Layers <span>{LAYER_IDS.filter(id => filters.layers[id].enabled).length}/{LAYER_IDS.length}</span></summary>
    <div className="layer-panel">
      <h2>Map layers</h2><p className="layer-help">{count} events in enabled layers and time range</p>
      <div className="render-controls">
        <label>Minimum marker significance<input aria-label="Minimum marker significance" type="number" min="0" step="1" value={filters.minSignificance} onChange={e => {
          const value = e.target.valueAsNumber;
          if (Number.isFinite(value) && value >= 0) onChange({ ...filters, minSignificance: value });
        }} /></label>
        {LAYER_IDS.some(id => supportsHeatmap(id) && filters.layers[id].enabled) && <label>Heatmap focus<select aria-label="Heatmap focus" value={filters.heatmapLayer} onChange={e => onChange({ ...filters, heatmapLayer: e.target.value as DensityLayerId })}><option value="wildfire">Wildfires</option><option value="earthquake">Earthquakes</option></select></label>}
        <p className="layer-help">{markerCount.toLocaleString()} markers · limit {MAX_MARKERS.toLocaleString()}{markerCandidateCount > MAX_MARKERS ? ` (${markerCandidateCount.toLocaleString()} qualify; highest significance shown)` : ""}</p>
        {LAYER_IDS.some(id => supportsHeatmap(id) && filters.layers[id].enabled) && <p className="layer-help">Heatmap: {activeHeatmapId ? LABELS[activeHeatmapId] : "None"}. Uses all events in that layer’s time range. If the focus is unavailable, the other enabled density layer is used.</p>}
      </div>
      {LAYER_IDS.map(id => <fieldset key={id} className="layer-row">
        <legend className="sr-only">{LABELS[id]}</legend>
        <label className="layer-toggle"><input type="checkbox" checked={filters.layers[id].enabled} onChange={e => onChange({ ...filters, layers: { ...filters.layers, [id]: { ...filters.layers[id], enabled: e.target.checked } } })} />{LABELS[id]}</label>
        <div className="layer-options">
          {supportsHeatmap(id) ? <>
          <label>Display<select aria-label={`${LABELS[id]} display mode`} value={filters.layers[id].mode} onChange={e => onChange({ ...filters, layers: { ...filters.layers, [id]: { ...filters.layers[id], mode: e.target.value as LayerMode } } })}><option value="markers">Markers</option><option value="heatmap">Heatmap</option><option value="both">Both</option></select></label>
          </> : <span className="layer-help">Individual POI markers</span>}
        </div>
      </fieldset>)}
      <div className="time-summary">{filters.time ? <><span>{filters.time.startIso} → {filters.time.endIso}</span><button onClick={() => onChange({ ...filters, time: null })}>Clear time range</button></> : "All times"}</div>
    </div>
  </details>;
}
