/**
 * Heatmap density on a three.js SphereGeometry vertex grid, matching three-globe's
 * heatmap math (Gaussian kernel over great-circle distance, influence cut off at four
 * bandwidths, values normalized against the maximum with 1.5 saturation) but computed
 * only near each point, so one category can be rebuilt without touching the others.
 */
export type SphereGrid = {
  widthSegments: number;
  heightSegments: number;
  lats: Float64Array; // degrees, per vertex
  lngs: Float64Array; // degrees, per vertex
};
export type DensityPoint = { lat: number; lng: number; weight: number };

const RAD = Math.PI / 180;
const INFLUENCE_BANDWIDTHS = 4;
const SATURATION = 1.5;

/** Vertex lat/lng using three-globe's cartesian2Polar convention. */
export function sphereGrid(positions: ArrayLike<number>, widthSegments: number, heightSegments: number): SphereGrid {
  const count = positions.length / 3;
  const lats = new Float64Array(count), lngs = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const x = positions[index * 3], y = positions[index * 3 + 1], z = positions[index * 3 + 2];
    const r = Math.hypot(x, y, z);
    const theta = Math.atan2(z, x);
    lats[index] = 90 - Math.acos(Math.max(-1, Math.min(1, y / r))) / RAD;
    lngs[index] = 90 - theta / RAD - (theta < -Math.PI / 2 ? 360 : 0);
  }
  return { widthSegments, heightSegments, lats, lngs };
}

const wrap = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;
const modulo = (value: number, size: number) => ((value % size) + size) % size;

/** Normalized density per vertex in [0, 1]. */
export function densityField(grid: SphereGrid, points: DensityPoint[], bandwidthDegrees: number): Float32Array {
  const { widthSegments: w, heightSegments: h, lats, lngs } = grid;
  const columns = w + 1;
  const raw = new Float64Array(lats.length);
  const bandwidth = bandwidthDegrees * RAD;
  const reach = INFLUENCE_BANDWIDTHS * bandwidthDegrees;
  const rowStep = 180 / h;
  // Columns advance in a fixed longitude step; read it from the first interior row.
  const lng0 = lngs[columns], colStep = wrap(lngs[columns + 1] - lng0);
  for (const point of points) {
    if (!point.weight) continue;
    const pointLat = point.lat * RAD, cosPointLat = Math.cos(pointLat);
    const firstRow = Math.max(0, Math.floor((90 - (point.lat + reach)) / rowStep));
    const lastRow = Math.min(h, Math.ceil((90 - (point.lat - reach)) / rowStep));
    for (let row = firstRow; row <= lastRow; row++) {
      const rowLat = 90 - row * rowStep;
      // Near the poles a small circle spans every longitude.
      const span = Math.abs(rowLat) + reach >= 90 ? 180 : Math.min(180, reach / Math.cos(rowLat * RAD));
      const halfColumns = Math.min(Math.ceil(w / 2), Math.ceil(span / Math.abs(colStep)) + 1);
      const center = Math.round(wrap(point.lng - lng0) / colStep);
      const visited = new Set<number>();
      for (let offset = -halfColumns; offset <= halfColumns; offset++) {
        const column = modulo(center + offset, w);
        if (visited.has(column)) continue;
        visited.add(column);
        const index = row * columns + column;
        const vertexLat = lats[index] * RAD;
        const dLat = vertexLat - pointLat, dLng = wrap(lngs[index] - point.lng) * RAD;
        const hav = Math.sin(dLat / 2) ** 2 + cosPointLat * Math.cos(vertexLat) * Math.sin(dLng / 2) ** 2;
        const distance = 2 * Math.asin(Math.min(1, Math.sqrt(hav)));
        if (distance >= reach * RAD) continue;
        raw[index] += point.weight * Math.exp(-((distance / bandwidth) ** 2) / 2);
      }
      raw[row * columns + w] = raw[row * columns]; // seam duplicate of column 0
    }
  }
  let max = 0;
  for (const value of raw) if (value > max) max = value;
  const field = new Float32Array(raw.length);
  if (max > 0) for (let index = 0; index < raw.length; index++) field[index] = Math.min(1, raw[index] * SATURATION / max);
  return field;
}

/** Equator segments three-globe uses for a bandwidth (resolution = bandwidth / 3.5°, ≥ 0.1°). */
export function heatmapSegments(bandwidthDegrees: number): { widthSegments: number; heightSegments: number } {
  const widthSegments = Math.ceil(360 / Math.max(0.1, bandwidthDegrees / 3.5));
  return { widthSegments, heightSegments: Math.ceil(widthSegments / 2) };
}
