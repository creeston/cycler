/**
 * Builds a graph-node key from a coordinate pair, snapped to ~1 m grid.
 * Shared by graph.ts and tests.
 */
export function coordKey(lon: number, lat: number): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`
}

const EARTH_RADIUS_METERS = 6_371_000

/**
 * Metres per degree of latitude in approxMeters' terms. The spatial index sizes
 * its cells with this same constant, so a cell is never shorter than the
 * distance it is meant to cover.
 */
export const METERS_PER_DEGREE = (EARTH_RADIUS_METERS * Math.PI) / 180

/**
 * Equirectangular distance approximation — much faster than Haversine for the
 * inner loops of gap detection and barrier testing. Accurate to < 0.1% for
 * d < 10 km, which is two orders of magnitude beyond any distance it is asked
 * for here.
 */
export function approxMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const avgLat = (((lat1 + lat2) / 2) * Math.PI) / 180
  return EARTH_RADIUS_METERS * Math.sqrt(dLat * dLat + (dLon * Math.cos(avgLat)) ** 2)
}
