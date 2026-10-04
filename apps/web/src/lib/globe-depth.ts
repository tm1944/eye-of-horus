/** Bound the depth buffer to the globe instead of the renderer's huge sky volume. */
export function globeClipPlanes(distance: number, radius: number, atmosphereAltitude: number) {
  const extent = radius * (1 + atmosphereAltitude);
  return {
    near: Math.max(radius * 0.001, (distance - extent) * 0.9),
    far: distance + extent + radius * 0.1,
  };
}
