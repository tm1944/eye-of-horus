"use client";

import type { CSSProperties } from "react";
import type { Event } from "@/lib/api";
import { LABELS, type LayerId } from "@/lib/layers";
import { eventColor } from "@/lib/globe-config";
import { Thumbnail, TimeAgo } from "@/components/event-media";

type Props = {
  events: Event[];
  /** How many links each event has; shown so people can find the connected ones. */
  linkCount: (id: string) => number;
  /** Stage-relative cluster centre; the panel opens beside it, clamped inside the stage. */
  x: number;
  y: number;
  stageWidth: number;
  stageHeight: number;
  onPick: (event: Event) => void;
  onClose: () => void;
};

const WIDTH = 300, PAD = 16, GAP = 22;

/** Summary cards for one cluster's events. Picking one selects it (details, related events, arcs). */
export default function ClusterPanel({ events, linkCount, x, y, stageWidth, stageHeight, onPick, onClose }: Props) {
  const left = x + GAP + WIDTH + PAD <= stageWidth ? x + GAP : Math.max(PAD, x - GAP - WIDTH);
  const top = Math.max(PAD, Math.min(y - 40, stageHeight - PAD - 160));
  return <aside className="cluster-panel" role="dialog" aria-label={`${events.length} events at this spot`}
    style={{ left, top, width: WIDTH, maxHeight: Math.max(180, stageHeight - top - PAD) }}>
    <header className="cluster-panel-header">
      <span>{events.length} events here</span>
      <button className="link-close" aria-label="Close list" onClick={onClose}>×</button>
    </header>
    <ol className="cluster-panel-list">
      {events.map(event => {
        const links = linkCount(event.id);
        return <li key={event.id}>
          <button className="summary-card" style={{ "--pin-color": eventColor(event.layerId) } as CSSProperties} onClick={() => onPick(event)}>
            <Thumbnail src={event.imageUrl} className="thumb thumb-small" />
            <span className="summary-card-text">
              <span className="summary-card-title">{event.title}</span>
              <span className="summary-card-meta">
                {LABELS[event.layerId as LayerId] ?? event.layerId} · {event.source.toUpperCase()} · <TimeAgo iso={event.occurredAt} className="" />
                {links > 0 && <strong> · {links} related</strong>}
              </span>
            </span>
          </button>
        </li>;
      })}
    </ol>
  </aside>;
}
