import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapStore } from '~/application/stores/map-store'
import {
  getLaneCacheStats,
  initializeLaneCache,
  loadCachedLanes,
} from '~/application/use-cases/load-cached-lanes'
import { fetchArea } from '~/application/use-cases/fetch-area'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'
import type { BikeLane } from '~/domain/entities/bike-lane'
import { useBikeLanes } from './useBikeLanes'

vi.mock('~/application/use-cases/load-cached-lanes', () => ({
  getLaneCacheStats: vi.fn(),
  initializeLaneCache: vi.fn(),
  loadCachedLanes: vi.fn(),
}))
vi.mock('~/application/use-cases/clear-cached-data', () => ({ clearCachedData: vi.fn() }))
vi.mock('~/application/use-cases/fetch-area', () => ({ fetchArea: vi.fn() }))

const mockedInitialize = vi.mocked(initializeLaneCache)
const mockedLoad = vi.mocked(loadCachedLanes)
const mockedFetch = vi.mocked(fetchArea)
const mockedStats = vi.mocked(getLaneCacheStats)

const WARSAW: BoundingBox = { west: 20.9, south: 52.2, east: 21.1, north: 52.3 }
const BERLIN: BoundingBox = { west: 13.3, south: 52.4, east: 13.5, north: 52.6 }

function Probe() {
  useBikeLanes()
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedInitialize.mockResolvedValue({ count: 0, newestFetchedAt: null })
  mockedStats.mockResolvedValue({ count: 0, newestFetchedAt: null })
  mockedLoad.mockResolvedValue([])
  useMapStore.setState({
    areas: [],
    bikeLanes: [],
    barriers: null,
    bbox: null,
    lastFetchedAt: null,
  })
})

afterEach(cleanup)

describe('useBikeLanes area loading', () => {
  it('initializes the cache before restoring nearby data', async () => {
    useMapStore.setState({ bbox: WARSAW })

    await act(async () => {
      render(<Probe />)
    })

    expect(mockedInitialize).toHaveBeenCalledOnce()
    expect(mockedInitialize.mock.invocationCallOrder[0]).toBeLessThan(
      mockedLoad.mock.invocationCallOrder[0],
    )
  })

  it('restores cached areas returned by the application use case', async () => {
    mockedLoad.mockResolvedValue([area('warsaw', WARSAW)])
    useMapStore.setState({ bbox: WARSAW })

    await act(async () => {
      render(<Probe />)
    })

    expect(useMapStore.getState().areas.map(a => a.id)).toEqual(['warsaw'])
  })

  it('drops an area once the map has moved away from it', async () => {
    useMapStore.setState({ bbox: WARSAW })
    useMapStore.getState().mergeAreas([area('warsaw', WARSAW)])

    await act(async () => {
      render(<Probe />)
    })
    expect(useMapStore.getState().areas.map(a => a.id)).toEqual(['warsaw'])

    await act(async () => {
      useMapStore.setState({ bbox: BERLIN })
    })

    expect(useMapStore.getState().areas).toEqual([])
    expect(useMapStore.getState().bikeLanes).toEqual([])
  })

  it('tells the cache use case which areas it already holds', async () => {
    useMapStore.setState({ bbox: WARSAW })
    useMapStore.getState().mergeAreas([area('warsaw', WARSAW)])

    await act(async () => {
      render(<Probe />)
    })

    const heldIds = mockedLoad.mock.calls[0][1]
    expect(heldIds.has('warsaw')).toBe(true)
  })

  it('uses the cache by default and records cache provenance', async () => {
    mockedFetch.mockResolvedValue({ area: area('cached', WARSAW), source: 'cache' })
    useMapStore.setState({ bbox: WARSAW })

    let hook: ReturnType<typeof useBikeLanes> | undefined
    function Capture() {
      hook = useBikeLanes()
      return null
    }
    await act(async () => {
      render(<Capture />)
    })
    await act(async () => {
      await hook!.fetch()
    })

    expect(mockedFetch).toHaveBeenCalledWith(WARSAW, false)
    expect(hook!.lastLoadSource).toBe('cache')
    expect(useMapStore.getState().areas.map(a => a.id)).toEqual(['cached'])
  })

  it('forces a network request for an explicit refresh', async () => {
    mockedFetch.mockResolvedValue({ area: area('refreshed', WARSAW), source: 'network' })
    useMapStore.setState({ bbox: WARSAW })

    let hook: ReturnType<typeof useBikeLanes> | undefined
    function Capture() {
      hook = useBikeLanes()
      return null
    }
    await act(async () => {
      render(<Capture />)
    })
    await act(async () => {
      await hook!.fetch(true)
    })

    expect(mockedFetch).toHaveBeenCalledWith(WARSAW, true)
    expect(hook!.lastLoadSource).toBe('network')
  })
})

function area(id: string, bbox: BoundingBox): CachedArea {
  return { id, bbox, bikeLanes: [lane(id, bbox)], barriers: null, fetchedAt: new Date() }
}

function lane(id: string, bbox: BoundingBox): BikeLane {
  return {
    id,
    osmId: id,
    geometry: {
      type: 'LineString',
      coordinates: [
        [bbox.west, bbox.south],
        [bbox.east, bbox.north],
      ],
    },
    laneType: 'cycleway',
    tags: {},
  }
}
