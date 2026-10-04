export type CountryFeature = { id: string; properties: { name: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } };

// Natural Earth stores dateline-crossing countries as separate polygon parts.
// Test each part and its holes; boundary points count as inside.
function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const cross = (lng - ax) * (by - ay) - (lat - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-9 && lng >= Math.min(ax,bx) && lng <= Math.max(ax,bx) && lat >= Math.min(ay,by) && lat <= Math.max(ay,by)) return true;
    if ((ay > lat) !== (by > lat) && lng < (bx-ax)*(lat-ay)/(by-ay)+ax) inside = !inside;
  }
  return inside;
}
export function countryContains(country: CountryFeature, point: { lat: number; lng: number }): boolean {
  const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates as number[][][]] : country.geometry.coordinates as number[][][][];
  const lng = ((point.lng + 180) % 360 + 360) % 360 - 180;
  return polygons.some(p => inRing(lng, point.lat, p[0]) && !p.slice(1).some(hole => inRing(lng, point.lat, hole)));
}

/** Events in the selected countries once each, with the name of the first selected
 * country that contains it. `include` filters them (e.g. to active layers). Events with
 * connections (linkCount > 0) come first; each group is most significant first.
 * Array.from, not spread: the unit tests transpile this module to ES5, where spreading a
 * Map iterator yields nothing. */
export function countryHeadlines<T extends { id: string; significance: number }>(
  countries: { name: string; events: T[] }[],
  { include = () => true, linkCount = () => 0 }: { include?: (event: T) => boolean; linkCount?: (id: string) => number } = {},
): { event: T; country: string; links: number }[] {
  const byId = new Map<string, { event: T; country: string; links: number }>();
  for (const country of countries) for (const event of country.events) {
    if (!byId.has(event.id) && include(event)) byId.set(event.id, { event, country: country.name, links: linkCount(event.id) });
  }
  return Array.from(byId.values()).sort((a, b) => Number(b.links > 0) - Number(a.links > 0)
    || b.event.significance - a.event.significance || a.event.id.localeCompare(b.event.id));
}
