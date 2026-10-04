"use client";
import { useMemo, useState, type CSSProperties, type Ref } from "react";
import type { Event } from "@/lib/api";
import { CATEGORY_OF, LABELS, type LayerId } from "@/lib/layers";
import { eventColor } from "@/lib/globe-config";
import { exactTime } from "@/lib/freshness";
import { chips, locatorPaths, placeLabel, vitalSigns, type ChipKind } from "@/lib/briefing";
import { countryContains } from "@/lib/country-selection";
import countries from "@/data/countries.geojson.json";
import { Thumbnail, TimeAgo } from "@/components/event-media";
import RailIcon from "@/components/icons";
import StoryActions, { type Personal } from "@/components/story-actions";

type Props = {
  event: Event;
  /** Save and More/Less like this; null without the profile API. */
  personal: Personal | null;
  /** My Feed: why this story was picked. */
  reasons?: string[];
  fixture: boolean;
  /** Position in the tour order (north to south); null hides the stepper. */
  position: { index: number; total: number } | null;
  /** Significance rank among the headlines. */
  rank: { place: number; of: number };
  onPrev: () => void;
  onNext: () => void;
  onCenter: () => void;
  onClose: () => void;
  panelRef?: Ref<HTMLElement>;
};

const LEDE_LIMIT = 280;
const CHIP_MARK: Record<ChipKind, string> = { person: "●", organization: "■", actor: "◆", place: "▲", topic: "#" };
const CHIP_LABEL: Record<ChipKind, string> = { person: "Person", organization: "Organisation", actor: "Actor", place: "Place", topic: "Topic" };
const coordinate = (value: number, latitude: boolean) => `${Math.abs(value).toFixed(2)}° ${latitude ? value < 0 ? "S" : "N" : value < 0 ? "W" : "E"}`;
const sourceLink = (value: string | null) => {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) ? { href: url.href, host: url.hostname.replace(/^www\./, "") } : null;
  } catch { return null; }
};
type CountryFeature = (typeof countries.features)[number];
const polygons = countries.features.flatMap(feature => {
  const geometry = feature.geometry as { type: string; coordinates: number[][][] | number[][][][] };
  return geometry.type === "Polygon" ? [geometry.coordinates as number[][][]] : geometry.coordinates as number[][][][];
});

/** A small globe centred on the event, with real coastlines and a pulsing dot. */
function Locator({ lat, lng, color }: { lat: number; lng: number; color: string }) {
  const r = 34;
  const land = useMemo(() => locatorPaths(polygons, lat, lng, r), [lat, lng]);
  return <svg className="locator" viewBox="-40 -40 80 80" width="80" height="80" aria-hidden="true">
    <circle r={r} className="locator-sea" />
    <path d={land.fill} className="locator-land" />
    <path d={land.line} className="locator-coast" />
    <circle r={r} className="locator-rim" />
    <circle r="7" className="locator-pulse" style={{ stroke: color }} />
    <circle r="3.2" style={{ fill: color }} />
  </svg>;
}

/**
 * Headlines briefing: the selected story as a structured card docked right. Hero, vital
 * signs, why it ranks, the lede, where it is, who is involved, then one way out to the source.
 * Headlines shows no relationships, so there is no related-events list here.
 */
