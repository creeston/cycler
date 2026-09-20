import { handleRouteRequest } from './routing-protocol'
import type { RouteReply, RouteRequest } from './routing-protocol'
import type { RoutingProgress } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { BarrierData } from '~/domain/entities/barrier'
import type { Route, RoutePreferences } from '~/domain/entities/route'

/** Thrown to the caller whose request was abandoned by a newer one or by cancelRouteRequest. */
export class RouteRequestCancelledError extends Error {
  constructor() {
    super('Route request cancelled')
    this.name = 'RouteRequestCancelledError'
  }
}

export interface RouteRequestOptions {
  barriers?: BarrierData | null
  onProgress?: (progress: RoutingProgress) => void
}

interface PendingRequest {
  request: RouteRequest
  onProgress?: (progress: RoutingProgress) => void
  resolve: (routes: Route[]) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let pending: PendingRequest | null = null
let nextId = 0

/**
 * Runs findRoutes in a worker so the map keeps responding while a route is
 * computed. One request is in flight at a time: a new one abandons the
 * current one, whose promise rejects with RouteRequestCancelledError.
 *
 * The lanes and barriers are cloned into the worker on every call. Measured
 * on a 10 000-node synthetic city, the clone costs ~9 ms against ~350 ms of
 * search (backlog/done/17), so nothing is cached on the worker side.
 *
 * When no worker can be constructed, or the worker fails to load, the search
 * runs on the main thread instead, after yielding once so the spinner paints.
 */
export function postRouteRequest(
  lanes: BikeLane[],
  preferences: RoutePreferences,
  options: RouteRequestOptions = {},
): Promise<Route[]> {
  cancelRouteRequest()
  const request: RouteRequest = {
    id: ++nextId,
    lanes,
    preferences,
    barriers: options.barriers ?? null,
  }
  return new Promise<Route[]>((resolve, reject) => {
    pending = { request, onProgress: options.onProgress, resolve, reject }
    worker ??= createWorker()
    if (worker) worker.postMessage(request)
    else runDirect(request)
  })
}

/** Abandons the request in flight, if any. Its promise rejects with RouteRequestCancelledError. */
export function cancelRouteRequest(): void {
  if (!pending) return
  const abandoned = pending
  pending = null
  // Terminating is the only way to stop a search that has already started.
  terminateRoutingWorker()
  abandoned.reject(new RouteRequestCancelledError())
}

/** Stops the worker, abandoning any request in flight. The next request starts a new one. */
export function terminateRoutingWorker(): void {
  cancelRouteRequest()
  worker?.terminate()
  worker = null
}

function createWorker(): Worker | null {
  try {
    const created = new Worker(new URL('./routing.worker.ts', import.meta.url), {
      type: 'module',
    })
    created.onmessage = (event: MessageEvent<RouteReply>) => handleReply(event.data)
    created.onerror = event => {
      // The script did not load or crashed. Answer the pending request on the main thread
      // and let the next request try a fresh worker.
      console.warn(`Routing worker failed, computing on the main thread: ${event.message}`)
      created.terminate()
      if (worker === created) worker = null
      if (pending) runDirect(pending.request)
    }
    return created
  } catch {
    return null
  }
}

function handleReply(reply: RouteReply): void {
  if (!pending || reply.id !== pending.request.id) return
  if (reply.type === 'progress') {
    pending.onProgress?.({ completed: reply.completed, total: reply.total })
    return
  }
  const settled = pending
  pending = null
  if (reply.type === 'routes') settled.resolve(reply.routes)
  else settled.reject(new Error(reply.message))
}

function runDirect(request: RouteRequest): void {
  // Yield to the browser so the spinner renders before the synchronous work begins.
  setTimeout(() => {
    if (pending?.request.id !== request.id) return
    handleRouteRequest(request, handleReply)
  }, 0)
}
