"use client";
import { LAYER_IDS, LABELS, supportsHeatmap, type Filters, type LayerMode } from "@/lib/layers";
export default function LayerControls({ filters, onChange, count, onInteract }: { filters: Filters; onChange: (value: Filters) => void; count: number; onInteract: () => void }) {
  return <details className="layer-menu" onToggle={onInteract}>
    <summary>Layers <span>{LAYER_IDS.filter(id => filters.layers[id].enabled).length}/8</span></summary>
    <div className="layer-panel">
      <h2>Map layers</h2><p className="layer-help">{count} events in enabled layers and time range</p>
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
