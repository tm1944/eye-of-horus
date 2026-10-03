import type { events, links } from "./fixtures";
export type Event = Omit<(typeof events)[number], "sourceUrl" | "summary" | "rawRef"> & {
  sourceUrl: string | null;
  summary: string | null;
  rawRef: string | null;
};
export type EventLink = (typeof links)[number];
export type EventsResponse = {
  generatedAt: string;
  sourceStatus: Record<string, string>;
  events: Event[];
  nextCursor: string | null;
};
export async function getEvents(signal?: AbortSignal) {
  const response = await fetch("/api/events", { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Events request failed (${response.status}). Check FastAPI and API_BASE_URL.`);
  return { data: (await response.json()) as EventsResponse, mode: response.headers.get("X-Data-Mode") ?? "unknown" };
}
