import { findRoutes } from '~/domain/routing/route-finder'
import type { RoutingProgress } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { BarrierData } from '~/domain/entities/barrier'
import type { Route, RoutePreferences } from '~/domain/entities/route'

/** One search, sent from the main thread to the routing worker. */
export interface RouteRequest {
  /** Matches replies to the request they answer; a reply for another id is stale. */
  id: number
  lanes: BikeLane[]
  preferences: RoutePreferences
  barriers: BarrierData | null
}

export type RouteReply =
  | ({ type: 'progress'; id: number } & RoutingProgress)
  | { type: 'routes'; id: number; routes: Route[] }
  | { type: 'error'; id: number; message: string }

/**
 * Runs one request and posts its replies: progress while it runs, then the
 * routes or the error. Shared by the worker and by the direct fallback, so
 * both paths answer the same way.
 */
export function handleRouteRequest(request: RouteRequest, post: (reply: RouteReply) => void): void {
  const { id, lanes, preferences, barriers } = request
  try {
    const routes = findRoutes(lanes, preferences, {
      barriers: barriers ?? undefined,
      onProgress: progress => post({ type: 'progress', id, ...progress }),
    })
    post({ type: 'routes', id, routes })
  } catch (error) {
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
}
