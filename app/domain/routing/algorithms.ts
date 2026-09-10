/**
 * Builds a graph-node key from a coordinate pair, snapped to ~1 m grid.
 * Shared by graph.ts and tests.
 */
export function coordKey(lon: number, lat: number): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`
}

/**
 * Equirectangular distance approximation — much faster than Haversine for the
 * inner loops of gap detection and barrier testing. Accurate to < 0.1% for
 * d < 10 km, which is two orders of magnitude beyond any distance it is asked
 * for here.
 */
export function approxMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const avgLat = (((lat1 + lat2) / 2) * Math.PI) / 180
  return R * Math.sqrt(dLat * dLat + (dLon * Math.cos(avgLat)) ** 2)
}
