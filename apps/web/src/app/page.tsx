"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getEvents, getLinks, type Event, type EventLink, type EventsResponse } from "@/lib/api";
import { getMyFeed, getProfile, resetProfile, setFeedback, setSaved, track, type Feedback, type FeedEvent, type Profile } from "@/lib/profile";
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

  // MY FEED — the demo profile lives in FastAPI. First visit (not onboarded) goes to the
  // welcome flow; without the API (fixture mode) the app simply runs without personal tools.
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getProfile(controller.signal).then(next => {
      if (!next.onboarded) router.replace("/welcome");
      else setProfile(next);
    }).catch(() => { /* no API: no personal features */ });
    return () => controller.abort();
  }, [router]);
  // "For you" is ranked by the taste vector; "Reading list" is what the user saved.
  const [feedSection, setFeedSection] = useState<"for-you" | "saved">("for-you");
  const [feed, setFeed] = useState<{ events?: FeedEvent[]; error?: string }>({});
  const [feedVersion, setFeedVersion] = useState(0);
  useEffect(() => {
    if (tab !== "feed" || !profile) return;
    const controller = new AbortController();
    // Refetch shortly after a save or thumbs, so the ranking visibly adapts.
    const timer = setTimeout(() => getMyFeed(feedSection === "saved", controller.signal)
      .then(body => setFeed({ events: body.events }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setFeed({ error: error instanceof Error ? error.message : "Unable to load your feed." }); }),
    feedVersion ? 500 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [tab, feedSection, feedVersion, profile]);
  const changed = useCallback((next: Profile) => { setProfile(next); setFeedVersion(value => value + 1); }, []);
  const toggleSaved = useCallback((event: Event, saved: boolean) => {
    setProfile(current => current && { ...current, readingList: saved ? [...current.readingList.filter(id => id !== event.id), event.id] : current.readingList.filter(id => id !== event.id) });
    setSaved(event.id, saved, tab).then(changed).catch(() => getProfile().then(setProfile).catch(() => {}));
  }, [tab, changed]);
  const giveFeedback = useCallback((event: Event, value: Feedback) => {
    setProfile(current => {
      if (!current) return current;
      const feedback = { ...current.feedback };
      if (value) feedback[event.id] = value; else delete feedback[event.id];
      return { ...current, feedback };
    });
    setFeedback(event.id, value, tab).then(changed).catch(() => getProfile().then(setProfile).catch(() => {}));
  }, [tab, changed]);
  // Opening an item is a light signal, counted once per item per visit.
  const opened = useRef(new Set<string>());
  useEffect(() => {
    if (!profile || selection?.kind !== "event" || opened.current.has(selection.event.id)) return;
    opened.current.add(selection.event.id);
    track(selection.event.id, "open", tab);
  }, [selection, profile, tab]);
  const startOver = useCallback(() => { resetProfile().then(() => router.replace("/welcome")).catch(() => {}); }, [router]);
  const personal = useMemo(() => profile ? {
    isSaved: (id: string) => profile.readingList.includes(id),
    feedbackFor: (id: string): Feedback => profile.feedback[id] ?? null,
    onSave: toggleSaved, onFeedback: giveFeedback,
    onSource: (event: Event) => track(event.id, "source", tab),
  } : null, [profile, toggleSaved, giveFeedback, tab]);
  const feedEvents = feed.events ?? emptyEvents;
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
    <div className="globe-workspace"><ViewTabs tab={tab} onChange={changeTab} /><GlobeBoundary><EventGlobe view={tab} headlines={tab === "feed" ? feedEvents : headlines} personal={personal}
      feed={tab === "feed" ? { section: feedSection, onSection: section => { setFeed({}); setSelection(null); setFeedSection(section); }, saved: profile?.readingList.length ?? 0, loading: !feed.events && !feed.error, error: feed.error, onStartOver: startOver } : null} allEvents={result?.data.events ?? emptyEvents} links={links} selectedCountries={explore ? selectedCountries : noCountries} onToggleCountry={toggleCountry} events={shown.markers} heatmaps={shown.heatmaps} selection={selection} fixture={result?.mode === "fixture"} onSelect={setSelection} /></GlobeBoundary><DataAttribution /></div>
    {explore && <SettingsRail reflowKey={[filters, selectedCountries]} openRequest={countriesPanelRequest} actions={[]} panels={[
      { id: "countries", label: "Selected countries", badge: selectedCountries.length, active: selectedCountries.length > 0, content: <CountryHeadlines countries={selectedCountries}
        onRemove={toggleCountry} onClear={() => setSelectedCountryIds([])} onPick={event => setSelection({ kind: "event", event })}
        include={event => !!filters.layers[event.layerId as LayerId]?.enabled} linkCount={id => linkIndex.get(id)?.length ?? 0} /> },
      { id: "significance", label: "Significance", content: <DisplaySettings filters={filters} onChange={update} count={visuals.visible.length} markerCount={visuals.markers.length} markerCandidateCount={visuals.markerCandidateCount} /> },
    ]} />}
    {error && <div className="data-error" role="alert">{error} The globe is still interactive. <button onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Retry</button></div>}
  </main>;
}
