"use client";
import { useState } from "react";
import type { Event } from "@/lib/api";
import type { Feedback } from "@/lib/profile";

/** Personal tools offered wherever a story's details are shown (all three tabs). */
export type Personal = {
  isSaved: (id: string) => boolean;
  feedbackFor: (id: string) => Feedback;
  onSave: (event: Event, saved: boolean) => void;
  onFeedback: (event: Event, value: Feedback) => void;
  /** Click-through to the article: a learning signal for My Feed. */
  onSource: (event: Event) => void;
};

/**
 * Save to the reading list, and More / Less like this. Thumbs are a toggle pair: one at a
 * time, and pressing the active one clears it. Nothing else changes on screen; the profile
 * learns from it (My Feed refetches).
 */
export default function StoryActions({ event, personal }: { event: Event; personal: Personal }) {
  const saved = personal.isSaved(event.id);
  const feedback = personal.feedbackFor(event.id);
  const [note, setNote] = useState<string | null>(null);
  const choose = (value: "more" | "less") => {
    const next = feedback === value ? null : value;
    personal.onFeedback(event, next);
    setNote(next ? "Thanks, we'll tune your feed." : null);
  };
  return <div className="story-actions">
    <button className="story-save" aria-pressed={saved} onClick={() => personal.onSave(event, !saved)}>
      {saved ? "Saved to reading list ✓" : "Save to reading list"}
    </button>
    <div className="story-feedback" role="group" aria-label="Tune your feed">
      <button aria-pressed={feedback === "more"} onClick={() => choose("more")}>More like this</button>
      <button aria-pressed={feedback === "less"} onClick={() => choose("less")}>Less like this</button>
    </div>
    {note && <p className="story-note" role="status">{note}</p>}
  </div>;
}
