/**
 * What a rider is promised about their gap tolerance, checked against the real
 * Warsaw Bemowo export: a returned route either respects the tolerance, or
 * says on its face that it was widened and by how much.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { FeatureCollection } from 'geojson'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { geojsonToBarriers } from '~/domain/mappers/osm-to-barriers'
import { findRoutes } from '~/domain/routing/route-finder'
import { longestGapMeters, wasGapToleranceWidened } from '~/domain/entities/route'
import type { BarrierData } from '~/domain/entities/barrier'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { Route } from '~/domain/entities/route'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LANES_PATH = join(__dirname, '../domain/routing/scenarios/overpass-data.geojson')
const BARRIERS_PATH = join(__dirname, '../domain/routing/scenarios/overpass-barriers.geojson')

const BASE_PREFERENCES = {
  startLon: 20.93628,
  startLat: 52.290873,
  startProximityMeters: 300,
  minDistanceMeters: 2_000,
  maxDistanceMeters: 10_000,
  roundTrip: false,
}

let lanes: BikeLane[]
let barriers: BarrierData

beforeAll(() => {
  lanes = geojsonToBikeLanes(JSON.parse(readFileSync(LANES_PATH, 'utf-8')) as FeatureCollection)
  barriers = geojsonToBarriers(
    JSON.parse(readFileSync(BARRIERS_PATH, 'utf-8')) as FeatureCollection,
  )
})

const realRandom = Math.random
afterEach(() => {
  Math.random = realRandom
})

describe('gap tolerance — Warsaw overpass data', () => {
  it.each([50, 100, 200])('returns no gap longer than the %i m the rider asked for', tolerance => {
    Math.random = mulberry32(7)
    const routes = findRoutes(lanes, { ...BASE_PREFERENCES, maxGapMeters: tolerance }, barriers)

    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      const limit = route.appliedGapMeters
      expect(longestGapMeters(route), `route ${route.id} exceeds ${limit} m`).toBeLessThanOrEqual(
        limit,
      )
      if (!wasGapToleranceWidened(route)) expect(limit).toBe(tolerance)
    }
  })

  it('holds the tolerance for round trips too', () => {
    Math.random = mulberry32(11)
    const routes = findRoutes(
      lanes,
      { ...BASE_PREFERENCES, maxGapMeters: 100, roundTrip: true },
      barriers,
    )

    expect(routes.length).toBeGreaterThan(0)
    routes.forEach(route => expect(longestGapMeters(route)).toBeLessThanOrEqual(100))
  })

  it('says on the route when it had to widen the tolerance to find anything', () => {
    Math.random = mulberry32(3)
    // A 5 m tolerance bridges almost nothing, and a loop has to come back, so
    // the fixture cannot close one without the fallback.
    const routes = findRoutes(
      lanes,
      { ...BASE_PREFERENCES, maxGapMeters: 5, roundTrip: true },
      barriers,
    )

    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      expect(wasGapToleranceWidened(route)).toBe(true)
      expect(route.requestedGapMeters).toBe(5)
      expect(route.appliedGapMeters).toBe(1_000)
      expect(longestGapMeters(route)).toBeLessThanOrEqual(1_000)
    }
  })

  it('leaves the tolerance alone when the request can be met', () => {
    Math.random = mulberry32(5)
    const routes = findRoutes(lanes, { ...BASE_PREFERENCES, maxGapMeters: 200 }, barriers)

    expect(routes.length).toBeGreaterThan(0)
    routes.forEach(route => expect(wasGapToleranceWidened(route)).toBe(false))
  })

  it('spends most of its distance on bike lanes', () => {
    Math.random = mulberry32(9)
    const routes = findRoutes(lanes, { ...BASE_PREFERENCES, maxGapMeters: 200 }, barriers)

    // Measured at 88.8 % mean coverage over 10 seeds; the floor guards a collapse.
    expect(meanCoverage(routes)).toBeGreaterThan(0.8)
  })
})

function meanCoverage(routes: Route[]): number {
  if (routes.length === 0) return 0
  return routes.reduce((sum, route) => sum + route.bikeLaneCoverage, 0) / routes.length
}

/** Deterministic PRNG so route counts do not vary between runs. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
