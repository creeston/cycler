import { describe, it, expect } from 'vitest'
import { METERS_PER_DEGREE, approxMeters } from './algorithms'
import { buildPointIndex, forEachPairWithin, nearestPoint, pointsWithin } from './spatial-index'
import { seededRandom } from './random'

/** Latitudes where the old rectangular prefilter was safe (52°) and where it was not (75°, 85°). */
const LATITUDES = [0, 52, 75, 85]

describe('forEachPairWithin', () => {
  it.each(LATITUDES)('finds exactly the pairs brute force finds at %i° latitude', lat => {
    const { lons, lats } = scatter(400, lat, 3_000)
    for (const [cell, radius] of [
      [200, 200],
      [200, 150],
      [200, 450],
      [50, 500],
    ]) {
      const index = buildPointIndex(lons, lats, cell)
      const found = new Set<string>()
      forEachPairWithin(index, radius, (i, j, d) => {
        expect(i).toBeLessThan(j)
        expect(d).toBeCloseTo(approxMeters(lons[i], lats[i], lons[j], lats[j]), 9)
        found.add(`${i}-${j}`)
      })
      expect(found).toEqual(bruteForcePairs(lons, lats, radius))
      expect(found.size).toBeGreaterThan(0)
    }
  })

  it('reports each pair once', () => {
    const { lons, lats } = scatter(300, 52, 1_000)
    const index = buildPointIndex(lons, lats, 100)
    const seen: string[] = []
    forEachPairWithin(index, 300, (i, j) => seen.push(`${i}-${j}`))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('handles an empty set and a single point', () => {
    const visit = () => {
      throw new Error('no pairs expected')
    }
    forEachPairWithin(buildPointIndex([], [], 100), 100, visit)
    forEachPairWithin(buildPointIndex([21], [52], 100), 100, visit)
  })

  it('keeps a pair a hair under one cell apart in adjacent cells', () => {
    // A sits at the top of its row and B is 200 m minus a hair north of it,
    // so B lands in the next row. Rounding must not push it two rows away.
    const cellDeg = 200 / METERS_PER_DEGREE
    const lats = [52 - 0.999 * cellDeg, 52, 52 + (200 - 1e-7) / METERS_PER_DEGREE]
    const index = buildPointIndex([21, 21, 21], lats, 200)
    const pairs: string[] = []
    forEachPairWithin(index, 200, (i, j) => pairs.push(`${i}-${j}`))
    expect(pairs).toContain('1-2')
    expect(pairs).toEqual([...bruteForcePairs([21, 21, 21], lats, 200)].sort())
  })
})

describe('pointsWithin', () => {
  it.each(LATITUDES)('matches a brute-force radius scan at %i° latitude', lat => {
    const { lons, lats } = scatter(400, lat, 3_000)
    const index = buildPointIndex(lons, lats, 200)
    const random = seededRandom(7)
    for (let q = 0; q < 50; q++) {
      const lon = lons[Math.floor(random() * lons.length)] + (random() - 0.5) * 0.01
      const qLat = lats[Math.floor(random() * lats.length)] + (random() - 0.5) * 0.01
      const radius = [50, 200, 300, 900][q % 4]
      const expected = lons
        .map((_, i) => i)
        .filter(i => approxMeters(lon, qLat, lons[i], lats[i]) <= radius)
      expect(pointsWithin(index, lon, qLat, radius)).toEqual(expected)
    }
  })

  it('returns indices in ascending order', () => {
    const { lons, lats } = scatter(400, 52, 1_000)
    const index = buildPointIndex(lons, lats, 100)
    const found = pointsWithin(index, lons[0], lats[0], 500)
    expect(found).toEqual([...found].sort((a, b) => a - b))
    expect(found.length).toBeGreaterThan(1)
  })

  it('finds nothing when the query is far outside the set', () => {
    const { lons, lats } = scatter(100, 52, 1_000)
    const index = buildPointIndex(lons, lats, 100)
    expect(pointsWithin(index, lons[0] + 1, lats[0] + 1, 500)).toEqual([])
  })
})

describe('nearestPoint', () => {
  it.each(LATITUDES)('agrees with a brute-force scan at %i° latitude', lat => {
    const { lons, lats } = scatter(400, lat, 3_000)
    const index = buildPointIndex(lons, lats, 200)
    const random = seededRandom(11)
    for (let q = 0; q < 50; q++) {
      const lon = lons[0] + (random() - 0.5) * 0.1
      const qLat = lats[0] + (random() - 0.5) * 0.1
      const expected = bruteForceNearest(lons, lats, lon, qLat)
      const actual = nearestPoint(index, lon, qLat)
      expect(actual?.index).toBe(expected)
      expect(actual?.distanceMeters).toBeCloseTo(
        approxMeters(lon, qLat, lons[expected], lats[expected]),
        9,
      )
    }
  })

  it('finds the nearest point when the query is far outside the set', () => {
    const { lons, lats } = scatter(200, 52, 2_000)
    const index = buildPointIndex(lons, lats, 100)
    const lon = lons[0] + 2
    const lat = lats[0] - 1.5
    expect(nearestPoint(index, lon, lat)?.index).toBe(bruteForceNearest(lons, lats, lon, lat))
  })

  it('ranks a point 90 m east above one 100 m north at 52° N', () => {
    // 1 m of longitude is 1/cos(52°) ≈ 1.62 times as many degrees as 1 m of
    // latitude, so a degree-space comparison would pick the northern point.
    const east = 90 / (METERS_PER_DEGREE * Math.cos((52 * Math.PI) / 180))
    const north = 100 / METERS_PER_DEGREE
    const index = buildPointIndex([21, 21 + east], [52 + north, 52], 200)
    expect(nearestPoint(index, 21, 52)?.index).toBe(1)
  })

  it('breaks a tie by the lower index', () => {
    const index = buildPointIndex([21.001, 20.999], [52, 52], 200)
    expect(nearestPoint(index, 21, 52)?.index).toBe(0)
  })

  it('returns null for an empty index', () => {
    expect(nearestPoint(buildPointIndex([], [], 100), 21, 52)).toBeNull()
  })
})

function scatter(
  count: number,
  centreLat: number,
  extentMeters: number,
): { lons: number[]; lats: number[] } {
  const random = seededRandom(count + centreLat)
  const latHalf = extentMeters / 2 / 111_195
  const lonHalf = latHalf / Math.cos((centreLat * Math.PI) / 180)
  const lons: number[] = []
  const lats: number[] = []
  for (let i = 0; i < count; i++) {
    lons.push(21 + (random() * 2 - 1) * lonHalf)
    lats.push(centreLat + (random() * 2 - 1) * latHalf)
  }
  return { lons, lats }
}

function bruteForcePairs(lons: number[], lats: number[], radius: number): Set<string> {
  const pairs = new Set<string>()
  for (let i = 0; i < lons.length; i++) {
    for (let j = i + 1; j < lons.length; j++) {
      if (approxMeters(lons[i], lats[i], lons[j], lats[j]) <= radius) pairs.add(`${i}-${j}`)
    }
  }
  return pairs
}

function bruteForceNearest(lons: number[], lats: number[], lon: number, lat: number): number {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < lons.length; i++) {
    const d = approxMeters(lon, lat, lons[i], lats[i])
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}
