import type { Event } from "./api";
import type { ViewTab } from "./layers";

/** The demo user's profile as the API reports it (FastAPI owns the local profile file). */
export type Profile = { onboarded: boolean; interests: string[]; readingList: string[]; feedback: Record<string, "more" | "less"> };
export type Interest = { id: string; group: string; label: string; layers: string[]; keywords: string[]; bbox?: number[] };
export type Catalogue = { groups: { id: string; label: string }[]; interests: Interest[] };
/** My Feed items carry why they were picked. */
export type FeedEvent = Event & { score?: number; reasons?: string[] };
export type Feedback = "more" | "less" | null;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} /${path} failed (${response.status}).`);
  return response.json() as Promise<T>;
}
const send = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const getProfile = (signal?: AbortSignal) => call<Profile>("me", { signal });
export const getCatalogue = (signal?: AbortSignal) => call<Catalogue>("interests", { signal });
export const saveInterests = (interests: string[]) => call<Profile>("me/interests", send("PUT", { interests }));
export const resetProfile = () => call<Profile>("me", send("DELETE"));
export const setSaved = (eventId: string, saved: boolean, view: ViewTab) =>
  call<Profile>(`me/reading-list/${encodeURIComponent(eventId)}`, saved ? send("POST", { view }) : send("DELETE"));
export const setFeedback = (eventId: string, value: Feedback, view: ViewTab) =>
  call<Profile>(`me/feedback/${encodeURIComponent(eventId)}`, send("PUT", { value, view }));
export const getMyFeed = (savedOnly: boolean, signal?: AbortSignal) =>
  call<{ events: FeedEvent[]; embeddings: boolean }>(`me/feed?n=20&savedOnly=${savedOnly ? 1 : 0}`, { signal });

/**
 * Light signals: opening an item, and clicking through to the article. Uses sendBeacon so a
 * click that navigates away still arrives; failures are ignored (these are hints, not data).
 */
export function track(eventId: string, kind: "open" | "source", view: ViewTab) {
  const body = JSON.stringify({ eventId, kind, view });
  try {
    if (navigator.sendBeacon?.("/api/me/interactions", new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall back to fetch */ }
  fetch("/api/me/interactions", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
}
