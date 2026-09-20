import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { fetchArea } from './fetch-area'
import { fetchOverpassGeoJSON } from '~/infrastructure/osm/overpass-client'
import { loadAllAreas, loadArea, saveArea } from '~/infrastructure/cache/area-cache'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'

vi.mock('~/infrastructure/osm/overpass-client', () => ({ fetchOverpassGeoJSON: vi.fn() }))
vi.mock('~/infrastructure/cache/area-cache', () => ({
  isAreaStale: (area: CachedArea) =>
    Date.now() - new Date(area.fetchedAt).getTime() >= 7 * 24 * 60 * 60 * 1000,
  loadAllAreas: vi.fn(),
  loadArea: vi.fn(),
  saveArea: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchOverpassGeoJSON)
const mockedLoadAll = vi.mocked(loadAllAreas)
const mockedLoad = vi.mocked(loadArea)
const mockedSave = vi.mocked(saveArea)

const bbox: BoundingBox = { west: 20.9, south: 52.2, east: 21.0, north: 52.3 }

describe('fetchArea', () => {
  beforeEach(() => {
    mockedFetch.mockResolvedValue(oneCycleway())
    mockedLoad.mockResolvedValue(undefined)
    mockedLoadAll.mockResolvedValue([])
    mockedSave.mockResolvedValue(true)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves a fresh cached area without calling Overpass', async () => {
    mockedLoad.mockResolvedValue(area('exact', bbox, new Date()))

    const result = await fetchArea(bbox)

    expect(result.source).toBe('cache')
    expect(result.area.bikeLanes).toEqual([])
    expect(
      result.area.barriers,
      'an area cached before barrier checking reads as unchecked',
    ).toBeNull()
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('re-fetches and overwrites a stale cached area', async () => {
    mockedLoad.mockResolvedValue(area('stale', bbox, daysAgo(8)))

    const result = await fetchArea(bbox)

    expect(result.source).toBe('network')
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(mockedSave).toHaveBeenCalledOnce()
    expect(mockedSave.mock.calls[0][0].bikeLanes).toHaveLength(1)
  })

  it('fetches and saves an area on a cache miss', async () => {
    const result = await fetchArea(bbox)

    expect(result.source).toBe('network')
    expect(result.area.bikeLanes).toHaveLength(1)
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(mockedSave).toHaveBeenCalledOnce()
  })

  it('forces a network refresh even when a fresh area is cached', async () => {
    mockedLoad.mockResolvedValue(area('exact', bbox, new Date()))

    const result = await fetchArea(bbox, true)

    expect(result.source).toBe('network')
    expect(mockedLoad).not.toHaveBeenCalled()
    expect(mockedLoadAll).not.toHaveBeenCalled()
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(mockedSave).toHaveBeenCalledOnce()
  })

  it('reuses the smallest fresh cached area that contains the requested box', async () => {
    const large: BoundingBox = { west: 20.7, south: 52.0, east: 21.2, north: 52.5 }
    const close: BoundingBox = { west: 20.8, south: 52.1, east: 21.1, north: 52.4 }
    mockedLoadAll.mockResolvedValue([
      area('large', large, new Date()),
      area('close', close, new Date()),
    ])

    const result = await fetchArea(bbox)

    expect(result.source).toBe('cache')
    expect(result.area.id).toBe('close')
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('ignores a stale containing area', async () => {
    const containing: BoundingBox = { west: 20.8, south: 52.1, east: 21.1, north: 52.4 }
    mockedLoadAll.mockResolvedValue([area('stale-containing', containing, daysAgo(8))])

    const result = await fetchArea(bbox)

    expect(result.source).toBe('network')
    expect(mockedFetch).toHaveBeenCalledTimes(2)
  })

  it('keeps the lanes when only the barrier query fails', async () => {
    mockedFetch.mockResolvedValueOnce(oneCycleway()).mockRejectedValueOnce(new Error('502'))

    const { area: fetched } = await fetchArea(bbox, true)

    expect(fetched.bikeLanes).toHaveLength(1)
    expect(fetched.barriers).toBeNull()
  })

  it('returns barriers alongside the lanes when both queries succeed', async () => {
    mockedFetch.mockResolvedValueOnce(oneCycleway()).mockResolvedValueOnce(oneArterial())

    const { area: fetched } = await fetchArea(bbox, true)

    expect(fetched.barriers?.barriers).toHaveLength(1)
    expect(fetched.barriers?.barriers[0].kind).toBe('major_road')
  })

  it('threads cancellation through both Overpass queries', async () => {
    const controller = new AbortController()
    mockedFetch.mockResolvedValueOnce(oneCycleway()).mockResolvedValueOnce(oneArterial())

    await fetchArea(bbox, true, { signal: controller.signal })

    expect(mockedFetch).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(mockedFetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('does not swallow cancellation of the barrier request', async () => {
    mockedFetch
      .mockResolvedValueOnce(oneCycleway())
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))

    await expect(fetchArea(bbox, true)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockedSave).not.toHaveBeenCalled()
  })
})

function area(id: string, bounds: BoundingBox, fetchedAt: Date): CachedArea {
  return { id, bbox: bounds, bikeLanes: [], fetchedAt }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function oneArterial(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { '@id': 'way/2', highway: 'primary' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [20.955, 52.2],
            [20.955, 52.3],
          ],
        },
      },
    ],
  }
}

function oneCycleway(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: 'way/1', highway: 'cycleway' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [20.95, 52.25],
            [20.96, 52.25],
          ],
        },
      },
    ],
  }
}
