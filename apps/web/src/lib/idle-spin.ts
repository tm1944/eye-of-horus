/** Idle auto-rotation: pure timing and camera math, driven each frame by the globe. */

export const easeInOutCubic = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
};

/** Camera latitude allowed by the polar-angle lock: tilt toward/away by at most `maxTiltDegrees`. */
export const clampViewLat = (lat: number, maxTiltDegrees: number) => Math.max(-maxTiltDegrees, Math.min(maxTiltDegrees, lat));

export type IdleState = { held: boolean; reduced: boolean; now: number; lastInteraction: number; idleMs: number };

/** Rotation may start only when nothing holds the view and the user has been idle long enough. */
export const canSpin = ({ held, reduced, now, lastInteraction, idleMs }: IdleState) => !held && !reduced && now - lastInteraction >= idleMs;

export type View = { lat: number; altitude: number };

/**
 * One spin-up frame, `elapsed` ms after rotation began: the speed fraction (0→1, eased) and
 * the camera tilt/zoom eased from `from` to `to`. Longitude is left to the rotation itself.
 */
export function spinUpFrame(elapsed: number, spinUpMs: number, returnMs: number, from: View, to: View) {
  const speed = easeInOutCubic(spinUpMs > 0 ? elapsed / spinUpMs : 1);
  const k = easeInOutCubic(returnMs > 0 ? elapsed / returnMs : 1);
  return {
    speed,
    view: { lat: from.lat + (to.lat - from.lat) * k, altitude: from.altitude + (to.altitude - from.altitude) * k },
    returning: elapsed < returnMs,
  };
}
