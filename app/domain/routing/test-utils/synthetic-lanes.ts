import type { BikeLane } from '../../entities/bike-lane'

/**
 * Small deterministic PRNG (mulberry32), so a synthetic set is the same on
 * every run and timings stay comparable.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SyntheticLaneOptions {
  /** Centre latitude in degrees; density and cell scaling both depend on it. */
  centreLat?: number
  centreLon?: number
  /** Side of the square area the lanes are scattered over, in metres. */
  extentMeters?: number
  /** Longest lane, in metres; lanes are 20 m to this long. */
  maxLaneMeters?: number
  seed?: number
}

/**
 * Two-vertex lanes scattered uniformly over a square, so a set of n lanes has
 * about 2n graph nodes. The defaults model a 20 x 20 km city at Warsaw's
 * latitude: 5 000 lanes gives roughly the node density of the real extract
 * measured in backlog/done/32.
 */
export function syntheticLanes(count: number, options: SyntheticLaneOptions = {}): BikeLane[] {
  const {
    centreLat = 52.23,
    centreLon = 21.0,
    extentMeters = 20_000,
    maxLaneMeters = 300,
    seed = 1,
  } = options
  const random = seededRandom(seed)
  const metersPerDegree = 111_195
  const latHalf = extentMeters / 2 / metersPerDegree
  const lonHalf = latHalf / Math.cos((centreLat * Math.PI) / 180)

  const lanes: BikeLane[] = []
  for (let i = 0; i < count; i++) {
    const lon = centreLon + (random() * 2 - 1) * lonHalf
    const lat = centreLat + (random() * 2 - 1) * latHalf
    const length = 20 + random() * (maxLaneMeters - 20)
    const bearing = random() * 2 * Math.PI
    const dLat = (length * Math.cos(bearing)) / metersPerDegree
    const dLon = (length * Math.sin(bearing)) / metersPerDegree / Math.cos((lat * Math.PI) / 180)
    lanes.push({
      id: `s${i}`,
      osmId: `s${i}`,
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon, lat],
          [lon + dLon, lat + dLat],
        ],
      },
      laneType: 'cycleway',
      tags: { highway: 'cycleway' },
    })
  }
  return lanes
}
