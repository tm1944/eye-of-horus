"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { getEvents, type EventsResponse } from "@/lib/api";
import type { Selection } from "@/components/event-globe";
import LayerControls from "@/components/layer-controls";
import { useLayerFilters } from "@/lib/use-layer-filters";
import { deriveVisuals } from "@/lib/layers";
import GlobeBoundary from "@/components/globe-boundary";

const EventGlobe = dynamic(() => import("@/components/event-globe"), { ssr: false, loading: () => <div className="earth-loading" role="status">Loading Earth…</div> });
const emptyEvents: EventsResponse["events"] = [];

export default function Home() {
  const [result, setResult] = useState<{ data: EventsResponse; mode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rotating, setRotating] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getEvents(controller.signal).then(setResult).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load events.");
    });
    return () => controller.abort();
  }, [attempt]);
  const { filters, update } = useLayerFilters();
  const visuals = useMemo(() => deriveVisuals(result?.data.events ?? emptyEvents, filters), [result, filters]);
  return <main className="earth-page" aria-label="Hypothesis Globe">
    <LayerControls filters={filters} onChange={update} count={visuals.visible.length} markerCount={visuals.markers.length} markerCandidateCount={visuals.markerCandidateCount} activeHeatmapId={visuals.activeHeatmapId} />
    <GlobeBoundary><EventGlobe events={visuals.markers} heatmaps={visuals.heatmaps} selection={selection} rotating={rotating} onRotationChange={setRotating} fixture={result?.mode === "fixture"} onSelect={setSelection} /></GlobeBoundary>
    <LayerControls filters={filters} onChange={update} count={visuals.visible.length} onInteract={() => setRotating(false)} />
    {error && <div className="data-error" role="alert">{error} The globe is still interactive. <button onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Retry</button></div>}
  </main>;
}
