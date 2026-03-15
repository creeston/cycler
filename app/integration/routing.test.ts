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
 * maxDistanceMeters for the one-way test is deliberately short (4 km) because
 * the DFS explores all simple paths and its cost grows with route depth.
 * The straight-line start↔end distance here is ~1.25 km, so 4 km allows a
 * reasonable detour while keeping the search space tractable.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { FeatureCollection } from 'geojson'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { findRoutes } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { Route } from '~/domain/entities/route'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, '../domain/routing/scenarios/overpass-data.geojson')

// Warsaw Bemowo test coordinates (lon, lat)
const START_LON = 20.936280
const START_LAT = 52.290873
const END_LON = 20.948600
const END_LAT = 52.282443

const BASE_PREFERENCES = {
  startLon: START_LON,
  startLat: START_LAT,
  maxGapMeters: 200,
  startProximityMeters: 300,
  roundTrip: false,
}

function isRoundTrip(route: Route): boolean {
  if (route.segments.length === 0) return false
  const first = route.segments[0].geometry.coordinates[0]
  const lastSeg = route.segments[route.segments.length - 1]
  const last = lastSeg.geometry.coordinates[lastSeg.geometry.coordinates.length - 1]
  return Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9
}

function hasOnlyValidSegmentTypes(route: Route): boolean {
  return route.segments.every(s => s.type === 'bike_lane' || s.type === 'gap')
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
      expect(hasOnlyValidSegmentTypes(routes[0]), `route ${routes[0].id} has unknown segment type`).toBe(true)
    })

    it('route has at least one bike_lane segment', () => {
      expect(routes[0].bikeLaneDistanceMeters).toBeGreaterThan(0)
    })
  })
})
