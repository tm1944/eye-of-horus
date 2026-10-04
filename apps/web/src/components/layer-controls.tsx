"use client";
import { CATEGORIES, LAYER_IDS, LABELS, MAX_MARKERS, categoryState, setCategoryEnabled, setLayerEnabled, type CategoryId, type Filters } from "@/lib/layers";
import { eventColor } from "@/lib/globe-config";
import { useFlyout } from "@/lib/use-flyout";
import RailIcon from "@/components/icons";

const flyoutWidth = () => 230;

/** Left icon rail. Clicking an icon toggles the whole category; hovering shows its
 * name and subcategories in a flyout to the right. */
export default function LayerRail({ filters, onChange }: { filters: Filters; onChange: (value: Filters) => void }) {
  const { flyout, open, itemProps, panelProps } = useFlyout<CategoryId>("right", flyoutWidth, filters);
  const enabledCount = LAYER_IDS.filter(id => filters.layers[id].enabled).length;
  const active = flyout && CATEGORIES.find(category => category.id === flyout.id)!;
  const activeState = active && categoryState(filters.layers, active.id);

  return <nav className="icon-rail layer-rail" data-rail aria-label="Map layers">
    <span className="rail-count" title="Enabled layers">{enabledCount}<small>/{LAYER_IDS.length}</small></span>
    <ul>
      {CATEGORIES.map(category => {
        const state = categoryState(filters.layers, category.id);
        const on = category.layers.filter(id => filters.layers[id].enabled).length;
        return <li key={category.id} {...itemProps(category.id)}>
          <button type="button" className="rail-icon" data-state={state} data-open={flyout?.id === category.id || undefined}
            aria-pressed={state === "on" ? true : state === "partial" ? "mixed" : false} aria-controls="category-flyout"
            aria-label={`${category.label}, ${on} of ${category.layers.length} layers on`}
            style={{ "--category-color": eventColor(category.layers[0]) } as React.CSSProperties}
            onClick={e => { onChange(setCategoryEnabled(filters, category.id, state !== "on")); open(category.id, e.currentTarget.closest("li")!); }}>
            <RailIcon id={category.id} />
            {state === "partial" && <span className="rail-badge">{on}</span>}
          </button>
        </li>;
      })}
    </ul>
    {active && <div id="category-flyout" className="category-flyout" role="group" aria-label={`${active.label} subcategories`} style={flyout.style} {...panelProps}>
      {/* No checkbox here: the heading toggles the whole category, like its rail icon. */}
      <button type="button" className="flyout-heading" data-enabled={activeState !== "off" || undefined}
        aria-pressed={activeState === "on" ? true : activeState === "partial" ? "mixed" : false}
        onClick={() => onChange(setCategoryEnabled(filters, active.id, activeState !== "on"))}>
        <span>{active.label}</span>
        <small>{active.layers.filter(id => filters.layers[id].enabled).length}/{active.layers.length}</small>
      </button>
      {active.layers.map(id => <div key={id} className="subcategory-row" data-enabled={filters.layers[id].enabled || undefined}>
        <label className="subcategory-toggle">
          <input type="checkbox" checked={filters.layers[id].enabled} onChange={e => onChange(setLayerEnabled(filters, id, e.target.checked))} />
          <span className="category-dot" style={{ background: eventColor(id) }} />
          {LABELS[id]}
        </label>
      </div>)}
    </div>}
  </nav>;
}

/** Significance and time settings for the right-hand rail. */
export function DisplaySettings({ filters, onChange, count, markerCount, markerCandidateCount }: { filters: Filters; onChange: (value: Filters) => void; count: number; markerCount: number; markerCandidateCount: number }) {
  return <>
    <p className="layer-help">{count} events in enabled layers and time range</p>
    <div className="render-controls">
      <label>Minimum marker significance<input aria-label="Minimum marker significance" type="number" min="0" step="1" value={filters.minSignificance} onChange={e => {
        const value = e.target.valueAsNumber;
        if (Number.isFinite(value) && value >= 0) onChange({ ...filters, minSignificance: value });
      }} /></label>
      <p className="layer-help">{markerCount.toLocaleString()} markers · limit {MAX_MARKERS.toLocaleString()}{markerCandidateCount > MAX_MARKERS ? ` (${markerCandidateCount.toLocaleString()} qualify; highest significance shown)` : ""}</p>
      <p className="layer-help">At the default zoom these markers form a heatmap over land; zoom in to see individual markers.</p>
    </div>
    <div className="time-summary">{filters.time ? <><span>{filters.time.startIso} → {filters.time.endIso}</span><button onClick={() => onChange({ ...filters, time: null })}>Clear time range</button></> : "All times"}</div>
  </>;
}
