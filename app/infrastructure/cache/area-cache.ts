import { tryGetDb } from './db'
import { bboxFromAreaId } from '~/domain/entities/area'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface AreaCacheStats {
  count: number
  newestFetchedAt: Date | null
}

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

/**
 * The id and box of every cached area, read from the keys alone. Nothing is
 * deserialised, so this stays cheap however much lane data is stored — which is
 * what lets the app decide which areas are worth loading before loading any.
 */
export async function listAreaBounds(): Promise<Array<{ id: string; bbox: BoundingBox }>> {
  const db = await tryGetDb()
  if (!db) return []

  try {
    const bounds: Array<{ id: string; bbox: BoundingBox }> = []
    for (const id of await db.getAllKeys('areas')) {
      const bbox = bboxFromAreaId(id)
      if (bbox) bounds.push({ id, bbox })
    }
    return bounds
  } catch (err) {
    console.warn('Could not list the cached areas.', err)
    return []
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

/** Returns cache metadata without deserialising every area's lane data. */
export async function getAreaCacheStats(): Promise<AreaCacheStats> {
  const db = await tryGetDb()
  if (!db) return { count: 0, newestFetchedAt: null }

  try {
    const count = await db.count('areas')
    if (count === 0) return { count, newestFetchedAt: null }

    const cursor = await db
      .transaction('areas', 'readonly')
      .store.index('by-fetched-at')
      .openKeyCursor(null, 'prev')
    return { count, newestFetchedAt: cursor ? new Date(cursor.key) : null }
  } catch (err) {
    console.warn('Could not inspect the cached areas.', err)
    return { count: 0, newestFetchedAt: null }
  }
}

export async function clearCachedAreas(): Promise<void> {
  const db = await tryGetDb()
  if (!db) return

  try {
    await db.clear('areas')
  } catch (err) {
    console.warn('Could not clear the cached areas.', err)
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
