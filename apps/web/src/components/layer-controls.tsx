"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { CATEGORIES, LAYER_IDS, LABELS, MAX_MARKERS, categoryState, setCategoryEnabled, setLayerEnabled, type CategoryId, type Filters } from "@/lib/layers";
import { eventColor } from "@/lib/globe-config";
import { useFlyout } from "@/lib/use-flyout";
import RailIcon, { type PanelId } from "@/components/icons";

export type RailPanel = { id: PanelId; label: string; badge?: number; active?: boolean; content: ReactNode };
type FlyoutId = CategoryId | PanelId;
const PANEL_IDS: readonly string[] = ["countries", "significance"] satisfies PanelId[];
const isPanel = (id: string): id is PanelId => PANEL_IDS.includes(id);
// The countries panel holds headline cards, so it is the widest.
const flyoutWidth = (id: FlyoutId) => id === "countries" ? 320 : id === "significance" ? 270 : 230;

/** Left icon rail. On top, the panels (selected countries, significance), which open their
 * controls in a flyout to the right; below a divider, one icon per layer category: clicking
 * toggles the whole category, hovering shows its name and subcategories. Panels stay
 * mounted (hidden when inactive) so form and disclosure state survive. */
export default function LayerRail({ filters, onChange, panels, reflowKey, openRequest, closeRequest }: {
  filters: Filters;
  onChange: (value: Filters) => void;
  panels: RailPanel[];
  reflowKey: unknown;
  /** Opens a panel without a hover or click (e.g. when a country is selected); bump `key` to re-open. */
  openRequest?: { id: PanelId; key: number } | null;
  /** Bump to close the open flyout (e.g. after a pick inside it). */
  closeRequest?: number;
}) {
  const { flyout, open, close, toggle, itemProps, panelProps } = useFlyout<FlyoutId>("right", flyoutWidth, reflowKey);
  const items = useRef(new Map<string, HTMLLIElement>());
  const requested = openRequest?.key;
  useEffect(() => {
    if (!openRequest) return;
    const item = items.current.get(openRequest.id);
    if (item) open(openRequest.id, item);
    // Only a new request re-opens; the panel then closes like any other flyout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);
  useEffect(() => {
    if (closeRequest) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeRequest]);
  const enabledCount = LAYER_IDS.filter(id => filters.layers[id].enabled).length;
  const active = flyout && !isPanel(flyout.id) ? CATEGORIES.find(category => category.id === flyout.id)! : null;
  const activeState = active && categoryState(filters.layers, active.id);

  return <nav className="icon-rail layer-rail" data-rail aria-label="Map settings and layers">
    <ul className="rail-panels">
      {panels.map(panel => <li key={panel.id} ref={node => { if (node) items.current.set(panel.id, node); else items.current.delete(panel.id); }} {...itemProps(panel.id)}>
        <button type="button" className="rail-icon" data-state={panel.active ? "on" : "off"} data-open={flyout?.id === panel.id || undefined}
          aria-expanded={flyout?.id === panel.id} aria-controls={`settings-${panel.id}`} aria-label={panel.label}
          onClick={e => toggle(panel.id, e.currentTarget.closest("li")!)}>
          <RailIcon id={panel.id} />
          {!!panel.badge && <span className="rail-badge">{panel.badge}</span>}
        </button>
      </li>)}
    </ul>
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
    {active && <div id="category-flyout" className="category-flyout" role="group" aria-label={`${active.label} subcategories`} style={flyout!.style} {...panelProps}>
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
    <div className="category-flyout settings-flyout" hidden={!flyout || !isPanel(flyout.id)} style={flyout?.style} {...(flyout && isPanel(flyout.id) ? panelProps : {})}>
      {panels.map(panel => <section key={panel.id} id={`settings-${panel.id}`} hidden={flyout?.id !== panel.id} aria-labelledby={`settings-${panel.id}-title`}>
        <h2 className="flyout-title" id={`settings-${panel.id}-title`}>{panel.label}</h2>
        {panel.content}
      </section>)}
    </div>
  </nav>;
}

/** Significance and time settings (a rail panel). */
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
