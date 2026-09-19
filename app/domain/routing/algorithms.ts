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

const DEG = Math.PI / 180

/**
 * Great-circle distance. The A* heuristic uses it because it never exceeds
 * the length of any path between the two points, which is what keeps the
 * heuristic admissible; approxMeters can overshoot by a fraction of a percent.
 */
export function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * DEG
  const dLon = (lon2 - lon1) * DEG
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a))
}

/** Initial bearing from the first point to the second, in degrees clockwise from north, 0–360. */
export function bearingDegrees(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLon = (lon2 - lon1) * DEG
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG)
  const x =
    Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(dLon)
  return (((Math.atan2(y, x) / DEG) % 360) + 360) % 360
}

/** The point reached by travelling distanceMeters from (lon, lat) along a bearing. */
export function destinationPoint(
  lon: number,
  lat: number,
  distanceMeters: number,
  bearing: number,
): [number, number] {
  const delta = distanceMeters / EARTH_RADIUS_METERS
  const phi = lat * DEG
  const theta = bearing * DEG
  const phi2 = Math.asin(
    Math.sin(phi) * Math.cos(delta) + Math.cos(phi) * Math.sin(delta) * Math.cos(theta),
  )
  const lambda2 =
    lon * DEG +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi),
      Math.cos(delta) - Math.sin(phi) * Math.sin(phi2),
    )
  return [lambda2 / DEG, phi2 / DEG]
}
