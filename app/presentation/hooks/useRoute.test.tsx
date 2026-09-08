import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import * as buildRouteModule from '~/application/use-cases/build-route'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { Route } from '~/domain/entities/route'
import { useRoute } from './useRoute'

const lane: BikeLane = {
  id: 'lane',
  osmId: '1',
  geometry: {
    type: 'LineString',
    coordinates: [
      [21, 52],
      [21.1, 52.1],
    ],
  },
  laneType: 'cycleway',
  tags: {},
}

const candidate: Route = {
  id: 'candidate',
  segments: [],
  totalDistanceMeters: 3_200,
  bikeLaneDistanceMeters: 3_200,
  bikeLaneCoverage: 1,
  gapCount: 0,
  createdAt: new Date(0),
}

beforeEach(() => {
  vi.useFakeTimers()
  useMapStore.setState({ bikeLanes: [lane], isLoading: false })
  useRoutingStore.setState({
    currentRoute: null,
    isCalculating: false,
    preferences: { ...DEFAULT_PREFERENCES, endLon: 21.1, endLat: 52.1 },
    routeError: null,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useRoute distance-range override', () => {
  it('offers and accepts the unrestricted destination route', async () => {
    vi.spyOn(buildRouteModule, 'buildRoute').mockImplementation(() => {
      throw new buildRouteModule.DestinationRouteOutsideRangeError(
        'The route there is only 3.2 km, below your 10 km minimum.',
        candidate,
      )
    })
    const { result } = renderHook(() => useRoute())

    await act(async () => {
      const suggestion = result.current.suggest()
      await vi.runAllTimersAsync()
      await suggestion
    })

    expect(result.current.canIgnoreDistanceRange).toBe(true)
    expect(useRoutingStore.getState().routeError).toBe(
      'The route there is only 3.2 km, below your 10 km minimum.',
    )

    act(() => result.current.ignoreDistanceRange())
    expect(useRoutingStore.getState().currentRoute).toBe(candidate)
    expect(useRoutingStore.getState().routeError).toBeNull()
  })

  it('discards an override candidate when route preferences change', async () => {
    vi.spyOn(buildRouteModule, 'buildRoute').mockImplementation(() => {
      throw new buildRouteModule.DestinationRouteOutsideRangeError(
        'The route there is only 3.2 km, below your 10 km minimum.',
        candidate,
      )
    })
    const { result } = renderHook(() => useRoute())

    await act(async () => {
      const suggestion = result.current.suggest()
      await vi.runAllTimersAsync()
      await suggestion
    })
    expect(result.current.canIgnoreDistanceRange).toBe(true)

    act(() => useRoutingStore.getState().setPreferences({ maxGapMeters: 300 }))

    expect(result.current.canIgnoreDistanceRange).toBe(false)
  })
})
