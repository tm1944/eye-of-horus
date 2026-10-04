/**
 * How fresh an event is, for card labels. Sources that only know the date (Wikifeeds,
 * conflict CSV, some GDACS) are stored at exactly 00:00:00 UTC; "15 h ago" would be
 * invented precision for those, so they read as a day instead.
 */
const DAY = 86_400_000;
const shortDate = (date: Date, now: Date) => new Intl.DateTimeFormat("en", {
  month: "short", day: "numeric", timeZone: "UTC", ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: "numeric" } : {}),
}).format(date);

export const isDateOnly = (date: Date) => date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;

export function freshness(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (isDateOnly(date)) {
    const days = Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - date.getTime()) / DAY);
    return days === 0 ? "Today" : days === 1 ? "Yesterday" : shortDate(date, now);
  }
  const ms = now.getTime() - date.getTime();
  if (ms < -5 * 60_000) return shortDate(date, now); // clock skew tolerated; real future dates shown plainly
  if (ms < 60_000) return "Just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)} h ago`;
  if (ms < 2 * DAY) return "Yesterday";
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)} days ago`;
  return shortDate(date, now);
}

/** The exact time; date-only events show just the date rather than a made-up midnight. */
export function exactTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return isDateOnly(date)
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date)
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
}
