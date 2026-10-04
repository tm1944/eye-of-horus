"use client";
import type { KeyboardEvent } from "react";
import type { ViewTab } from "@/lib/layers";

const TABS: { id: ViewTab; label: string; hint: string }[] = [
  { id: "headlines", label: "Headlines", hint: "Top stories across every category" },
  { id: "explore", label: "Explore", hint: "Every event your filters allow" },
];

/** Top-of-globe tabs: two separate feeds, not a display setting. Arrow keys move between them. */
export default function ViewTabs({ tab, onChange }: { tab: ViewTab; onChange: (tab: ViewTab) => void }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const index = TABS.findIndex(item => item.id === tab);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    onChange(next.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  }
  return <div className="view-tabs" role="tablist" aria-label="Feed" onKeyDown={onKeyDown}>
    {TABS.map(item => <button key={item.id} type="button" role="tab" data-tab={item.id} title={item.hint}
      aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => onChange(item.id)}>
      {item.label}
    </button>)}
  </div>;
}
