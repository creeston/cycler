import { cancelRouteRequest, postRouteRequest } from '~/infrastructure/workers/routing-client'
import { locateDevice } from '~/infrastructure/geolocation/device-position'
import type { RoutingProgress } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { BarrierData } from '~/domain/entities/barrier'
import type { ResolvedRoutePreferences, Route, RoutePreferences } from '~/domain/entities/route'

export { RouteRequestCancelledError } from '~/infrastructure/workers/routing-client'

/** Where the start point came from, so the sheet can say which one was used. */
export type StartSource = 'picked' | 'device' | 'map-centre'

export interface BuildRouteOptions {
  onProgress?: (progress: RoutingProgress) => void
  /**
   * Asks for the device position; consulted only when the preferences hold no
   * start point. Defaults to the browser's geolocation.
   */
  locate?: () => Promise<[number, number] | null>
  /** Stands in when there is no picked start and no device position. */
  mapCentre?: [number, number]
}

export interface BuiltRoute {
  route: Route
  startSource: StartSource
}

interface ResolvedStart {
  preferences: ResolvedRoutePreferences
  startSource: StartSource
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
    readonly startSource: StartSource,
  ) {
    super(message)
    this.name = 'DestinationRouteOutsideRangeError'
  }
}

/**
 * A picked start wins. Otherwise the device is asked, and the map centre
 * stands in when it does not answer — a refused permission is a fallback,
 * not an error.
 */
async function resolveStart(
  preferences: RoutePreferences,
  options: BuildRouteOptions,
): Promise<ResolvedStart> {
  const { startLon, startLat } = preferences
  if (startLon !== undefined && startLat !== undefined) {
    return { preferences: { ...preferences, startLon, startLat }, startSource: 'picked' }
  }
  const locate = options.locate ?? locateDevice
  const devicePosition = await locate()
  if (devicePosition) {
    const [lon, lat] = devicePosition
    return { preferences: { ...preferences, startLon: lon, startLat: lat }, startSource: 'device' }
  }
  if (options.mapCentre) {
    const [lon, lat] = options.mapCentre
    return {
      preferences: { ...preferences, startLon: lon, startLat: lat },
      startSource: 'map-centre',
    }
  }
  throw new Error('No start point: pick one on the map or allow location access.')
}

function cacheKey(preferences: ResolvedRoutePreferences, barriersChecked: boolean): string {
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
 * the batch off the main thread on a miss. The start point is resolved first
 * (see resolveStart), and the result says which source was used. A call made
 * while another is still computing abandons it: the earlier promise rejects
 * with RouteRequestCancelledError.
 */
export async function buildRoute(
  lanes: BikeLane[],
  requested: RoutePreferences,
  barriers?: BarrierData | null,
  options: BuildRouteOptions = {},
): Promise<BuiltRoute> {
  const { preferences, startSource } = await resolveStart(requested, options)
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
          throw new DestinationRouteOutsideRangeError(message, unrestrictedRoute, startSource)
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
  return { route, startSource }
}

/** Abandons the route computation in flight, if any. */
export function cancelRouteBuild(): void {
  cancelRouteRequest()
}

/** Call when bike lane data changes so stale graph results are not served. */
export function clearRouteCache(): void {
  cache.clear()
}
