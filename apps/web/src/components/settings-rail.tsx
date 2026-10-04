"use client";
import type { ReactNode } from "react";
import { useFlyout } from "@/lib/use-flyout";
import RailIcon, { type IconId, type PanelId } from "@/components/icons";

export type SettingsPanel = { id: PanelId; label: string; badge?: number; active?: boolean; content: ReactNode };
export type RailAction = { id: string; label: string; icon: IconId; onClick: () => void; pressed?: boolean; disabled?: boolean };

const flyoutWidth = (id: string) => id.startsWith("action:") ? undefined : 270;

/** Right icon rail. Action icons act on click and show their name on hover; panel
 * icons open their controls in a flyout to the left. Every panel stays mounted
 * (hidden when inactive) so form and disclosure state survive. */
export default function SettingsRail({ actions, panels, reflowKey }: { actions: RailAction[]; panels: SettingsPanel[]; reflowKey: unknown }) {
  const { flyout, toggle, itemProps, panelProps } = useFlyout<string>("left", flyoutWidth, reflowKey);
  const activeAction = actions.find(action => flyout?.id === `action:${action.id}`);
  return <nav className="icon-rail settings-rail" data-rail aria-label="View and filter settings">
    {actions.length > 0 && <ul>
      {actions.map(action => <li key={action.id} {...itemProps(`action:${action.id}`)}>
        <button type="button" className="rail-icon" data-state={action.pressed ? "on" : "off"} aria-pressed={action.pressed}
          aria-label={action.label} disabled={action.disabled} onClick={action.onClick}>
          <RailIcon id={action.icon} />
        </button>
      </li>)}
    </ul>}
    <ul>
      {panels.map(panel => <li key={panel.id} {...itemProps(panel.id)}>
        <button type="button" className="rail-icon" data-state={panel.active ? "on" : "off"} data-open={flyout?.id === panel.id || undefined}
          aria-expanded={flyout?.id === panel.id} aria-controls={`settings-${panel.id}`} aria-label={panel.label}
          onClick={e => toggle(panel.id, e.currentTarget.closest("li")!)}>
          <RailIcon id={panel.id} />
          {!!panel.badge && <span className="rail-badge">{panel.badge}</span>}
        </button>
      </li>)}
    </ul>
    {activeAction && <div className="category-flyout rail-label" role="tooltip" style={flyout?.style}>{activeAction.label}</div>}
    <div className="category-flyout settings-flyout" hidden={!flyout || !!activeAction} style={flyout?.style} {...panelProps}>
      {panels.map(panel => <section key={panel.id} id={`settings-${panel.id}`} hidden={flyout?.id !== panel.id} aria-labelledby={`settings-${panel.id}-title`}>
        <h2 className="flyout-title" id={`settings-${panel.id}-title`}>{panel.label}</h2>
        {panel.content}
      </section>)}
    </div>
  </nav>;
}
