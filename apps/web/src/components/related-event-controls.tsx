"use client";

import type { Event, EventLink } from "@/lib/api";
import { otherEnd } from "@/lib/related-events";

type Props = {
  event: Event;
  allEvents: Event[];
  /** This event's links, or undefined while all links are still loading. */
  links?: EventLink[];
  error?: string;
  onVisit: (target: Event) => void;
};

export const relationLabel = (relation: string) => relation.replaceAll(/[-_]/g, " ");

/** Links come preloaded with the events; each row navigates to the linked event. */
export default function RelatedEventControls({ event, allEvents, links, error, onVisit }: Props) {
  const byId = new Map(allEvents.map(item => [item.id, item]));
  const related: { target: Event; link: EventLink }[] = [];
  let missing = 0;
  for (const link of links ?? []) {
    const target = byId.get(otherEnd(link, event.id));
    if (!target || target.id === event.id) { missing += Number(!target); continue; }
    related.push({ target, link });
  }
  related.sort((a, b) => b.link.confidence - a.link.confidence);
  return <section className="card-related" aria-label="Related events">
    <h3>Related events</h3>
    {!links && !error && <p role="status">Loading related events…</p>}
    {error && <p role="alert">{error}</p>}
    {links && !related.length && <p>No related events available.</p>}
    {missing > 0 && <p>{missing} linked event(s) are not in the loaded dataset.</p>}
    {related.map(({ target, link }) => <div key={link.id}>
      <button onClick={() => onVisit(target)}>{target.title} <span aria-hidden="true">↗</span></button>
      <p className="relationship-context">{relationLabel(link.relation)} · {Math.round(link.confidence * 100)}% · Hypothesis</p>
    </div>)}
  </section>;
}
