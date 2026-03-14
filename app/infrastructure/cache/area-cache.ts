import { getDb } from './db'
import type { CachedArea } from '~/domain/entities/area'

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function saveArea(area: CachedArea): Promise<void> {
  const db = await getDb()
  await db.put('areas', area)
}

export async function loadArea(id: string): Promise<CachedArea | undefined> {
  const db = await getDb()
  return db.get('areas', id)
}

export async function loadAllAreas(): Promise<CachedArea[]> {
  const db = await getDb()
  return db.getAll('areas')
}

export async function isAreaStale(area: CachedArea): Promise<boolean> {
  return Date.now() - area.fetchedAt.getTime() > STALE_AFTER_MS
}

export async function pruneStaleAreas(): Promise<void> {
  const db = await getDb()
  const all = await db.getAll('areas')
  const stale = all.filter(a => Date.now() - a.fetchedAt.getTime() > STALE_AFTER_MS)
  await Promise.all(stale.map(a => db.delete('areas', a.id)))
}
