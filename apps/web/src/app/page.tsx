"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { getEvents, getLinks, type EventLink, type EventsResponse } from "@/lib/api";
import countries from "@/data/countries.geojson.json";
import { countryContains } from "@/lib/country-selection";
import type { Selection } from "@/components/event-globe";
import LayerRail, { DisplaySettings } from "@/components/layer-controls";
import { useLayerFilters, useViewTab } from "@/lib/use-layer-filters";
import { deriveVisuals, headlineFeed, restrictVisuals, type LayerId, type ViewTab } from "@/lib/layers";
import { GLOBE } from "@/lib/globe-config";
import GlobeBoundary from "@/components/globe-boundary";
import SettingsRail from "@/components/settings-rail";
import CountryHeadlines from "@/components/country-headlines";
import { indexLinks } from "@/lib/related-events";
import ViewTabs from "@/components/view-tabs";
import DataAttribution from "@/components/data-attribution";

const EventGlobe = dynamic(() => import("@/components/event-globe"), { ssr: false, loading: () => <div className="earth-loading" role="status">Loading Earth…</div> });
const emptyEvents: EventsResponse["events"] = [];
const noCountries: { id: string; name: string; events: EventsResponse["events"] }[] = [];

export default function Home() {
  const [result, setResult] = useState<{ data: EventsResponse; mode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedCountryIds, setSelectedCountryIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
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
  // Two feeds: Headlines ignores the map filters; Explore is everything they allow.
  const { tab, setTab } = useViewTab();
  const headlines = useMemo(() => headlineFeed(result?.data.events ?? emptyEvents, GLOBE.headlineCount, GLOBE.headlinePerCategory), [result]);
  function changeTab(next: ViewTab) {
    if (next === tab) return;
    setSelection(null);
    setTab(next);
  }
  const selectedCountries = useMemo(() => selectedCountryIds.map(id => {
    const country = countries.features.find(country => country.id === id)!;
    return { id, name: country.properties.name, events: (result?.data.events ?? emptyEvents).filter(event => countryContains(country, event)) };
  }), [selectedCountryIds, result]);
  // Selecting a country opens the Selected countries panel with its headlines.
  const [countriesPanelRequest, setCountriesPanelRequest] = useState<{ id: "countries"; key: number } | null>(null);
  function toggleCountry(id: string) {
    const adding = !selectedCountryIds.includes(id);
    setSelectedCountryIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    if (adding) setCountriesPanelRequest(request => ({ id: "countries", key: (request?.key ?? 0) + 1 }));
  }
  // Headlines is deliberately limited: no filter rail, no settings rail, no country
  // selection. Country choices are kept for Explore, which has all the tools.
  const explore = tab === "explore";
  // Connections per event, for the selected-countries list (same counts as the cluster list).
  const linkIndex = useMemo(() => indexLinks(links.links ?? []), [links.links]);
  // With countries selected, Explore shows only what lies inside them: markers, clusters
  // and heatmaps elsewhere are dropped until the selection is cleared.
  const shown = useMemo(() => explore && selectedCountries.length
    ? restrictVisuals(visuals, new Set(selectedCountries.flatMap(country => country.events.map(event => event.id))))
    : visuals, [explore, selectedCountries, visuals]);
  return <main className="earth-page" data-tab={tab} aria-label="Hypothesis Globe">
    {explore && <LayerRail filters={filters} onChange={update} />}
    <div className="globe-workspace"><ViewTabs tab={tab} onChange={changeTab} /><GlobeBoundary><EventGlobe view={tab} headlines={headlines} allEvents={result?.data.events ?? emptyEvents} links={links} selectedCountries={explore ? selectedCountries : noCountries} onToggleCountry={toggleCountry} events={shown.markers} heatmaps={shown.heatmaps} selection={selection} fixture={result?.mode === "fixture"} onSelect={setSelection} /></GlobeBoundary><DataAttribution /></div>
    {explore && <SettingsRail reflowKey={[filters, selectedCountries]} openRequest={countriesPanelRequest} actions={[]} panels={[
      { id: "countries", label: "Selected countries", badge: selectedCountries.length, active: selectedCountries.length > 0, content: <CountryHeadlines countries={selectedCountries}
        onRemove={toggleCountry} onClear={() => setSelectedCountryIds([])} onPick={event => setSelection({ kind: "event", event })}
        include={event => !!filters.layers[event.layerId as LayerId]?.enabled} linkCount={id => linkIndex.get(id)?.length ?? 0} /> },
      { id: "significance", label: "Significance", content: <DisplaySettings filters={filters} onChange={update} count={visuals.visible.length} markerCount={visuals.markers.length} markerCandidateCount={visuals.markerCandidateCount} /> },
    ]} />}
    {error && <div className="data-error" role="alert">{error} The globe is still interactive. <button onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Retry</button></div>}
  </main>;
}
