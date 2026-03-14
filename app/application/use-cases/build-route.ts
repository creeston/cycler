import { findRoutes } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { Route, RoutePreferences } from '~/domain/entities/route'

interface CacheEntry {
  routes: Route[]
  /** Next index to serve — cycles so every cached route is shown before repeating. */
  cursor: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(lon: number, lat: number, maxGap: number): string {
  // ~100 m precision on start point — close-enough starts reuse the same batch
  return `${lon.toFixed(3)},${lat.toFixed(3)},${maxGap}`
}

export function buildRoute(
  lanes: BikeLane[],
  preferences: RoutePreferences,
  startLon: number,
  startLat: number,
): Route {
  const key = cacheKey(startLon, startLat, preferences.maxGapMeters)
  let entry = cache.get(key)

  if (!entry || entry.routes.length === 0) {
    const found = findRoutes(lanes, startLon, startLat, preferences)
    if (found.length === 0) {
      throw new Error(
        'No route found in this area. Try fetching a larger area or moving to a zone with more bike lanes.',
      )
    }
    // Shuffle once so successive picks cycle through routes in random order
    const shuffled = [...found].sort(() => Math.random() - 0.5)
    entry = { routes: shuffled, cursor: 0 }
    cache.set(key, entry)
  }

  const route = entry.routes[entry.cursor]
  entry.cursor = (entry.cursor + 1) % entry.routes.length
  return route
}

/** Call when bike lane data changes so stale graph results are not served. */
export function clearRouteCache(): void {
  cache.clear()
}
