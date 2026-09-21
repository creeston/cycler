/**
 * Integration tests for the full pipeline:
 *   GeoJSON (real Overpass export) → bike lanes → graph → routes
 *
 * Data file is currently at:
 *   app/domain/routing/scenarios/overpass-data.geojson
 * Suggested permanent location once you have more integration fixtures:
 *   app/integration/data/overpass-data.geojson
 *
 * Coordinates follow the GeoJSON/routing convention: [longitude, latitude].
 *
 * The one-way test uses a 30 km ceiling so the distance filter never rejects
 * the path: the straight-line start↔end distance is ~1.25 km, and the test is
 * about the path being found and well-formed, not about its length.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { FeatureCollection } from 'geojson'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { approxMeters } from '~/domain/routing/algorithms'
import { findRoutes } from '~/domain/routing/route-finder'
import { isRoundTrip } from '~/domain/entities/route'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { Route } from '~/domain/entities/route'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, '../domain/routing/scenarios/overpass-data.geojson')

// Warsaw Bemowo test coordinates (lon, lat)
const START_LON = 20.93628
const START_LAT = 52.290873
const END_LON = 20.9486
const END_LAT = 52.282443

const BASE_PREFERENCES = {
  startLon: START_LON,
  startLat: START_LAT,
  maxGapMeters: 200,
  startProximityMeters: 300,
  roundTrip: false,
}

function hasOnlyValidSegmentTypes(route: Route): boolean {
  return route.segments.every(s => s.type === 'bike_lane' || s.type === 'gap')
}

function signature(route: Route): string {
  return route.segments.map(s => s.geometry.coordinates[0].join(',')).join('|')
}

function countDiscontinuities(routes: Route[]): number {
  let count = 0
  for (const route of routes) {
    for (let i = 0; i < route.segments.length - 1; i++) {
      const current = route.segments[i].geometry.coordinates
      const next = route.segments[i + 1].geometry.coordinates
      const end = current[current.length - 1]
      const start = next[0]
      if (approxMeters(end[0], end[1], start[0], start[1]) > 2) count++
    }
  }
  return count
}

let lanes: BikeLane[]

beforeAll(() => {
  const fc = JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as FeatureCollection
  lanes = geojsonToBikeLanes(fc)
})

describe('routing integration — Warsaw overpass data', () => {
  it('loads GeoJSON into a non-empty set of bike lanes', () => {
    expect(lanes.length).toBeGreaterThan(0)
  })

  describe('round-trip routing', () => {
    let routes: Route[]

    beforeAll(() => {
      routes = findRoutes(lanes, {
        ...BASE_PREFERENCES,
        minDistanceMeters: 2_000,
        maxDistanceMeters: 10_000,
        roundTrip: true,
      })
    })

    it('finds at least one route', () => {
      expect(routes.length).toBeGreaterThan(0)
    })

    it('every route is a closed loop (start coord equals end coord)', () => {
      routes.forEach(r => {
        expect(isRoundTrip(r), `route ${r.id} is not a round trip`).toBe(true)
      })
    })

    it('every route distance is within the configured bounds', () => {
      routes.forEach(r => {
        expect(r.totalDistanceMeters).toBeGreaterThanOrEqual(2_000)
        expect(r.totalDistanceMeters).toBeLessThanOrEqual(10_000)
      })
    })

    it('every route contains only bike_lane and gap segments', () => {
      routes.forEach(r => {
        expect(hasOnlyValidSegmentTypes(r), `route ${r.id} has unknown segment type`).toBe(true)
      })
    })

    it('every route has at least one bike_lane segment', () => {
      routes.forEach(r => {
        expect(r.bikeLaneDistanceMeters).toBeGreaterThan(0)
      })
    })

    it('every route has continuous segment geometry', () => {
      expect(countDiscontinuities(routes)).toBe(0)
    })
  })

  describe('explore routing', () => {
    it('keeps every route inside a narrow distance band', () => {
      const routes = findRoutes(lanes, {
        ...BASE_PREFERENCES,
        minDistanceMeters: 3_000,
        maxDistanceMeters: 3_500,
      })

      expect(routes.length).toBeGreaterThan(0)
      routes.forEach(r => {
        expect(r.totalDistanceMeters).toBeGreaterThanOrEqual(3_000)
        expect(r.totalDistanceMeters).toBeLessThanOrEqual(3_500)
      })
    })
  })

  describe('start point', () => {
    /** Straight-line distance from the picked start to where a route actually begins. */
    function startOffsetMeters(route: Route): number {
      const [lon, lat] = route.segments[0].geometry.coordinates[0]
      return approxMeters(START_LON, START_LAT, lon, lat)
    }

    it('begins every route within the start search radius of the picked point', () => {
      const routes = findRoutes(lanes, {
        ...BASE_PREFERENCES,
        minDistanceMeters: 3_000,
        maxDistanceMeters: 6_000,
      })

      expect(routes.length).toBeGreaterThan(0)
      routes.forEach(r => {
        expect(startOffsetMeters(r)).toBeLessThanOrEqual(BASE_PREFERENCES.startProximityMeters)
      })
    })

    // At the fixture start the nearest lane end is 239 m away: 300 m catches
    // 14 candidates, 500 m catches 68, and anything under 239 m catches none.
    it('a wider radius yields a larger batch; a narrower one still starts within it', () => {
      const wide = findRoutes(lanes, {
        ...BASE_PREFERENCES,
        minDistanceMeters: 3_000,
        maxDistanceMeters: 6_000,
        startProximityMeters: 500,
      })
      const narrow = findRoutes(lanes, {
        ...BASE_PREFERENCES,
        minDistanceMeters: 3_000,
        maxDistanceMeters: 6_000,
        startProximityMeters: 300,
      })

      expect(narrow.length).toBeGreaterThan(0)
      expect(narrow.length).toBeLessThan(wide.length)
      narrow.forEach(r => expect(startOffsetMeters(r)).toBeLessThanOrEqual(300))
    })

    it('a 50 m radius that catches no lane end still routes from the nearest one', () => {
      const routes = findRoutes(lanes, {
        ...BASE_PREFERENCES,
        minDistanceMeters: 3_000,
        maxDistanceMeters: 6_000,
        startProximityMeters: 50,
      })

      expect(routes.length).toBeGreaterThan(0)
      const offsets = new Set(routes.map(r => Math.round(startOffsetMeters(r))))
      expect(offsets).toEqual(new Set([239]))
    })
  })

  describe('determinism', () => {
    const preferences = {
      ...BASE_PREFERENCES,
      minDistanceMeters: 2_000,
      maxDistanceMeters: 10_000,
    }

    it.each([false, true])('the same seed gives the same routes (roundTrip: %s)', roundTrip => {
      const first = findRoutes(lanes, { ...preferences, roundTrip }, { seed: 7 })
      const second = findRoutes(lanes, { ...preferences, roundTrip }, { seed: 7 })

      expect(first.length).toBeGreaterThan(0)
      expect(first.map(signature)).toEqual(second.map(signature))
    })

    it('a different seed casts the round-trip fan elsewhere', () => {
      const first = findRoutes(lanes, { ...preferences, roundTrip: true }, { seed: 7 })
      const second = findRoutes(lanes, { ...preferences, roundTrip: true }, { seed: 8 })

      expect(first.map(signature)).not.toEqual(second.map(signature))
    })
  })

  describe('progress', () => {
    it('counts the graph build and every start candidate, ending complete', () => {
      const reports: { completed: number; total: number }[] = []
      findRoutes(
        lanes,
        { ...BASE_PREFERENCES, minDistanceMeters: 2_000, maxDistanceMeters: 10_000 },
        { onProgress: progress => reports.push(progress) },
      )

      expect(reports.length).toBeGreaterThan(2)
      expect(reports[0]).toEqual({ completed: 0, total: 1 })
      for (let i = 1; i < reports.length; i++) {
        expect(reports[i].completed).toBeGreaterThanOrEqual(reports[i - 1].completed)
        expect(reports[i].total).toBeGreaterThanOrEqual(reports[i - 1].total)
      }
      const last = reports[reports.length - 1]
      expect(last.completed).toBe(last.total)
      expect(last.total).toBeGreaterThan(1)
    })
  })

  describe('one-way routing', () => {
    let routes: Route[]

    beforeAll(() => {
      routes = findRoutes(lanes, {
        ...BASE_PREFERENCES,
        endLon: END_LON,
        endLat: END_LAT,
        minDistanceMeters: 0,
        maxDistanceMeters: 30_000,
        roundTrip: false,
      })
    })

    it('finds exactly one route (shortest path)', () => {
      expect(routes.length).toBe(1)
    })

    it('route distance is within the configured bound', () => {
      expect(routes[0].totalDistanceMeters).toBeGreaterThan(0)
      expect(routes[0].totalDistanceMeters).toBeLessThanOrEqual(30_000)
    })

    it('route contains only bike_lane and gap segments', () => {
      expect(
        hasOnlyValidSegmentTypes(routes[0]),
        `route ${routes[0].id} has unknown segment type`,
      ).toBe(true)
    })

    it('route has at least one bike_lane segment', () => {
      expect(routes[0].bikeLaneDistanceMeters).toBeGreaterThan(0)
    })

    it('route has continuous segment geometry', () => {
      expect(countDiscontinuities(routes)).toBe(0)
    })
  })
})
