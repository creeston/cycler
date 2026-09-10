import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { fetchArea } from './fetch-area'
import { fetchOverpassGeoJSON } from '~/infrastructure/osm/overpass-client'
import { tryGetDb } from '~/infrastructure/cache/db'

vi.mock('~/infrastructure/osm/overpass-client', () => ({ fetchOverpassGeoJSON: vi.fn() }))
vi.mock('~/infrastructure/cache/db', () => ({ tryGetDb: vi.fn() }))

const mockedFetch = vi.mocked(fetchOverpassGeoJSON)
const mockedTryGetDb = vi.mocked(tryGetDb)

const bbox = { west: 20.9, south: 52.2, east: 21.0, north: 52.3 }

describe('fetchArea', () => {
  beforeEach(() => {
    mockedFetch.mockResolvedValue(oneCycleway())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the fetched lanes when the browser refuses the cache database', async () => {
    mockedTryGetDb.mockResolvedValue(null)

    const { bikeLanes } = await fetchArea(bbox)

    expect(bikeLanes).toHaveLength(1)
    expect(bikeLanes[0].laneType).toBe('cycleway')
  })

  it('returns the fetched lanes when caching them fails', async () => {
    mockedTryGetDb.mockResolvedValue(deniedDb())

    const { bikeLanes } = await fetchArea(bbox, true)

    expect(bikeLanes).toHaveLength(1)
  })

  it('serves a cached area without calling Overpass', async () => {
    mockedTryGetDb.mockResolvedValue({
      get: () => Promise.resolve({ id: 'x', bbox, bikeLanes: [], fetchedAt: new Date() }),
    } as unknown as Awaited<ReturnType<typeof tryGetDb>>)

    const { bikeLanes, barriers } = await fetchArea(bbox)

    expect(bikeLanes).toEqual([])
    expect(barriers, 'an area cached before barrier checking reads as unchecked').toBeNull()
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('keeps the lanes when only the barrier query fails', async () => {
    mockedTryGetDb.mockResolvedValue(null)
    mockedFetch.mockResolvedValueOnce(oneCycleway()).mockRejectedValueOnce(new Error('502'))

    const { bikeLanes, barriers } = await fetchArea(bbox, true)

    expect(bikeLanes).toHaveLength(1)
    expect(barriers).toBeNull()
  })

  it('returns barriers alongside the lanes when both queries succeed', async () => {
    mockedTryGetDb.mockResolvedValue(null)
    mockedFetch.mockResolvedValueOnce(oneCycleway()).mockResolvedValueOnce(oneArterial())

    const { barriers } = await fetchArea(bbox, true)

    expect(barriers?.barriers).toHaveLength(1)
    expect(barriers?.barriers[0].kind).toBe('major_road')
  })
})

function deniedDb(): Awaited<ReturnType<typeof tryGetDb>> {
  const denied = () =>
    Promise.reject(new Error('The user denied permission to access the database.'))
  return { put: denied, get: denied, getAll: denied, delete: denied } as unknown as Awaited<
    ReturnType<typeof tryGetDb>
  >
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
