"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { getCatalogue, getProfile, saveInterests, type Catalogue } from "@/lib/profile";
import { eventColor } from "@/lib/globe-config";
import { CATEGORIES } from "@/lib/layers";
import { Wordmark } from "@/components/brand";
import StarrySky from "@/components/starry-sky";

const MIN_PICKS = 3;
// Each topic group borrows its category's colour from the globe; places use a neutral blue.
const groupColor = (group: string) => {
  const category = CATEGORIES.find(item => item.id === group);
  return category ? eventColor(category.layers[0]) : "#a0d9ff";
};

/** Pick topics (at least 3) and, optionally, places. Saving them starts My Feed. */
export default function PickInterests() {
  const router = useRouter();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [state, setState] = useState<{ saving?: boolean; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getCatalogue(controller.signal), getProfile(controller.signal).catch(() => null)]).then(([items, profile]) => {
      setCatalogue(items);
      // Editing keeps earlier picks that are still offered.
      const offered = new Set(items.interests.map(item => item.id));
      if (profile?.interests.length) setPicked(new Set(profile.interests.filter(id => offered.has(id))));
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : "Couldn't load interests." });
    });
    return () => controller.abort();
  }, []);
  const topics = useMemo(() => catalogue?.groups.filter(group => group.id !== "region") ?? [], [catalogue]);
  const topicCount = catalogue ? [...picked].filter(id => catalogue.interests.find(item => item.id === id)?.group !== "region").length : 0;
  const toggle = (id: string) => setPicked(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  async function finish() {
    setState({ saving: true });
    try {
      await saveInterests([...picked]);
      router.replace("/?tab=feed");
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Couldn't save your interests." });
    }
  }
  const chips = (group: string) => catalogue!.interests.filter(item => item.group === group).map(item =>
    <button key={item.id} type="button" className="interest-chip" aria-pressed={picked.has(item.id)} onClick={() => toggle(item.id)}
      style={{ "--chip-color": groupColor(group) } as CSSProperties}>
      {picked.has(item.id) && <span aria-hidden="true">✓ </span>}{item.label}
    </button>);
  return <main className="welcome welcome-interests" aria-labelledby="interests-title">
    <StarrySky />
    <div className="interests-card">
      <Wordmark size={24} className="interests-wordmark" />
      <p className="welcome-kicker">Step 1 of 1</p>
      <h1 id="interests-title">What do you want to follow?</h1>
      <p className="welcome-lede">Pick at least {MIN_PICKS} topics. We&apos;ll use them to start your feed, then learn from what you save and read.</p>
      {!catalogue && !state.error && <p role="status">Loading interests…</p>}
      {catalogue && <>
        {topics.map(group => <section key={group.id} className="interest-group" aria-labelledby={`group-${group.id}`}>
          <h2 id={`group-${group.id}`}>{group.label}</h2>
          <div className="interest-chips">{chips(group.id)}</div>
        </section>)}
        <section className="interest-group" aria-labelledby="group-region">
          <h2 id="group-region">Places you follow <small>optional</small></h2>
          <div className="interest-chips">{chips("region")}</div>
        </section>
      </>}
      {state.error && <p className="interests-error" role="alert">{state.error} Is the API running?</p>}
      <div className="interests-footer">
        <span role="status">{topicCount < MIN_PICKS ? `Pick ${MIN_PICKS - topicCount} more` : `${picked.size} selected`}</span>
        <button type="button" className="welcome-cta" disabled={topicCount < MIN_PICKS || state.saving} onClick={finish}>
          {state.saving ? "Building your feed…" : "Continue"}
        </button>
      </div>
    </div>
  </main>;
}
