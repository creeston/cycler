import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  clearCachedAreas,
  getAreaCacheStats,
  loadAllAreas,
  loadArea,
  pruneStaleAreas,
  saveArea,
} from './area-cache'
import { tryGetDb } from './db'
import type { CachedArea } from '~/domain/entities/area'

vi.mock('./db', () => ({ tryGetDb: vi.fn() }))

const mockedTryGetDb = vi.mocked(tryGetDb)

describe('area cache without a database', () => {
  beforeEach(() => {
    mockedTryGetDb.mockResolvedValue(null)
  })

  it('reports that an area was not saved', async () => {
    await expect(saveArea(area())).resolves.toBe(false)
  })

  it('reads back nothing', async () => {
    await expect(loadArea('warsaw')).resolves.toBeUndefined()
    await expect(loadAllAreas()).resolves.toEqual([])
  })

  it('prunes nothing', async () => {
    await expect(pruneStaleAreas()).resolves.toBeUndefined()
  })

  it('reports and clears an empty cache', async () => {
    await expect(getAreaCacheStats()).resolves.toEqual({ count: 0, newestFetchedAt: null })
    await expect(clearCachedAreas()).resolves.toBeUndefined()
  })
})

describe('area cache when the database rejects', () => {
  beforeEach(() => {
    // Firefox raises this when site data is blocked; Chrome has equivalents.
    const denied = () =>
      Promise.reject(new Error('The user denied permission to access the database.'))
    mockedTryGetDb.mockResolvedValue({
      put: denied,
      get: denied,
      getAll: denied,
      delete: denied,
      count: denied,
      clear: denied,
    } as unknown as Awaited<ReturnType<typeof tryGetDb>>)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports the failed save instead of throwing', async () => {
    await expect(saveArea(area())).resolves.toBe(false)
  })

  it('reads back nothing instead of throwing', async () => {
    await expect(loadArea('warsaw')).resolves.toBeUndefined()
    await expect(loadAllAreas()).resolves.toEqual([])
  })

  it('prunes nothing instead of throwing', async () => {
    await expect(pruneStaleAreas()).resolves.toBeUndefined()
  })

  it('reports and clears an empty cache instead of throwing', async () => {
    await expect(getAreaCacheStats()).resolves.toEqual({ count: 0, newestFetchedAt: null })
    await expect(clearCachedAreas()).resolves.toBeUndefined()
  })
})

function area(): CachedArea {
  return {
    id: 'warsaw',
    bbox: { west: 20.9, south: 52.2, east: 21.0, north: 52.3 },
    bikeLanes: [],
    fetchedAt: new Date(),
  }
}
