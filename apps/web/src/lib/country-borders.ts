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
