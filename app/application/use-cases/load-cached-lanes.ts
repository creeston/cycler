import {
  getAreaCacheStats,
  isAreaStale,
  listAreaBounds,
  loadArea,
  pruneStaleAreas,
} from '~/infrastructure/cache/area-cache'
import { bboxesIntersect } from '~/domain/entities/area'
import type { AreaCacheStats } from '~/infrastructure/cache/area-cache'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'

/** Deletes expired entries before cached data is restored on app startup. */
export async function initializeLaneCache(): Promise<AreaCacheStats> {
  await pruneStaleAreas()
  return getAreaCacheStats()
}

/** Returns cache metadata after a fetch or clear without pruning a second time. */
export function getLaneCacheStats(): Promise<AreaCacheStats> {
  return getAreaCacheStats()
}

/**
 * Loads only fresh cached areas near the current view. IDs already held in
 * memory are skipped so panning does not deserialize the same lane data again.
 */
export async function loadCachedLanes(
  view: BoundingBox,
  heldIds: ReadonlySet<string>,
): Promise<CachedArea[]> {
  const bounds = await listAreaBounds()
  const wanted = bounds.filter(entry => bboxesIntersect(entry.bbox, view) && !heldIds.has(entry.id))
  const loaded = await Promise.all(wanted.map(entry => loadArea(entry.id)))

  return loaded
    .filter((area): area is CachedArea => area !== undefined && !isAreaStale(area))
    .map(area => ({ ...area, barriers: area.barriers ?? null }))
}