export default function DetailsPanel({ event, personal, reasons, fixture, position, rank, onPrev, onNext, onCenter, onClose, panelRef }: Props) {
  const [fullLede, setFullLede] = useState(false);
  const color = eventColor(event.layerId);
  const category = CATEGORY_OF.get(event.layerId as LayerId);
  const vitals = vitalSigns(event);
  const people = chips(event);
  const country = useMemo(() => countries.features.find((feature: CountryFeature) => countryContains(feature as never, event)), [event]);
  const place = placeLabel(event) ?? (country ? country.properties.name : null);
  const link = sourceLink(event.sourceUrl);
  const lede = event.summary ?? "";
  const longLede = lede.length > LEDE_LIMIT;
  return <aside ref={panelRef} className="details-panel" aria-label={`Briefing: ${event.title}`} style={{ "--pin-color": color } as CSSProperties}>
    <nav className="briefing-nav" aria-label="Headlines">
      {position && <>
        <button onClick={onPrev} aria-label="Previous headline (←)">‹</button>
        <span>{position.index + 1} of {position.total}</span>
        <button onClick={onNext} aria-label="Next headline (→)">›</button>
      </>}
      <button className="briefing-close" onClick={onClose} aria-label="Close briefing (Esc)">×</button>
    </nav>

    <header className="briefing-hero">
      <div className="briefing-hero-band" aria-hidden="true">{category && <RailIcon id={category} />}</div>
      <Thumbnail src={event.imageUrl} className="briefing-hero-image" />
      <div className="briefing-hero-text">
        <p className="briefing-chips">
          <span className="briefing-chip" style={{ background: color }}>{LABELS[event.layerId as LayerId] ?? event.layerId}</span>
          <span>{event.source.toUpperCase()}</span>
          <TimeAgo iso={event.occurredAt} className="" />
          {fixture && <span className="sample-badge">Sample</span>}
        </p>
        <h2 className="briefing-title">{event.title}</h2>
      </div>
    </header>

    {personal && <section className="briefing-section briefing-actions"><StoryActions event={event} personal={personal} /></section>}

    {reasons && reasons.length > 0 && <section className="briefing-section" aria-label="Why it is in your feed">
      <span className="briefing-label">Why it&apos;s in your feed</span>
      <ul className="briefing-reasons">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    </section>}

    {vitals.length > 0 && <dl className="briefing-vitals">
      {vitals.map(vital => <div key={vital.label} data-tone={vital.tone}>
        <dt>{vital.label}</dt><dd>{vital.value}</dd>
      </div>)}
    </dl>}

    <section className="briefing-section briefing-rank" aria-label="Why it is a headline">
      <span className="briefing-label">Significance</span>
      <span className="briefing-meter"><span style={{ width: `${Math.min(100, Math.max(0, event.significance))}%` }} /></span>
      {rank.place > 0 && <strong title={`Ranked ${rank.place} of ${rank.of} headlines by significance`}>#{rank.place}<small> of {rank.of}</small></strong>}
    </section>

    {lede && <section className="briefing-section briefing-lede">
      <p>{longLede && !fullLede ? `${lede.slice(0, LEDE_LIMIT).trimEnd()}…` : lede}</p>
      {longLede && <button className="briefing-more" onClick={() => setFullLede(value => !value)}>{fullLede ? "Less" : "More"}</button>}
    </section>}

    <section className="briefing-section briefing-place" aria-label="Location">
      <Locator lat={event.lat} lng={event.lng} color={color} />
      <div>
        {place && <p className="briefing-place-name">{place}</p>}
        <p className="briefing-coords">{coordinate(event.lat, true)} {coordinate(event.lng, false)}</p>
        <button className="briefing-center" onClick={onCenter}>Centre on globe</button>
      </div>
    </section>

    {people.length > 0 && <section className="briefing-section" aria-label="People and places">
      <span className="briefing-label">People &amp; places</span>
      <ul className="briefing-tags">
        {people.map(chip => <li key={chip.text} data-kind={chip.kind} title={CHIP_LABEL[chip.kind]}>
          <span aria-hidden="true">{CHIP_MARK[chip.kind]}</span>{chip.text}
        </li>)}
      </ul>
    </section>}

    <footer className="briefing-footer">
      <p>{exactTime(event.occurredAt)}</p>
      {link
        ? <a className="briefing-cta" href={link.href} target="_blank" rel="noreferrer" onClick={() => personal?.onSource(event)}>Read the full story at {link.host} <span aria-hidden="true">↗</span></a>
        : <p className="briefing-source">Source: {event.source.toUpperCase()}</p>}
    </footer>
  </aside>;
}
