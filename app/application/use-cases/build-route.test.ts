import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { Route, RoutePreferences } from '~/domain/entities/route'
import { findRoutes } from '~/domain/routing/route-finder'
import { buildRoute, clearRouteCache } from './build-route'

vi.mock('~/domain/routing/route-finder', () => ({
  findRoutes: vi.fn(),
}))

const lanes: BikeLane[] = []

const preferences: Required<RoutePreferences> = {
  startLon: 21.0001,
  startLat: 52.0001,
  endLon: 21.1,
  endLat: 52.1,
  maxGapMeters: 200,
  startProximityMeters: 200,
  minDistanceMeters: 5_000,
  maxDistanceMeters: 10_000,
  roundTrip: false,
}

const changedPreferenceValues = {
  startLon: 21.0011,
  startLat: 52.0011,
  endLon: 21.2,
  endLat: 52.2,
  maxGapMeters: 300,
  startProximityMeters: 300,
  minDistanceMeters: 6_000,
  maxDistanceMeters: 11_000,
  roundTrip: true,
} satisfies Required<RoutePreferences>

function route(id: string): Route {
  return {
    id,
    segments: [],
    totalDistanceMeters: 0,
    bikeLaneDistanceMeters: 0,
    bikeLaneCoverage: 0,
    gapCount: 0,
    createdAt: new Date(0),
  }
}

const findRoutesMock = vi.mocked(findRoutes)

beforeEach(() => {
  clearRouteCache()
  findRoutesMock.mockReset()
  findRoutesMock.mockReturnValue([route('first'), route('second')])
})

describe('buildRoute cache', () => {
  it('reuses a batch and serves its next route when preferences are unchanged', () => {
    const first = buildRoute(lanes, preferences)
    const second = buildRoute(lanes, preferences)

    expect(findRoutesMock).toHaveBeenCalledOnce()
    expect(new Set([first.id, second.id])).toEqual(new Set(['first', 'second']))
  })

  it.each(Object.entries(changedPreferenceValues))(
    'does not reuse a batch when %s changes',
    (field, value) => {
      buildRoute(lanes, preferences)
      buildRoute(lanes, { ...preferences, [field]: value })

      expect(findRoutesMock).toHaveBeenCalledTimes(2)
    },
  )

  it('evicts the least recently used batch after 20 entries', () => {
    for (let index = 0; index <= 20; index++) {
      buildRoute(lanes, { ...preferences, minDistanceMeters: index })
    }

    expect(findRoutesMock).toHaveBeenCalledTimes(21)

    buildRoute(lanes, { ...preferences, minDistanceMeters: 20 })
    expect(findRoutesMock).toHaveBeenCalledTimes(21)

    buildRoute(lanes, { ...preferences, minDistanceMeters: 0 })
    expect(findRoutesMock).toHaveBeenCalledTimes(22)
  })
})
