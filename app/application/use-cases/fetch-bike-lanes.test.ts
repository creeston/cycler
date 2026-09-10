import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { fetchBikeLanes } from './fetch-bike-lanes'
import { fetchOverpassGeoJSON } from '~/infrastructure/osm/overpass-client'
import { tryGetDb } from '~/infrastructure/cache/db'

vi.mock('~/infrastructure/osm/overpass-client', () => ({ fetchOverpassGeoJSON: vi.fn() }))
vi.mock('~/infrastructure/cache/db', () => ({ tryGetDb: vi.fn() }))

const mockedFetch = vi.mocked(fetchOverpassGeoJSON)
const mockedTryGetDb = vi.mocked(tryGetDb)

const bbox = { west: 20.9, south: 52.2, east: 21.0, north: 52.3 }

describe('fetchBikeLanes', () => {
  beforeEach(() => {
    mockedFetch.mockResolvedValue(oneCycleway())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the fetched lanes when the browser refuses the cache database', async () => {
    mockedTryGetDb.mockResolvedValue(null)

    const lanes = await fetchBikeLanes(bbox)

    expect(lanes).toHaveLength(1)
    expect(lanes[0].laneType).toBe('cycleway')
  })

  it('returns the fetched lanes when caching them fails', async () => {
    mockedTryGetDb.mockResolvedValue(deniedDb())

    await expect(fetchBikeLanes(bbox, true)).resolves.toHaveLength(1)
  })

  it('serves a cached area without calling Overpass', async () => {
    mockedTryGetDb.mockResolvedValue({
      get: () => Promise.resolve({ id: 'x', bbox, bikeLanes: [], fetchedAt: new Date() }),
    } as unknown as Awaited<ReturnType<typeof tryGetDb>>)

    await expect(fetchBikeLanes(bbox)).resolves.toEqual([])
    expect(mockedFetch).not.toHaveBeenCalled()
  })
})

function deniedDb(): Awaited<ReturnType<typeof tryGetDb>> {
  const denied = () =>
    Promise.reject(new Error('The user denied permission to access the database.'))
  return { put: denied, get: denied, getAll: denied, delete: denied } as unknown as Awaited<
    ReturnType<typeof tryGetDb>
  >
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
