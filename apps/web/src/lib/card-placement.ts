export type CardRect = { left: number; top: number; width: number; height: number };

export type GlobeCircle = { x: number; y: number; radius: number; strict?: boolean };
export const cardsOverlap = (a: CardRect, b: CardRect, gap = 16) => !(a.left + a.width + gap <= b.left || b.left + b.width + gap <= a.left || a.top + a.height + gap <= b.top || b.top + b.height + gap <= a.top);

/** Prefer open space outside Earth, then proximity; never move existing cards. */
export function placeCard(preferred: CardRect, occupied: CardRect[], viewportWidth: number, viewportHeight: number, edge = 24, gap = 16, globe?: GlobeCircle): CardRect | undefined {
  const maxX = viewportWidth - edge - preferred.width;
  const maxY = viewportHeight - edge - preferred.height;
  if (maxX < edge || maxY < edge) return;
  const clampX = (x: number) => Math.max(edge, Math.min(maxX, x));
  const clampY = (y: number) => Math.max(edge, Math.min(maxY, y));
  const xs = [clampX(preferred.left), edge, maxX];
  const ys = [clampY(preferred.top), edge, maxY];
  if (globe) {
    xs.push(clampX(globe.x - globe.radius - gap - preferred.width), clampX(globe.x + globe.radius + gap));
    ys.push(clampY(globe.y - globe.radius - gap - preferred.height), clampY(globe.y + globe.radius + gap));
    // Sample around the curved perimeter too, using corner pockets beside Earth.
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const clearance = Math.abs(dx) * preferred.width / 2 + Math.abs(dy) * preferred.height / 2;
      xs.push(clampX(globe.x + dx * (globe.radius + gap + clearance) - preferred.width / 2));
      ys.push(clampY(globe.y + dy * (globe.radius + gap + clearance) - preferred.height / 2));
    }
  }
  const globeOverlap = (rect: CardRect) => {
    if (!globe) return 0;
    const nearestX = Math.max(rect.left, Math.min(rect.left + rect.width, globe.x));
    const nearestY = Math.max(rect.top, Math.min(rect.top + rect.height, globe.y));
    return Math.max(0, globe.radius + gap - Math.hypot(nearestX - globe.x, nearestY - globe.y));
  };
  for (const rect of occupied) {
    xs.push(clampX(rect.left - gap - preferred.width), clampX(rect.left + rect.width + gap));
    ys.push(clampY(rect.top - gap - preferred.height), clampY(rect.top + rect.height + gap));
  }
  return xs.flatMap(left => ys.map(top => ({ ...preferred, left, top })))
    .filter(a => (!globe?.strict || globeOverlap(a) === 0) && occupied.every(b => !cardsOverlap(a, b, gap)))
    .sort((a, b) => globeOverlap(a) - globeOverlap(b) || Math.hypot(a.left - preferred.left, a.top - preferred.top) - Math.hypot(b.left - preferred.left, b.top - preferred.top))[0];
}
