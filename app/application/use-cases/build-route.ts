import { cancelRouteRequest, postRouteRequest } from '~/infrastructure/workers/routing-client'
import type { RoutingProgress } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { BarrierData } from '~/domain/entities/barrier'
import type { Route, RoutePreferences } from '~/domain/entities/route'

export { RouteRequestCancelledError } from '~/infrastructure/workers/routing-client'

export interface BuildRouteOptions {
  onProgress?: (progress: RoutingProgress) => void
}

interface CacheEntry {
  routes: Route[]
  /** Next index to serve — cycles so every cached route is shown before repeating. */
  cursor: number
}

const MAX_CACHE_ENTRIES = 20
// Entries also depend on the lane data. Callers must use clearRouteCache() whenever lanes change.
const cache = new Map<string, CacheEntry>()

function formatKilometers(meters: number): string {
  const kilometers = meters / 1_000
  return `${Number.isInteger(kilometers) ? kilometers.toFixed(0) : kilometers.toFixed(1)} km`
}

export class DestinationRouteOutsideRangeError extends Error {
  constructor(
    message: string,
    readonly route: Route,
  ) {
    super(message)
    this.name = 'DestinationRouteOutsideRangeError'
  }
}

function cacheKey(preferences: RoutePreferences, barriersChecked: boolean): string {
  // ~100 m precision on start point — close-enough starts reuse the same batch
  return JSON.stringify({
    barriersChecked,
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

/**
 * Serves the next route of the cached batch for these preferences, computing
 * the batch off the main thread on a miss. A call made while another is
 * still computing abandons it: the earlier promise rejects with
 * RouteRequestCancelledError.
 */
export async function buildRoute(
  lanes: BikeLane[],
  preferences: RoutePreferences,
  barriers?: BarrierData | null,
  options: BuildRouteOptions = {},
): Promise<Route> {
  const key = cacheKey(preferences, barriers != null)
  let entry = cachedEntry(key)

  if (!entry || entry.routes.length === 0) {
    const requestOptions = { barriers, onProgress: options.onProgress }
    const found = await postRouteRequest(lanes, preferences, requestOptions)
    if (found.length === 0) {
      const hasDestination = preferences.endLon !== undefined && preferences.endLat !== undefined
      if (hasDestination) {
        const [unrestrictedRoute] = await postRouteRequest(
          lanes,
          { ...preferences, minDistanceMeters: 0, maxDistanceMeters: Number.MAX_SAFE_INTEGER },
          requestOptions,
        )
        if (unrestrictedRoute) {
          const distance = formatKilometers(unrestrictedRoute.totalDistanceMeters)
          const message =
            unrestrictedRoute.totalDistanceMeters < preferences.minDistanceMeters
              ? `The route there is only ${distance}, below your ${formatKilometers(preferences.minDistanceMeters)} minimum.`
              : `The shortest route there is ${distance}, above your ${formatKilometers(preferences.maxDistanceMeters)} maximum.`
          throw new DestinationRouteOutsideRangeError(message, unrestrictedRoute)
        }
        throw new Error(
          'No connected bike route to that point. Try increasing gap tolerance or loading a larger area.',
        )
      }
      if (preferences.roundTrip && !hasDestination) {
        throw new Error(
          'No loop found here. Try a shorter distance, a larger gap tolerance, or Explore mode.',
        )
      }
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

/** Abandons the route computation in flight, if any. */
export function cancelRouteBuild(): void {
  cancelRouteRequest()
}

/** Call when bike lane data changes so stale graph results are not served. */
export function clearRouteCache(): void {
  cache.clear()
}
