/**
 * Headline cards ride a fixed ring per pin. The ring is the pin's latitude circle tilted
 * about the axis through Earth's left and right edges (as the viewer sees them), so the
 * side facing the viewer is raised (lowered for cards hanging below their pins). The ring
 * stays fixed relative to the viewer while the globe turns; each card slides along it,
 * meeting its pin at the edges and riding highest at the centre: an arch on screen.
 */
export type Vec3 = [number, number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (...vs: Vec3[]): Vec3 => vs.reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0] as Vec3);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));

/**
 * World position of a card's anchor on its pin's ring (globe centre at the origin).
 * `pole` points to the north pole, `toCamera` from the centre toward the camera.
 * `tilt` is in radians; `lift` raises the ring off the surface as a fraction of radius.
 */
export function ringAnchor(pin: Vec3, pole: Vec3, toCamera: Vec3, tilt: number, below: boolean, lift: number): Vec3 {
  const z = normalize(pole);
  const facing = add(toCamera, scale(z, -dot(toCamera, z)));
  if (Math.hypot(...facing) < 1e-9) return scale(pin, 1 + lift); // viewed from a pole: no "front"
  const x = normalize(facing), y = cross(z, x);
  const px = dot(pin, x), py = dot(pin, y), pz = dot(pin, z);
  // Rotate the latitude circle about its own centre line, parallel to y (the left-right
  // edge axis): the edges keep the pin's height, the front rises (or falls) by the tilt.
  const ring = add(scale(x, px * Math.cos(tilt)), scale(y, py), scale(z, pz + (below ? -1 : 1) * px * Math.sin(tilt)));
  return scale(ring, 1 + lift);
}

/** Cards hang below their pin when it lies south of `splitLatitude`; at or north of it they sit above. */
export const hangsBelow = (lat: number, splitLatitude: number) => lat < splitLatitude;

export type Rect = { left: number; top: number; width: number; height: number };
export type RingCard = { id: string; anchorX: number; anchorY: number; width: number; height: number; below: boolean; priority: number };
const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.left < b.left + b.width + gap && b.left < a.left + a.width + gap && a.top < b.top + b.height + gap && b.top < a.top + a.height + gap;

/**
 * Place cards most important first, each centred on its anchor and opening away from its
 * pin. A card that would overlap one already placed (or a fixed card) is pushed further out
 * along its own direction; if that cannot clear it within a few steps, it is hidden (null).
 */
export function layoutRingCards(cards: RingCard[], fixed: Rect[], bounds: { width: number; height: number; pad: number }, gap: number, maxPushes = 3) {
  const clamp = (rect: Rect): Rect => ({
    ...rect,
    left: Math.max(bounds.pad, Math.min(rect.left, bounds.width - rect.width - bounds.pad)),
    top: Math.max(bounds.pad, Math.min(rect.top, bounds.height - rect.height - bounds.pad)),
  });
  const placed: Rect[] = [...fixed];
  const result = new Map<string, Rect | null>();
  for (const card of [...cards].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    let rect = clamp({ left: card.anchorX - card.width / 2, top: card.below ? card.anchorY + gap : card.anchorY - gap - card.height, width: card.width, height: card.height });
    for (let push = 0; push <= maxPushes; push++) {
      const blocker = placed.find(other => overlaps(rect, other, gap));
      if (!blocker) break;
      const next = clamp({ ...rect, top: card.below ? blocker.top + blocker.height + gap : blocker.top - gap - rect.height });
      if (next.top === rect.top || push === maxPushes) { rect = next; break; } // pinned by the screen edge, or out of tries
      rect = next;
    }
    const clear = !placed.some(other => overlaps(rect, other, gap));
    result.set(card.id, clear ? rect : null);
    if (clear) placed.push(rect);
  }
  return result;
}

/** Frame-rate independent easing toward a target: the share of the gap to close this frame. */
export const easeFactor = (elapsedMs: number, timeConstantMs: number) => timeConstantMs <= 0 ? 1 : 1 - Math.exp(-Math.max(0, elapsedMs) / timeConstantMs);
