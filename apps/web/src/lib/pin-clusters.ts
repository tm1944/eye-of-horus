/** Pin grouping on screen, and the camera moves that pull a group apart. Pure functions. */

export type ScreenPin = { id: string; x: number; y: number; lat: number; lng: number };
export type PinCluster = { key: string; ids: string[]; x: number; y: number; colocated: boolean };

/**
 * Greedy leader clustering on a grid: each pin joins the first leader within `radiusPx`,
 * otherwise it leads a new cluster. Pass pins most-significant first so leaders (and
 * cluster keys) are stable. Pins at identical coordinates always share a cluster.
 */
export function clusterScreenPins(pins: ScreenPin[], radiusPx: number): PinCluster[] {
  const clusters: (PinCluster & { lat: number; lng: number })[] = [];
  const grid = new Map<string, number[]>();
  const cell = (x: number, y: number) => `${Math.floor(x / radiusPx)},${Math.floor(y / radiusPx)}`;
  for (const pin of pins) {
    const cx = Math.floor(pin.x / radiusPx), cy = Math.floor(pin.y / radiusPx);
    let joined: number | undefined;
    for (let dx = -1; dx <= 1 && joined === undefined; dx++) {
      for (let dy = -1; dy <= 1 && joined === undefined; dy++) {
        joined = grid.get(`${cx + dx},${cy + dy}`)?.find(index => {
          const leader = clusters[index];
          return (leader.lat === pin.lat && leader.lng === pin.lng) || Math.hypot(leader.x - pin.x, leader.y - pin.y) <= radiusPx;
        });
      }
    }
    if (joined === undefined) {
      const key = cell(pin.x, pin.y);
      grid.set(key, [...grid.get(key) ?? [], clusters.length]);
      clusters.push({ key: pin.id, ids: [pin.id], x: pin.x, y: pin.y, colocated: true, lat: pin.lat, lng: pin.lng });
    } else {
      const cluster = clusters[joined];
      cluster.ids.push(pin.id);
      cluster.colocated &&= cluster.lat === pin.lat && cluster.lng === pin.lng;
    }
  }
  return clusters.map(({ key, ids, x, y, colocated }) => ({ key, ids, x, y, colocated }));
}

type LatLng = { lat: number; lng: number };
const unit = ({ lat, lng }: LatLng) => {
  const phi = lat * Math.PI / 180, lambda = lng * Math.PI / 180;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
};

/** Spherical centroid of the points and the largest angle (radians) from it to any point. */
export function angularSpread(points: LatLng[]): { center: LatLng; angle: number } {
  const sum = points.map(unit).reduce((acc, v) => acc.map((value, i) => value + v[i]), [0, 0, 0]);
  const length = Math.hypot(...sum) || 1;
  const [x, y, z] = sum.map(value => value / length);
  const center = { lat: Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI, lng: Math.atan2(y, x) * 180 / Math.PI };
  const angle = Math.max(0, ...points.map(point => {
    const v = unit(point);
    return Math.acos(Math.max(-1, Math.min(1, v[0] * x + v[1] * y + v[2] * z)));
  }));
  return { center, angle };
}

/**
 * Camera altitude (in globe radii) at which a group spanning `angle` radians around the view
 * centre projects to about `targetPx` pixels of radius: r ≈ f·R·sinθ / (d − R·cosθ).
 * Always zooms in by at least `minStep`, never past `minAltitude`.
 */
export function spreadAltitude({ angle, targetPx, focalPx, currentAltitude, minAltitude, minStep = 0.75 }:
  { angle: number; targetPx: number; focalPx: number; currentAltitude: number; minAltitude: number; minStep?: number }) {
  const ideal = Math.cos(angle) - 1 + focalPx * Math.sin(angle) / targetPx;
  return Math.max(minAltitude, Math.min(ideal, currentAltitude * minStep));
}

export type SpotlightCandidate = { id: string; significance: number; x: number; y: number; front: boolean };
/**
 * The most significant front-facing event inside the central part of the view that has not
 * been spotlit recently, or null. `inset` is the fraction trimmed from each edge.
 */
export function pickSpotlight(candidates: SpotlightCandidate[], width: number, height: number, recent: Set<string>, inset = 0.2) {
  const inside = (c: SpotlightCandidate) => c.front && c.x > width * inset && c.x < width * (1 - inset) && c.y > height * inset && c.y < height * (1 - inset);
  return candidates.filter(c => inside(c) && !recent.has(c.id))
    .sort((a, b) => b.significance - a.significance || a.id.localeCompare(b.id))[0]?.id ?? null;
}
