export type CardRect = { left: number; top: number; width: number; height: number };

/** Find a free rectangle nearest the preferred position, without moving existing cards. */
export function placeCard(preferred: CardRect, occupied: CardRect[], viewportWidth: number, viewportHeight: number, edge = 24, gap = 16): CardRect | undefined {
  const maxX = viewportWidth - edge - preferred.width;
  const maxY = viewportHeight - edge - preferred.height;
  if (maxX < edge || maxY < edge) return;
  const clampX = (x: number) => Math.max(edge, Math.min(maxX, x));
  const clampY = (y: number) => Math.max(edge, Math.min(maxY, y));
  const xs = [clampX(preferred.left), edge, maxX];
  const ys = [clampY(preferred.top), edge, maxY];
  for (const rect of occupied) {
    xs.push(clampX(rect.left - gap - preferred.width), clampX(rect.left + rect.width + gap));
    ys.push(clampY(rect.top - gap - preferred.height), clampY(rect.top + rect.height + gap));
  }
  return xs.flatMap(left => ys.map(top => ({ ...preferred, left, top })))
    .filter(a => occupied.every(b => a.left + a.width + gap <= b.left || b.left + b.width + gap <= a.left || a.top + a.height + gap <= b.top || b.top + b.height + gap <= a.top))
    .sort((a, b) => Math.hypot(a.left - preferred.left, a.top - preferred.top) - Math.hypot(b.left - preferred.left, b.top - preferred.top))[0];
}
