import { beforeEach, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import * as cache from './area-cache'
import { tryGetDb } from './db'
import type { CachedArea } from '~/domain/entities/area'

beforeEach(async () => {
  await cache.clearCachedAreas()
})

it('returns fetchedAt as a Date after an IndexedDB round-trip', async () => {
  const fetchedAt = new Date('2026-09-20T08:30:00.000Z')

  await cache.saveArea(area('date-round-trip', fetchedAt))

  const restored = await cache.loadArea('date-round-trip')
  expect(restored?.fetchedAt).toBeInstanceOf(Date)
  expect(restored?.fetchedAt.getTime()).toBe(fetchedAt.getTime())
})

it('revives a fetchedAt string left by an older cache representation', async () => {
  const db = await tryGetDb()
  const persisted = area('serialized-date', new Date('2026-09-20T08:30:00.000Z'))

  await db?.put('areas', {
    ...persisted,
    fetchedAt: persisted.fetchedAt.toISOString(),
  } as unknown as CachedArea)

  const restored = await cache.loadArea('serialized-date')
  expect(restored?.fetchedAt).toBeInstanceOf(Date)
  expect(restored?.fetchedAt.getTime()).toBe(persisted.fetchedAt.getTime())
})

it('deletes expired areas and keeps fresh areas', async () => {
  await cache.saveArea(area('fresh', new Date()))
  await cache.saveArea(area('expired', daysAgo(8)))

  await cache.pruneStaleAreas()

  const remaining = await cache.loadAllAreas()
  expect(remaining.map(area => area.id)).toEqual(['fresh'])
})

function area(id: string, fetchedAt: Date): CachedArea {
  return {
    id,
    bbox: { west: 20.9, south: 52.2, east: 21, north: 52.3 },
    bikeLanes: [],
    fetchedAt,
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}
