import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAreaCacheStats,
  listAreaBounds,
  loadArea,
  pruneStaleAreas,
} from '~/infrastructure/cache/area-cache'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'
import { getLaneCacheStats, initializeLaneCache, loadCachedLanes } from './load-cached-lanes'

vi.mock('~/infrastructure/cache/area-cache', () => ({
  getAreaCacheStats: vi.fn(),
  isAreaStale: (area: CachedArea) =>
    Date.now() - area.fetchedAt.getTime() >= 7 * 24 * 60 * 60 * 1000,
  listAreaBounds: vi.fn(),
  loadArea: vi.fn(),
  pruneStaleAreas: vi.fn(),
}))

const mockedStats = vi.mocked(getAreaCacheStats)
const mockedList = vi.mocked(listAreaBounds)
const mockedLoad = vi.mocked(loadArea)
const mockedPrune = vi.mocked(pruneStaleAreas)

const WARSAW: BoundingBox = { west: 20.9, south: 52.2, east: 21.1, north: 52.3 }
const BERLIN: BoundingBox = { west: 13.3, south: 52.4, east: 13.5, north: 52.6 }

beforeEach(() => {
  vi.clearAllMocks()
  mockedStats.mockResolvedValue({ count: 1, newestFetchedAt: new Date(0) })
  mockedList.mockResolvedValue([])
})

describe('initializeLaneCache', () => {
  it('prunes stale data before reporting cache statistics', async () => {
    await expect(initializeLaneCache()).resolves.toEqual({
      count: 1,
      newestFetchedAt: new Date(0),
    })

    expect(mockedPrune).toHaveBeenCalledOnce()
    expect(mockedPrune.mock.invocationCallOrder[0]).toBeLessThan(
      mockedStats.mock.invocationCallOrder[0],
    )
  })
})

describe('loadCachedLanes', () => {
  it('loads only fresh, nearby areas that are not already held', async () => {
    mockedList.mockResolvedValue([
      { id: 'near', bbox: WARSAW },
      { id: 'held', bbox: WARSAW },
      { id: 'far', bbox: BERLIN },
    ])
    mockedLoad.mockImplementation(async id =>
      id === 'near' ? area('near', WARSAW, new Date()) : undefined,
    )

    const loaded = await loadCachedLanes(WARSAW, new Set(['held']))

    expect(mockedLoad).toHaveBeenCalledOnce()
    expect(mockedLoad).toHaveBeenCalledWith('near')
    expect(loaded.map(area => area.id)).toEqual(['near'])
    expect(loaded[0].barriers).toBeNull()
  })

  it('does not return an area that became stale before it was loaded', async () => {
    mockedList.mockResolvedValue([{ id: 'stale', bbox: WARSAW }])
    mockedLoad.mockResolvedValue(area('stale', WARSAW, daysAgo(8)))

    await expect(loadCachedLanes(WARSAW, new Set())).resolves.toEqual([])
  })
})

it('reports cache statistics without pruning again', async () => {
  await expect(getLaneCacheStats()).resolves.toEqual({
    count: 1,
    newestFetchedAt: new Date(0),
  })
  expect(mockedPrune).not.toHaveBeenCalled()
})

function area(id: string, bbox: BoundingBox, fetchedAt: Date): CachedArea {
  return { id, bbox, bikeLanes: [], fetchedAt }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}
