import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import * as buildRouteModule from '~/application/use-cases/build-route'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import type { BuiltRoute } from '~/application/use-cases/build-route'
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
  gapDistanceMeters: 0,
  barrierCrossingCount: 0,
  barriersChecked: true,
  requestedGapMeters: 200,
  appliedGapMeters: 200,
  createdAt: new Date(0),
}

function built(route: Route, startSource: BuiltRoute['startSource'] = 'device'): BuiltRoute {
  return { route, startSource }
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
    vi.spyOn(buildRouteModule, 'buildRoute').mockRejectedValue(
      new buildRouteModule.DestinationRouteOutsideRangeError(
        'The route there is only 3.2 km, below your 10 km minimum.',
        candidate,
        'map-centre',
      ),
    )
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
    expect(useRoutingStore.getState().routeStartSource).toBe('map-centre')
    expect(useRoutingStore.getState().routeError).toBeNull()
  })

  it('discards an override candidate when route preferences change', async () => {
    vi.spyOn(buildRouteModule, 'buildRoute').mockRejectedValue(
      new buildRouteModule.DestinationRouteOutsideRangeError(
        'The route there is only 3.2 km, below your 10 km minimum.',
        candidate,
        'picked',
      ),
    )
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

describe('useRoute start point', () => {
  it('hands the map centre to buildRoute and records which start was used', async () => {
    useMapStore.setState({ viewport: { longitude: 21.03, latitude: 52.24, zoom: 13 } })
    const buildRoute = vi
      .spyOn(buildRouteModule, 'buildRoute')
      .mockResolvedValue(built(candidate, 'map-centre'))
    const { result } = renderHook(() => useRoute())

    await act(async () => {
      const suggestion = result.current.suggest()
      await vi.runAllTimersAsync()
      await suggestion
    })

    expect(buildRoute).toHaveBeenCalledWith(
      [lane],
      useRoutingStore.getState().preferences,
      null,
      expect.objectContaining({ mapCentre: [21.03, 52.24] }),
    )
    expect(useRoutingStore.getState().routeStartSource).toBe('map-centre')
    expect(result.current.routeStartSource).toBe('map-centre')
  })

  it('forgets the start source when the route is cleared', async () => {
    vi.spyOn(buildRouteModule, 'buildRoute').mockResolvedValue(built(candidate, 'picked'))
    const { result } = renderHook(() => useRoute())

    await act(async () => {
      const suggestion = result.current.suggest()
      await vi.runAllTimersAsync()
      await suggestion
    })
    act(() => result.current.clear())

    expect(useRoutingStore.getState().routeStartSource).toBeNull()
  })
})

describe('useRoute computation lifecycle', () => {
  it('shows the progress the computation reports and clears it when done', async () => {
    vi.spyOn(buildRouteModule, 'buildRoute').mockImplementation(async (_l, _p, _b, options) => {
      options?.onProgress?.({ completed: 1, total: 4 })
      expect(useRoutingStore.getState().calculationProgress).toBe(0.25)
      return built(candidate)
    })
    const { result } = renderHook(() => useRoute())

    await act(async () => {
      const suggestion = result.current.suggest()
      await vi.runAllTimersAsync()
      await suggestion
    })

    expect(useRoutingStore.getState().currentRoute).toBe(candidate)
    expect(useRoutingStore.getState().isCalculating).toBe(false)
    expect(useRoutingStore.getState().calculationProgress).toBeNull()
  })

  it('lets a second tap abandon the first and keeps only the second result', async () => {
    const first = deferred<BuiltRoute>()
    const second = deferred<BuiltRoute>()
    vi.spyOn(buildRouteModule, 'buildRoute')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useRoute())

    await act(async () => {
      const firstTap = result.current.suggest()
      await vi.runAllTimersAsync()
      const secondTap = result.current.suggest()
      await vi.runAllTimersAsync()
      // buildRoute rejects the abandoned request once the newer one is posted
      first.reject(new buildRouteModule.RouteRequestCancelledError())
      await firstTap
      expect(useRoutingStore.getState().isCalculating).toBe(true)
      second.resolve(built({ ...candidate, id: 'second' }))
      await secondTap
    })

    expect(useRoutingStore.getState().currentRoute?.id).toBe('second')
    expect(useRoutingStore.getState().routeError).toBeNull()
    expect(useRoutingStore.getState().isCalculating).toBe(false)
  })

  it('ignores a stale result that settles after a newer tap', async () => {
    const first = deferred<BuiltRoute>()
    const second = deferred<BuiltRoute>()
    vi.spyOn(buildRouteModule, 'buildRoute')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useRoute())

    await act(async () => {
      const firstTap = result.current.suggest()
      await vi.runAllTimersAsync()
      const secondTap = result.current.suggest()
      await vi.runAllTimersAsync()
      second.resolve(built({ ...candidate, id: 'second' }))
      await secondTap
      first.resolve(built({ ...candidate, id: 'first' }))
      await firstTap
    })

    expect(useRoutingStore.getState().currentRoute?.id).toBe('second')
  })

  it('cancel abandons the computation and resets the calculating state', async () => {
    const pending = deferred<BuiltRoute>()
    vi.spyOn(buildRouteModule, 'buildRoute').mockReturnValue(pending.promise)
    const cancelRouteBuild = vi
      .spyOn(buildRouteModule, 'cancelRouteBuild')
      .mockImplementation(() => pending.reject(new buildRouteModule.RouteRequestCancelledError()))
    const { result } = renderHook(() => useRoute())

    await act(async () => {
      const tap = result.current.suggest()
      await vi.runAllTimersAsync()
      expect(useRoutingStore.getState().isCalculating).toBe(true)
      result.current.cancel()
      await tap
    })

    expect(cancelRouteBuild).toHaveBeenCalledOnce()
    expect(useRoutingStore.getState().isCalculating).toBe(false)
    expect(useRoutingStore.getState().currentRoute).toBeNull()
    expect(useRoutingStore.getState().routeError).toBeNull()
  })
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
