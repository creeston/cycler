import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { FeatureCollection } from 'geojson'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { geojsonToBarriers } from '~/domain/mappers/osm-to-barriers'
import { findRoutes } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { BarrierData } from '~/domain/entities/barrier'
import type { Route, RoutePreferences } from '~/domain/entities/route'
import { handleRouteRequest } from './routing-protocol'
import type { RouteReply } from './routing-protocol'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCENARIOS = join(__dirname, '../../domain/routing/scenarios')

const preferences: RoutePreferences = {
  startLon: 20.93628,
  startLat: 52.290873,
  maxGapMeters: 200,
  startProximityMeters: 300,
  minDistanceMeters: 2_000,
  maxDistanceMeters: 10_000,
  roundTrip: true,
}

let lanes: BikeLane[]
let barriers: BarrierData

beforeAll(() => {
  lanes = geojsonToBikeLanes(readGeojson('overpass-data.geojson'))
  barriers = geojsonToBarriers(readGeojson('overpass-barriers.geojson'))
})

describe('handleRouteRequest', () => {
  it('answers with the same routes the direct call returns', () => {
    const replies: RouteReply[] = []
    handleRouteRequest({ id: 1, lanes, preferences, barriers }, reply => replies.push(reply))
    const direct = findRoutes(lanes, preferences, { barriers })

    const last = replies[replies.length - 1]
    expect(last.type).toBe('routes')
    if (last.type !== 'routes') return
    expect(last.routes.length).toBeGreaterThan(0)
    expect(last.routes.map(comparable)).toEqual(direct.map(comparable))
    expect(last.routes.every(route => route.barriersChecked)).toBe(true)
  })

  it('reports progress before the routes, all for the request id', () => {
    const replies: RouteReply[] = []
    handleRouteRequest({ id: 3, lanes, preferences, barriers: null }, reply => replies.push(reply))

    expect(replies.every(reply => reply.id === 3)).toBe(true)
    expect(replies.slice(0, -1).every(reply => reply.type === 'progress')).toBe(true)
    expect(replies.length).toBeGreaterThan(1)
  })

  it('answers with an error message when the search throws', () => {
    const replies: RouteReply[] = []
    const broken = [
      { ...lanes[0], geometry: { type: 'LineString', coordinates: [] } },
    ] as BikeLane[]
    handleRouteRequest({ id: 2, lanes: broken, preferences, barriers: null }, reply =>
      replies.push(reply),
    )

    expect(replies[replies.length - 1]).toMatchObject({ type: 'error', id: 2 })
  })
})

function readGeojson(name: string): FeatureCollection {
  return JSON.parse(readFileSync(join(SCENARIOS, name), 'utf-8')) as FeatureCollection
}

/** A route without the fields that differ between two identical searches. */
function comparable(route: Route): Partial<Route> {
  return { ...route, id: undefined, createdAt: undefined }
}
