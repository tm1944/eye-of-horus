import type { ReactNode } from "react";
import type { CategoryId } from "@/lib/layers";

// 24px stroke icons; color follows `currentColor`.
const paths: Record<IconId, ReactNode> = {
  hazards: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
  security: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" />,
  politics: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  economy: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  society: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  culture: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
  play: <path d="M7 4.5v15l12-7.5-12-7.5z" />,
  countries: <><path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></>,
  significance: <><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h4" /><path d="M12 17h8" /><circle cx="10" cy="17" r="2" /></>,
};

export type PanelId = "countries" | "significance";
export type IconId = CategoryId | PanelId | "reset" | "pause" | "play";

export default function RailIcon({ id }: { id: IconId }) {
  return <svg className="rail-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[id]}</svg>;
}
