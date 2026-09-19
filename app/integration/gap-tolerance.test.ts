/**
 * What a rider is promised about their gap tolerance, checked against the real
 * Warsaw Bemowo export: a returned route either respects the tolerance, or
 * says on its face that it was widened and by how much.
 */
import { describe, it, expect, beforeAll } from 'vitest'
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

describe('gap tolerance — Warsaw overpass data', () => {
  it.each([50, 100, 200])('returns no gap longer than the %i m the rider asked for', tolerance => {
    const routes = findRoutes(lanes, { ...BASE_PREFERENCES, maxGapMeters: tolerance }, { barriers })

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
    const routes = findRoutes(
      lanes,
      { ...BASE_PREFERENCES, maxGapMeters: 100, roundTrip: true },
      { barriers },
    )

    expect(routes.length).toBeGreaterThan(0)
    routes.forEach(route => expect(longestGapMeters(route)).toBeLessThanOrEqual(100))
  })

  it('says on the route when it had to widen the tolerance to find anything', () => {
    // A 5 m tolerance bridges almost nothing, and the lane graph alone has no
    // loop of 8 km or more from here, so the fixture cannot close one without
    // the fallback.
    const routes = findRoutes(
      lanes,
      { ...BASE_PREFERENCES, maxGapMeters: 5, minDistanceMeters: 8_000, roundTrip: true },
      { barriers },
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
    const routes = findRoutes(lanes, { ...BASE_PREFERENCES, maxGapMeters: 200 }, { barriers })

    expect(routes.length).toBeGreaterThan(0)
    routes.forEach(route => expect(wasGapToleranceWidened(route)).toBe(false))
  })

  it('spends most of its distance on bike lanes', () => {
    const routes = findRoutes(lanes, { ...BASE_PREFERENCES, maxGapMeters: 200 }, { barriers })

    // Measured at 100 % mean coverage: from here every route in range stays on
    // lanes. The floor guards a collapse.
    expect(meanCoverage(routes)).toBeGreaterThan(0.8)
  })
})

function meanCoverage(routes: Route[]): number {
  if (routes.length === 0) return 0
  return routes.reduce((sum, route) => sum + route.bikeLaneCoverage, 0) / routes.length
}
