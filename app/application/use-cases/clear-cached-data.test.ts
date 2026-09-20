import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import { clearRouteCache } from './build-route'
import { tryGetDb } from '~/infrastructure/cache/db'
import type { CachedArea } from '~/domain/entities/area'
import type { Route } from '~/domain/entities/route'
import { clearCachedData } from './clear-cached-data'

vi.mock('~/infrastructure/cache/db', () => ({ tryGetDb: vi.fn() }))
vi.mock('./build-route', () => ({ clearRouteCache: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(tryGetDb).mockResolvedValue(null)
  useMapStore.setState({ areas: [], bikeLanes: [], barriers: null, lastFetchedAt: null })
  useRoutingStore.setState({ currentRoute: null })
})

describe('clearCachedData', () => {
  it('clears derived state even when IndexedDB is unavailable', async () => {
    useMapStore.getState().mergeAreas([area()])
    useRoutingStore.setState({ currentRoute: route() })

    await expect(clearCachedData()).resolves.toBeUndefined()

    expect(useMapStore.getState().areas).toEqual([])
    expect(useMapStore.getState().bikeLanes).toEqual([])
    expect(useMapStore.getState().barriers).toBeNull()
    expect(useRoutingStore.getState().currentRoute).toBeNull()
    expect(clearRouteCache).toHaveBeenCalledOnce()
  })
})

function area(): CachedArea {
  return {
    id: 'area',
    bbox: { west: 20, south: 52, east: 21, north: 53 },
    bikeLanes: [
      {
        id: 'lane',
        osmId: '1',
        geometry: {
          type: 'LineString',
          coordinates: [
            [20, 52],
            [21, 53],
          ],
        },
        laneType: 'cycleway',
        tags: {},
      },
    ],
    barriers: null,
    fetchedAt: new Date(),
  }
}

function route(): Route {
  return {
    id: 'route',
    segments: [],
    totalDistanceMeters: 0,
    bikeLaneDistanceMeters: 0,
    bikeLaneCoverage: 0,
    gapCount: 0,
    gapDistanceMeters: 0,
    barrierCrossingCount: 0,
    barriersChecked: true,
    requestedGapMeters: 200,
    appliedGapMeters: 200,
    createdAt: new Date(),
  }
}
