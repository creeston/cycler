import { findRoutes } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { Route, RoutePreferences } from '~/domain/entities/route'

interface CacheEntry {
  routes: Route[]
  /** Next index to serve — cycles so every cached route is shown before repeating. */
  cursor: number
}

const MAX_CACHE_ENTRIES = 20
// Entries also depend on the lane data. Callers must use clearRouteCache() whenever lanes change.
const cache = new Map<string, CacheEntry>()

function cacheKey(preferences: RoutePreferences): string {
  // ~100 m precision on start point — close-enough starts reuse the same batch
  return JSON.stringify({
    lon: preferences.startLon.toFixed(3),
    lat: preferences.startLat.toFixed(3),
    endLon: preferences.endLon,
    endLat: preferences.endLat,
    maxGap: preferences.maxGapMeters,
    proximity: preferences.startProximityMeters,
    minDistance: preferences.minDistanceMeters,
    maxDistance: preferences.maxDistanceMeters,
    roundTrip: preferences.roundTrip,
  })
}

function cachedEntry(key: string): CacheEntry | undefined {
  const entry = cache.get(key)
  if (entry) {
    // Map preserves insertion order, so reinserting promotes this entry for LRU eviction.
    cache.delete(key)
    cache.set(key, entry)
  }
  return entry
}

function cacheEntry(key: string, entry: CacheEntry): void {
  cache.set(key, entry)
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
}

export function buildRoute(lanes: BikeLane[], preferences: RoutePreferences): Route {
  const key = cacheKey(preferences)
  let entry = cachedEntry(key)

  if (!entry || entry.routes.length === 0) {
    const found = findRoutes(lanes, preferences)
    if (found.length === 0) {
      throw new Error(
        'No route found in this area. Try fetching a larger area or moving to a zone with more bike lanes.',
      )
    }
    // Shuffle once so successive picks cycle through routes in random order
    const shuffled = [...found].sort(() => Math.random() - 0.5)
    entry = { routes: shuffled, cursor: 0 }
    cacheEntry(key, entry)
  }

  const route = entry.routes[entry.cursor]
  entry.cursor = (entry.cursor + 1) % entry.routes.length
  return route
}

/** Call when bike lane data changes so stale graph results are not served. */
export function clearRouteCache(): void {
  cache.clear()
}
