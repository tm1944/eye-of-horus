"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { getEvents, getLinks, type EventLink, type EventsResponse } from "@/lib/api";
import countries from "@/data/countries.geojson.json";
import { countryContains } from "@/lib/country-selection";
import type { Selection } from "@/components/event-globe";
import LayerRail, { DisplaySettings } from "@/components/layer-controls";
import { useLayerFilters } from "@/lib/use-layer-filters";
import { deriveVisuals } from "@/lib/layers";
import GlobeBoundary from "@/components/globe-boundary";
import SettingsRail from "@/components/settings-rail";

const EventGlobe = dynamic(() => import("@/components/event-globe"), { ssr: false, loading: () => <div className="earth-loading" role="status">Loading Earth…</div> });
const emptyEvents: EventsResponse["events"] = [];

export default function Home() {
  const [result, setResult] = useState<{ data: EventsResponse; mode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rotating, setRotating] = useState(false);
  const [selectedCountryIds, setSelectedCountryIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [globeReady, setGlobeReady] = useState(false);
  const [resetViewKey, setResetViewKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getEvents(controller.signal).then(setResult).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load events.");
    });
    return () => controller.abort();
  }, [attempt]);
  // Links load once with the events; without them the globe simply draws no arcs.
  const [links, setLinks] = useState<{ links?: EventLink[]; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    setLinks({});
    getLinks(controller.signal).then(links => setLinks({ links })).catch((error: unknown) => {
      if (!controller.signal.aborted) setLinks({ error: error instanceof Error ? error.message : "Unable to load related events." });
    });
    return () => controller.abort();
  }, [attempt]);
  const { filters, update } = useLayerFilters();
  const visuals = useMemo(() => deriveVisuals(result?.data.events ?? emptyEvents, filters), [result, filters]);
  const selectedCountries = useMemo(() => selectedCountryIds.map(id => {
    const country = countries.features.find(country => country.id === id)!;
    return { id, name: country.properties.name, events: (result?.data.events ?? emptyEvents).filter(event => countryContains(country, event)) };
  }), [selectedCountryIds, result]);
  function toggleCountry(id: string) {
    setSelectedCountryIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }
  return <main className="earth-page" aria-label="Hypothesis Globe">
    <LayerRail filters={filters} onChange={update} />
    <div className="globe-workspace"><GlobeBoundary><EventGlobe allEvents={result?.data.events ?? emptyEvents} links={links} selectedCountries={selectedCountries} onToggleCountry={toggleCountry} events={visuals.markers} heatmaps={visuals.heatmaps} selection={selection} rotating={rotating} onRotationChange={setRotating} fixture={result?.mode === "fixture"} onSelect={setSelection} resetViewKey={resetViewKey} onReadyChange={setGlobeReady} /></GlobeBoundary></div>
    <SettingsRail reflowKey={[filters, selectedCountries]} actions={[
      { id: "reset", label: "Reset view", icon: "reset", disabled: !globeReady, onClick: () => setResetViewKey(value => value + 1) },
      { id: "rotation", label: rotating ? "Pause rotation" : "Resume rotation", icon: rotating ? "pause" : "play", pressed: rotating, disabled: !globeReady, onClick: () => setRotating(value => !value) },
    ]} panels={[
      { id: "countries", label: "Selected countries", badge: selectedCountries.length, active: selectedCountries.length > 0, content: <div className="selected-countries">
        <button disabled={!selectedCountries.length} onClick={() => setSelectedCountryIds([])}>Clear all</button>
        {!selectedCountries.length && <p>Click countries on Earth to add them.</p>}
        {selectedCountries.map(country => <div key={country.id}><div className="country-list-heading"><strong>{country.name} · {country.events.length}</strong><button onClick={() => toggleCountry(country.id)} aria-label={`Remove ${country.name}`}>×</button></div><details><summary>POIs</summary>{country.events.length ? country.events.map(event => <button className="country-poi" key={event.id} onClick={() => setSelection({ kind: "event", event })}>{event.title}</button>) : <p>No loaded POIs.</p>}</details></div>)}
      </div> },
      { id: "significance", label: "Significance", content: <DisplaySettings filters={filters} onChange={update} count={visuals.visible.length} markerCount={visuals.markers.length} markerCandidateCount={visuals.markerCandidateCount} /> },
    ]} />
    {error && <div className="data-error" role="alert">{error} The globe is still interactive. <button onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Retry</button></div>}
  </main>;
}
