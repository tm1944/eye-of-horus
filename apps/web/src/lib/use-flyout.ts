"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent } from "react";

const CLOSE_DELAY_MS = 140; // lets the pointer cross from an icon into its flyout
const GAP_PX = 6;
const EDGE_PX = 8;
const LABEL_WIDTH_PX = 160; // assumed width of auto-sized labels when clamping to the screen

function place(item: HTMLElement, side: "left" | "right", width: number | undefined): CSSProperties {
  const itemRect = item.getBoundingClientRect();
  const railRect = item.closest("[data-rail]")?.getBoundingClientRect() ?? itemRect;
  if (railRect.height > railRect.width) {
    const top = itemRect.top;
    const horizontal = side === "right" ? { left: railRect.right + GAP_PX } : { right: window.innerWidth - railRect.left + GAP_PX };
    return { ...horizontal, top, width, maxHeight: window.innerHeight - top - EDGE_PX };
  }
  const left = Math.max(EDGE_PX, Math.min(itemRect.left, window.innerWidth - (width ?? LABEL_WIDTH_PX) - EDGE_PX));
  return railRect.top < window.innerHeight / 2
    ? { left, top: railRect.bottom + GAP_PX, width, maxHeight: window.innerHeight - railRect.bottom - GAP_PX - EDGE_PX }
    : { left, bottom: window.innerHeight - railRect.top + GAP_PX, width, maxHeight: railRect.top - GAP_PX - EDGE_PX };
}

/** Hover flyouts for an icon rail (an ancestor marked `data-rail`). A vertical rail
 * opens toward `side`; a horizontal (phone) rail opens below a top strip or above a
 * bottom strip. The flyout is fixed-position so the rail's overflow cannot clip it.
 * `widthFor` returns undefined for flyouts that size to their content. */
export function useFlyout<T extends string>(side: "left" | "right", widthFor: (id: T) => number | undefined, reflowKey: unknown) {
  const [flyout, setFlyout] = useState<{ id: T; style: CSSProperties } | null>(null);
  const closeTimer = useRef<number | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const cancelClose = () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); closeTimer.current = null; };
  const close = () => { cancelClose(); setFlyout(null); };
  // Keep the flyout open while the user is typing in it, even if the pointer leaves.
  const scheduleClose = () => {
    cancelClose();
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && focused.type !== "checkbox" && panel.current?.contains(focused)) return;
    closeTimer.current = window.setTimeout(() => setFlyout(null), CLOSE_DELAY_MS);
  };
  const scheduleCloseOnBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(next) && !panel.current?.contains(next) && !anchor.current?.contains(next)) scheduleClose();
  };

  function open(id: T, item: HTMLElement) {
    cancelClose();
    anchor.current = item;
    setFlyout({ id, style: place(item, side, widthFor(id)) });
  }
  function toggle(id: T, item: HTMLElement) {
    if (flyout?.id === id) close(); else open(id, item);
  }

  useEffect(() => cancelClose, []);
  useEffect(() => {
    if (!flyout) return;
    const close = () => setFlyout(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    // A fixed flyout would drift from its icon once the page scrolls or resizes;
    // scrolling inside the flyout itself is fine.
    const onScroll = (event: Event) => { if (!(event.target instanceof Node && panel.current?.contains(event.target))) close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", close); window.removeEventListener("scroll", onScroll, true); };
  }, [flyout]);
  // Content changes can reflow the rail; keep the flyout beside its icon.
  useLayoutEffect(() => {
    if (!flyout || !anchor.current) return;
    const style = place(anchor.current, side, widthFor(flyout.id));
    if (JSON.stringify(style) !== JSON.stringify(flyout.style)) setFlyout({ ...flyout, style });
  }, [reflowKey, flyout, side, widthFor]);

  return {
    flyout, panel, open, toggle, close,
    /** Spread on each rail item (`<li>`). */
    itemProps: (id: T) => ({
      onMouseEnter: (event: MouseEvent<HTMLElement>) => open(id, event.currentTarget),
      onMouseLeave: scheduleClose,
      onFocus: (event: FocusEvent<HTMLElement>) => open(id, event.currentTarget),
      onBlur: scheduleCloseOnBlur,
    }),
    /** Spread on the flyout panel. */
    panelProps: { ref: panel, onMouseEnter: cancelClose, onMouseLeave: scheduleClose, onFocus: cancelClose, onBlur: scheduleCloseOnBlur },
  };
}
