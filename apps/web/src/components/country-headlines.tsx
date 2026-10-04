"use client";

import type { CSSProperties } from "react";
import type { Event } from "@/lib/api";
import { LABELS, type LayerId } from "@/lib/layers";
import { eventColor } from "@/lib/globe-config";
import { Thumbnail, TimeAgo } from "@/components/event-media";
import { countryHeadlines } from "@/lib/country-selection";

type SelectedCountry = { id: string; name: string; events: Event[] };
type Props = {
  countries: SelectedCountry[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onPick: (event: Event) => void;
  /** Only headlines that pass (the active layers) are listed. */
  include: (event: Event) => boolean;
  /** Connections per event; connected events are listed first and show their count. */
  linkCount: (id: string) => number;
};

/** Selected-countries panel: the chosen countries, then their headlines in the active
 * layers, colour-coded by category (the same summary cards as the cluster list), connected
 * events first and then by significance. Picking one selects the event. */
export default function CountryHeadlines({ countries, onRemove, onClear, onPick, include, linkCount }: Props) {
  const headlines = countryHeadlines(countries, { include, linkCount });
  return <>
    <div className="selected-countries">
      <button disabled={!countries.length} onClick={onClear}>Clear all</button>
      {!countries.length && <p>Click countries on Earth to add them.</p>}
      {countries.map(country => <div key={country.id} className="country-list-heading">
        <strong>{country.name} · {country.events.length}</strong>
        <button onClick={() => onRemove(country.id)} aria-label={`Remove ${country.name}`}>×</button>
      </div>)}
    </div>
    {countries.length > 0 && (headlines.length
      ? <ol className="country-headlines" aria-label="Headlines from the selected countries: connected events first, then most significant">
        {headlines.map(({ event, country, links }) => <li key={event.id}>
          <button className="summary-card" style={{ "--pin-color": eventColor(event.layerId) } as CSSProperties} onClick={() => onPick(event)}>
            <Thumbnail src={event.imageUrl} className="thumb thumb-small" />
            <span className="summary-card-text">
              <span className="summary-card-title">{event.title}</span>
              <span className="summary-card-meta">
                {LABELS[event.layerId as LayerId] ?? event.layerId}{countries.length > 1 ? ` · ${country}` : ""} · {event.source.toUpperCase()} · <TimeAgo iso={event.occurredAt} className="" /> · {Math.round(event.significance)}
                {links > 0 && <strong> · {links} related</strong>}
              </span>
            </span>
          </button>
        </li>)}
      </ol>
      : <p className="country-headlines-empty">No headlines in the active layers for these countries.</p>)}
  </>;
}
