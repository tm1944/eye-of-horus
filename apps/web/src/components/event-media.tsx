"use client";
import { useEffect, useState } from "react";
import { exactTime, freshness } from "@/lib/freshness";

// Per-URL outcomes shared by every card, so a dead image is tried once per page load.
const loaded = new Set<string>();
const failed = new Set<string>();
const MIN_SIZE = 32; // smaller "images" are tracking pixels or placeholders, not thumbnails
type Status = "loading" | "ok" | "failed";
const known = (src: string | null | undefined): Status => !src || failed.has(src) ? "failed" : loaded.has(src) ? "ok" : "loading";

/**
 * Article thumbnail, loaded straight from the publisher with no Referer (option A, no
 * proxy). It is fetched off-screen first and only rendered once it has fully loaded, so
 * a blocked, expired or tiny image never shows a broken icon or an empty box: the card
 * simply has no thumbnail. next/image is not used: it only optimises allow-listed hosts.
 */
export function Thumbnail({ src, className = "thumb" }: { src: string | null | undefined; className?: string }) {
  const [result, setResult] = useState<{ src: typeof src; status: Status }>(() => ({ src, status: known(src) }));
  const status = result.src === src ? result.status : known(src);
  useEffect(() => {
    if (!src || known(src) !== "loading") return;
    let live = true;
    const probe = new Image();
    probe.referrerPolicy = "no-referrer";
    probe.decoding = "async";
    probe.onload = () => {
      const ok = probe.naturalWidth >= MIN_SIZE && probe.naturalHeight >= MIN_SIZE;
      (ok ? loaded : failed).add(src);
      if (live) setResult({ src, status: ok ? "ok" : "failed" });
    };
    probe.onerror = () => {
      failed.add(src);
      if (live) setResult({ src, status: "failed" });
    };
    probe.src = src;
    return () => { live = false; probe.onload = probe.onerror = null; };
  }, [src]);
  if (!src || status !== "ok") return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt="" decoding="async" referrerPolicy="no-referrer" draggable={false}
    onError={() => { loaded.delete(src); failed.add(src); setResult({ src, status: "failed" }); }} />;
}

/** "3 h ago", refreshed every minute; the tooltip carries the exact time. */
export function TimeAgo({ iso, className = "time-ago" }: { iso: string; className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const label = freshness(iso, now);
  return label ? <time className={className} dateTime={iso} title={exactTime(iso)}>{label}</time> : null;
}
