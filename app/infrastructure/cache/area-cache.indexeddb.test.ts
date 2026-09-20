import { expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import * as cache from './area-cache'
import type { CachedArea } from '~/domain/entities/area'

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
