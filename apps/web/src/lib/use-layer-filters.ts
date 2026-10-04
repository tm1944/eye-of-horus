"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { parseFilters, writeFilters, type Filters } from "./layers";
const changeEvent = "globe-filters-changed";
function subscribe(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(changeEvent, notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener(changeEvent, notify); };
}
const snapshot = () => window.location.search;
export function useLayerFilters() {
  const search = useSyncExternalStore(subscribe, snapshot, () => "");
  const filters = useMemo(() => parseFilters(search), [search]);
  useEffect(() => {
    const current = window.location.search;
    const canonical = writeFilters(current, parseFilters(current));
    if (current.slice(1) !== canonical) {
      window.history.replaceState(null, "", `${window.location.pathname}?${canonical}${window.location.hash}`);
      window.dispatchEvent(new Event(changeEvent));
    }
  }, [search]);
  function update(next: Filters) {
    window.history.pushState(null, "", `${window.location.pathname}?${writeFilters(window.location.search, next)}${window.location.hash}`);
    window.dispatchEvent(new Event(changeEvent));
  }
  return { filters, update };
}
