"use client";
import { useEffect, useRef } from "react";
import catalog from "@/data/bright-stars.json";
import { bvColor, gmstDegrees, magnitudeWeight } from "@/lib/sky-math";
import { GLOBE } from "@/lib/globe-config";

// The same Yale Bright Star Catalogue the globe draws, as a flat, slowly drifting band of
// real sky behind the onboarding pages. A 2D canvas: no WebGL needed here.
const DEC_SPAN = 140; // degrees of declination shown top to bottom (−70° … +70°)
const DRIFT_DEG_PER_S = 0.5; // sideways drift, like the sky turning (subtle on purpose)
const TWINKLE = 0.3; // share of each star's brightness that gently pulses
const MAX_FPS = 30;
const BRIGHTNESS = GLOBE.skyBrightness * 0.8; // a touch dimmer than on the globe: text sits on top

type Star = { ra: number; dec: number; radius: number; alpha: number; color: string; speed: number; phase: number };

function loadStars(): Star[] {
  const { stars } = catalog as { stars: number[] };
  const out: Star[] = [];
  for (let i = 0; i < stars.length; i += 4) {
    const [ra, dec, vmag, bv] = stars.slice(i, i + 4);
    if (vmag > GLOBE.skyMagnitudeCutoff) break; // brightest first
    if (Math.abs(dec) > DEC_SPAN / 2) continue;
    const weight = magnitudeWeight(vmag, GLOBE.skyMagnitudeCutoff);
    const [r, g, b] = bvColor(bv, GLOBE.skyColorSaturation);
    out.push({
      ra, dec, radius: 0.5 + 1.6 * weight * weight, alpha: BRIGHTNESS * (0.3 + 0.7 * weight),
      color: `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`,
      // Stable per-star rhythm from its position, so the sky looks the same on every load.
      speed: 0.6 + ((ra * 7.3 + dec * 3.1) % 1.6 + 1.6) % 1.6, phase: (ra * 13.7 + dec * 5.9) % (Math.PI * 2),
    });
  }
  return out;
}

/** Fixed, full-screen star field behind its siblings; never intercepts pointer input. */
export default function StarrySky() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const stars = loadStars();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Start where the real sky is right now: the RA overhead at Greenwich.
    const startRa = gmstDegrees(new Date());
    let width = 0, height = 0, frame = 0, last = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = element.clientWidth; height = element.clientHeight;
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = (now: number) => {
      // A hidden canvas (e.g. a page kept alive behind the next one) has no size: nothing to
      // draw, and a zero-width turn below would never advance.
      if (width <= 0 || height <= 0) return;
      const seconds = now / 1000;
      const scale = height / DEC_SPAN; // px per degree, same both ways
      const offset = startRa + (reduced.matches ? 0 : seconds * DRIFT_DEG_PER_S);
      context.clearRect(0, 0, width, height);
      const turn = Math.max(1, 360 * scale); // one full turn of sky, in px (never 0: the loop below must advance)
      for (const star of stars) {
        const y = height / 2 - star.dec * scale;
        const twinkle = reduced.matches ? 1 : 1 - TWINKLE * (0.5 + 0.5 * Math.sin(seconds * star.speed + star.phase));
        context.fillStyle = `rgba(${star.color}, ${star.alpha * twinkle})`;
        // RA increases eastward, which is leftward on a sky seen from below. Very wide screens
        // show more than one turn, so the sky repeats across.
        for (let x = (((offset - star.ra) % 360) + 360) % 360 * scale; x <= width + 4; x += turn) {
          context.beginPath();
          context.arc(x, y, star.radius, 0, Math.PI * 2);
          context.fill();
        }
      }
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 1000 / MAX_FPS || width <= 0 || height <= 0) return; // idle while hidden
      last = now;
      draw(now);
    };
    resize();
    draw(performance.now());
    if (!reduced.matches) frame = requestAnimationFrame(tick);
    const observer = new ResizeObserver(() => { resize(); draw(performance.now()); });
    observer.observe(element);
    const motion = () => {
      cancelAnimationFrame(frame);
      draw(performance.now());
      if (!reduced.matches) frame = requestAnimationFrame(tick);
    };
    reduced.addEventListener("change", motion);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); reduced.removeEventListener("change", motion); };
  }, []);
  return <canvas ref={canvas} className="starry-sky" aria-hidden="true" />;
}
