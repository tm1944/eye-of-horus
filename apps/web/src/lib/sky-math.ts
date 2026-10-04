/** Star placement and appearance: pure math, no Three.js. Angles in degrees unless noted. */

/** Greenwich mean sidereal time in degrees (IAU 1982, low precision: well under 1″ per century matters here). */
export function gmstDegrees(date: Date) {
  const days = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0
  return (((280.46061837 + 360.98564736629 * days) % 360) + 360) % 360;
}

/** Geographic point a star is directly above: latitude = declination, longitude = RA − GMST. */
export function subStellarPoint(raDeg: number, decDeg: number, gmst: number) {
  const lng = ((((raDeg - gmst) % 360) + 540) % 360) - 180;
  return { lat: decDeg, lng };
}

/** Unit direction in three-globe's frame (y = north pole; lng 0 toward +z, lng 90 toward +x). */
export function skyDirection(lat: number, lng: number): [number, number, number] {
  const phi = lat * Math.PI / 180, lambda = lng * Math.PI / 180;
  return [Math.cos(phi) * Math.sin(lambda), Math.sin(phi), Math.cos(phi) * Math.cos(lambda)];
}

// Approximate star colors by B−V index (Mitchell Charity's blackbody table, sRGB).
const BV_STOPS: [number, [number, number, number]][] = [
  [-0.4, [155, 176, 255]], [0, [202, 215, 255]], [0.3, [248, 247, 255]], [0.6, [255, 244, 234]],
  [1.0, [255, 210, 161]], [1.5, [255, 181, 108]], [2.0, [255, 155, 76]],
];

/** sRGB 0–1 color for a B−V index, blended toward white by `1 − saturation`. */
export function bvColor(bv: number, saturation: number): [number, number, number] {
  const x = Math.min(2, Math.max(-0.4, bv));
  let i = 0;
  while (i < BV_STOPS.length - 2 && x > BV_STOPS[i + 1][0]) i++;
  const [b0, c0] = BV_STOPS[i], [b1, c1] = BV_STOPS[i + 1];
  const t = (x - b0) / (b1 - b0);
  return [0, 1, 2].map(k => {
    const channel = (c0[k] + (c1[k] - c0[k]) * t) / 255;
    return 1 - saturation * (1 - channel);
  }) as [number, number, number];
}

/** Brightness 0–1 for a visual magnitude: Sirius (−1.46) is 1, the cutoff magnitude is 0. */
export function magnitudeWeight(vmag: number, cutoff: number) {
  return Math.min(1, Math.max(0, (cutoff - vmag) / (cutoff + 1.46)));
}
