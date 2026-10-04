type Geometry = { type: string; coordinates: number[][][] | number[][][][] };

/** Keep source ring topology for fills; omit artificial seam edges from outlines. */
export function countryBorders(features: { geometry: Geometry }[]): number[][][] {
  return features.flatMap(({ geometry }) => {
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates as number[][][]]
      : geometry.coordinates as number[][][][];
    return polygons.flatMap(polygon => polygon.flatMap(ring => {
      const segments: number[][][] = [];
      let line: number[][] = [];
      for (let index = 1; index < ring.length; index++) {
        const previous = ring[index - 1], current = ring[index];
        const atDateLine = (point: number[]) => Math.abs(Math.abs(point[0]) - 180) < 0.00001;
        const atPole = (point: number[]) => Math.abs(point[1]) > 89.99999;
        const seam = (atDateLine(previous) && atDateLine(current)) || atPole(previous) || atPole(current);
        if (seam) {
          if (line.length > 1) segments.push(line);
          line = [];
        } else {
          if (!line.length) line.push(previous);
          line.push(current);
        }
      }
      if (line.length > 1) segments.push(line);
      return segments;
    }));
  });
}

/** Match the great-circle contour subdivision used by ConicPolygonGeometry. */
export function borderContour(line: number[][], resolution: number): number[][] {
  const result: number[][] = [];
  const radians = Math.PI / 180;
  const vector = ([lng, lat]: number[]) => [Math.cos(lat*radians)*Math.cos(lng*radians), Math.cos(lat*radians)*Math.sin(lng*radians), Math.sin(lat*radians)];
  line.forEach((point, index) => {
    if (index) {
      const a = vector(line[index-1]), b = vector(point);
      const angle = Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, value, i) => sum + value*b[i], 0))));
      if (angle / radians > resolution) {
        const step = 1 / Math.ceil(angle / radians / resolution);
        for (let t = step; t < 1; t += step) {
          const first = Math.sin((1-t)*angle)/Math.sin(angle), second = Math.sin(t*angle)/Math.sin(angle);
          const [x,y,z] = a.map((value,i) => first*value + second*b[i]);
          result.push([Math.atan2(y,x)/radians, Math.atan2(z,Math.hypot(x,y))/radians]);
        }
      }
    }
    result.push(point);
  });
  return result;
}

export type NeighborBorder = { countryId: string; neighborId: string | null; points: number[][] };
const edgeKey = (a: number[], b: number[]) => {
  const [p, q] = [a, b].map(point => `${point[0].toFixed(6)},${point[1].toFixed(6)}`).sort();
  return `${p}|${q}`;
};

/** Each country's outline split into runs that share one neighbor; coastlines have none.
 * Neighbors share exact source vertices, so an undirected edge identifies the pair. */
export function neighborBorders(features: { id: string; geometry: Geometry }[]): NeighborBorder[] {
  const owners = new Map<string, Set<string>>();
  const lines = features.map(feature => ({ id: feature.id, lines: countryBorders([feature]) }));
  for (const { id, lines: outline } of lines) for (const line of outline) for (let index = 1; index < line.length; index++) {
    const key = edgeKey(line[index - 1], line[index]);
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key)!.add(id);
  }
  return lines.flatMap(({ id, lines: outline }) => outline.flatMap(line => {
    const runs: NeighborBorder[] = [];
    for (let index = 1; index < line.length; index++) {
      // Array.from, not spread: tests transpile this module to ES5, where Set spread is empty.
      const neighborId = Array.from(owners.get(edgeKey(line[index - 1], line[index]))!).find(owner => owner !== id) ?? null;
      const run = runs.at(-1);
      if (run && run.neighborId === neighborId) run.points.push(line[index]);
      else runs.push({ countryId: id, neighborId, points: [line[index - 1], line[index]] });
    }
    return runs;
  }));
}
