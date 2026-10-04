"use client";

import { useEffect, useState } from "react";
import { getEventLinks, type Event, type EventLink } from "@/lib/api";
import type { Connection } from "@/lib/related-events";

type Props = {
  event: Event;
  allEvents: Event[];
  connections: Connection<Event>[];
  rootId?: string;
  onVisit: (source: Event, target: Event) => void;
  onAdd: (source: Event, target: Event) => void;
  onRemove: (id: string) => void;
  onClear: (source: Event) => void;
};

/** Fetch only when the card is expanded; cancellation prevents stale card results. */
export default function RelatedEventControls({ event, allEvents, connections, rootId, onVisit, onAdd, onRemove, onClear }: Props) {
  const [result, setResult] = useState<{ links?: EventLink[]; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getEventLinks(event.id, controller.signal).then(links => setResult({ links })).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ error: error instanceof Error ? error.message : "Unable to load related events." });
    });
    return () => controller.abort();
  }, [event.id, attempt]);
  const byId = new Map(allEvents.map(item => [item.id, item]));
  const related = new Map<string, { target: Event; link?: EventLink }>();
  let missing = 0;
  for (const link of result.links ?? []) {
    const id = link.sourceId === event.id ? link.targetId : link.targetId === event.id ? link.sourceId : null;
    if (!id || id === event.id) continue;
    const target = byId.get(id);
    if (target) related.set(id, { target, link }); else missing++;
  }
  // Keep active branch controls available if a refresh fails or a link disappears.
  for (const connection of connections) if (connection.source.id === event.id && !related.has(connection.target.id)) related.set(connection.target.id, { target: connection.target });
  const outgoing = connections.filter(link => link.source.id === event.id);
  return <section className="card-related" aria-label="Related events">
    <h3>Related events</h3>
    {!result.links && !result.error && <p role="status">Loading related events…</p>}
    {result.error && <div role="alert"><p>{result.error}</p><button onClick={() => { setResult({}); setAttempt(value => value + 1); }}>Retry related events</button></div>}
    {result.links && !related.size && <p>No related events available.</p>}
    {missing > 0 && <p>{missing} linked event(s) are not in the loaded dataset.</p>}
    <div className="card-connections" aria-label="Connections from this event">
      <h4>Connections from here ({outgoing.length})</h4>
      {[...related.values()].map(({ target, link }) => {
        const connected = outgoing.some(connection => connection.target.id === target.id);
        const alreadyInTree = rootId === target.id || connections.some(connection => connection.target.id === target.id);
        return <div key={target.id}>
          <div className="related-event-row">
            <button onClick={() => onVisit(event, target)}>{target.title} <span aria-hidden="true">↗</span></button>
            <button className="connection-toggle" aria-label={`Connection to ${target.title}`} aria-pressed={connected} disabled={!connected && alreadyInTree} onClick={() => connected ? onRemove(target.id) : onAdd(event, target)}>{connected ? "On" : "Off"}</button>
          </div>
          {link && <p className="relationship-context">{link.relation.replaceAll("_", " ")} · Hypothesis{link.rationale ? ` — ${link.rationale}` : ""}</p>}
        </div>;
      })}
      <button disabled={!outgoing.length} onClick={() => onClear(event)}>Clear all connections from here</button>
    </div>
  </section>;
}
