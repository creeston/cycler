import { tryGetDb } from './db'
import type { CachedArea } from '~/domain/entities/area'

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Every function here degrades to "no cache" instead of throwing. The database
 * can be missing (see tryGetDb) and a write can still fail afterwards — a full
 * quota, or eviction mid-session — and neither may stop the app from fetching
 * and showing bike lanes.
 */

/** Returns false when the area could not be stored. */
export async function saveArea(area: CachedArea): Promise<boolean> {
  const db = await tryGetDb()
  if (!db) return false

  try {
    await db.put('areas', area)
    return true
  } catch (err) {
    console.warn(`Could not cache area ${area.id}.`, err)
    return false
  }
}

export async function loadArea(id: string): Promise<CachedArea | undefined> {
  const db = await tryGetDb()
  if (!db) return undefined

  try {
    return await db.get('areas', id)
  } catch (err) {
    console.warn(`Could not read cached area ${id}.`, err)
    return undefined
  }
}

export async function loadAllAreas(): Promise<CachedArea[]> {
  const db = await tryGetDb()
  if (!db) return []

  try {
    return await db.getAll('areas')
  } catch (err) {
    console.warn('Could not read the cached areas.', err)
    return []
  }
}

export async function isAreaStale(area: CachedArea): Promise<boolean> {
  return Date.now() - area.fetchedAt.getTime() > STALE_AFTER_MS
}

export async function pruneStaleAreas(): Promise<void> {
  const db = await tryGetDb()
  if (!db) return

  try {
    const all = await db.getAll('areas')
    const stale = all.filter(a => Date.now() - a.fetchedAt.getTime() > STALE_AFTER_MS)
    await Promise.all(stale.map(a => db.delete('areas', a.id)))
  } catch (err) {
    console.warn('Could not prune stale cached areas.', err)
  }
}
