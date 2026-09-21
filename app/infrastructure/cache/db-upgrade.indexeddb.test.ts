import { openDB } from 'idb'
import { afterEach, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import type { CachedArea } from '~/domain/entities/area'

afterEach(async () => {
  const { tryGetDb } = await import('./db')
  const db = await tryGetDb()
  db?.close()
  await indexedDB.deleteDatabase('cycle-app')
  vi.resetModules()
})

it('upgrades a version 1 database without destroying cached areas', async () => {
  const legacy = await openDB('cycle-app', 1, {
    upgrade(db) {
      const store = db.createObjectStore('areas', { keyPath: 'id' })
      store.createIndex('by-fetched-at', 'fetchedAt')
    },
  })
  const cachedArea = area()
  await legacy.put('areas', cachedArea)
  legacy.close()

  const { tryGetDb } = await import('./db')
  const upgraded = await tryGetDb()

  expect(upgraded?.objectStoreNames.contains('areas')).toBe(true)
  expect(upgraded?.objectStoreNames.contains('routes')).toBe(true)
  expect(await upgraded?.get('areas', cachedArea.id)).toEqual(cachedArea)
})

function area(): CachedArea {
  return {
    id: 'existing-area',
    bbox: { west: 20.9, south: 52.2, east: 21, north: 52.3 },
    bikeLanes: [],
    fetchedAt: new Date('2026-09-01T07:00:00.000Z'),
  }
}
