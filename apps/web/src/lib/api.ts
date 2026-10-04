import type { events, links } from "./fixtures";
export type Event = Omit<(typeof events)[number], "sourceUrl" | "imageUrl" | "summary" | "rawRef"> & {
  sourceUrl: string | null;
  /** Article thumbnail, loaded directly from the publisher; null when none is known. */
  imageUrl: string | null;
  summary: string | null;
  rawRef: string | null;
};
/** News↔news links store scores in citations; other links store a list. */
export type LinkScores = { plausibility?: number; evidence?: number; verdict?: string; world_knowledge?: string[] };
export type EventLink = Omit<(typeof links)[number], "citations"> & { citations: unknown[] | LinkScores };
export type EventsResponse = {
  generatedAt: string;
  sourceStatus: Record<string, string>;
  events: Event[];
  nextCursor: string | null;
};
export async function getEvents(signal?: AbortSignal) {
  // A refresh can invalidate a cursor. Discard the partial dataset and retry
  // once, so the globe never combines pages from different snapshots.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const collected: Event[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    while (true) {
      signal?.throwIfAborted();
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      const response = await fetch(`/api/events${query}`, { signal, cache: "no-store" });
      if (response.status === 409 && attempt === 0) break;
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const source = body?.detail?.failingSource;
        const suffix = typeof source === "string" ? ` Source: ${source}.` : "";
        throw new Error(`Events request failed (${response.status}).${suffix} Check the API connection.`);
      }
      const page = (await response.json()) as EventsResponse;
      collected.push(...page.events);
      if (!page.nextCursor) {
        const samples = page.sourceStatus.usgs === "fixture" && page.sourceStatus.firms === "fixture";
        return {
          data: { ...page, events: collected },
          mode: samples ? "fixture" : response.headers.get("X-Data-Mode") ?? "unknown",
        };
      }
      if (seen.has(page.nextCursor)) throw new Error("The API repeated an event cursor. Retry loading events.");
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }
  throw new Error("Events changed while loading. Retry loading events.");
}

async function readLinks(response: Response): Promise<EventLink[]> {
  const links: unknown = await response.json();
  if (!Array.isArray(links) || links.some(link => !link || typeof link.sourceId !== "string" || typeof link.targetId !== "string")) {
    throw new Error("The backend returned an invalid event links response.");
  }
  return links as EventLink[];
}

/** Load backend relationship hypotheses for either end of an event link. */
export async function getEventLinks(eventId: string, signal?: AbortSignal): Promise<EventLink[]> {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/links`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Related events request failed (${response.status}).`);
  return readLinks(response);
}

/** Load every relationship hypothesis once, so hovering a pin never waits on the network. */
export async function getLinks(signal?: AbortSignal): Promise<EventLink[]> {
  const response = await fetch("/api/links", { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Links request failed (${response.status}).`);
  return readLinks(response);
}
