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

// Common names that differ from the Natural Earth names in countries.geojson.json.
const ALIASES: Record<string, string> = {
  "united states": "United States of America", "usa": "United States of America", "us": "United States of America", "u.s.": "United States of America", "america": "United States of America",
  "uk": "United Kingdom", "u.k.": "United Kingdom", "britain": "United Kingdom", "great britain": "United Kingdom", "england": "United Kingdom", "scotland": "United Kingdom", "wales": "United Kingdom", "northern ireland": "United Kingdom",
  "russian federation": "Russia", "gaza": "Palestine", "gaza city": "Palestine", "gaza strip": "Palestine", "west bank": "Palestine",
  "tanzania": "United Republic of Tanzania", "serbia": "Republic of Serbia", "dr congo": "Democratic Republic of the Congo", "drc": "Democratic Republic of the Congo",
  "congo": "Republic of the Congo", "czech republic": "Czechia", "cote d'ivoire": "Ivory Coast", "côte d'ivoire": "Ivory Coast", "timor-leste": "East Timor",
  "bahamas": "The Bahamas", "swaziland": "eSwatini", "eswatini": "eSwatini", "burma": "Myanmar", "turkiye": "Turkey", "türkiye": "Turkey",
};
const NEAREST_REACH_DEGREES = 2.5; // ~275 km: offshore quakes and coastal centroids, not open ocean

type Located = { lat: number; lng: number; countryIso3?: string | null; attributes?: unknown; keywords?: { text: string; type?: string }[] | null };
const normalize = (text: string) => text.replace(/\(.*?\)/g, "").trim().toLowerCase();
/** Place names an event gives for itself: its location text (e.g. "Odesa, Odes'ka Oblast,
 * Ukraine"), then place keywords (e.g. "21 km NE of Lae, Papua New Guinea"), split at commas. */
function placeNames(event: Located): { names: string[]; stated: boolean } {
  const location = (event.attributes as { location?: unknown } | null | undefined)?.location;
  const texts = [
    ...(typeof location === "string" ? [location] : []),
    ...(event.keywords ?? []).filter(keyword => keyword.type === "place" || keyword.type === "location").map(keyword => keyword.text),
  ];
  return { names: texts.flatMap(text => text.split(",")).map(normalize).filter(Boolean), stated: typeof location === "string" };
}
const wrap = (degrees: number) => ((degrees + 540) % 360) - 180; // across the dateline
/** Squared distance in degrees (longitude scaled at the point's latitude) to a polygon edge. */
function edgeDistance(lng: number, lat: number, ring: number[][]): number {
  const scale = Math.cos(lat * Math.PI / 180);
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    // Unwrap the edge as a whole, so an edge opposite the point is not split across it.
    const a = wrap(ring[j][0] - lng), b = a + wrap(ring[i][0] - ring[j][0]);
    const ax = a * scale, ay = ring[j][1] - lat, bx = b * scale, by = ring[i][1] - lat;
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    best = Math.min(best, (ax + t * dx) ** 2 + (ay + t * dy) ** 2);
  }
  return best;
}

/**
 * The country an event belongs to, the same way everywhere in the world: the country under
 * its point, else its stated country (countryIso3), else a country its place names give
 * (coastal and region centroids often sit just offshore of coarse outlines), else the nearest
 * coast within reach (offshore earthquakes). A place stated as somewhere that is no country
 * (e.g. "Baltic Sea, Oceans") is not pulled to the nearest coast.
 */
export function eventCountry<F extends CountryFeature>(features: F[], event: Located): F | undefined {
  const under = features.find(feature => countryContains(feature, event));
  if (under) return under;
  const stated = event.countryIso3 ? features.find(feature => feature.id === event.countryIso3) : undefined;
  if (stated) return stated;
  const { names, stated: hasLocation } = placeNames(event);
  for (const name of names) {
    const target = ALIASES[name] ?? name;
    const named = features.find(feature => feature.properties.name.toLowerCase() === target.toLowerCase());
    if (named) return named;
  }
  if (hasLocation) return undefined;
  const lng = ((event.lng + 180) % 360 + 360) % 360 - 180;
  let nearest: F | undefined, best = NEAREST_REACH_DEGREES ** 2;
  for (const feature of features) {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates as number[][][]] : feature.geometry.coordinates as number[][][][];
    for (const polygon of polygons) {
      const distance = edgeDistance(lng, event.lat, polygon[0]);
      if (distance < best) { best = distance; nearest = feature; }
    }
  }
  return nearest;
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
