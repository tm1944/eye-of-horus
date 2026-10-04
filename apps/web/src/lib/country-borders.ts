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
