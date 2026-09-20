import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import { findRoutes } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { Route } from '~/domain/entities/route'
import {
  cancelRouteRequest,
  postRouteRequest,
  RouteRequestCancelledError,
  terminateRoutingWorker,
} from './routing-client'
import type { RouteReply, RouteRequest } from './routing-protocol'

vi.mock('~/domain/routing/route-finder', () => ({
  findRoutes: vi.fn(),
}))

const findRoutesMock = vi.mocked(findRoutes)

const lanes: BikeLane[] = [
  {
    id: 'lane',
    osmId: '1',
    geometry: {
      type: 'LineString',
      coordinates: [
        [21, 52],
        [21.1, 52.1],
      ],
    },
    laneType: 'cycleway',
    tags: {},
  },
]

const preferences = { ...DEFAULT_PREFERENCES, startLon: 21, startLat: 52 }

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  findRoutesMock.mockReset()
})

afterEach(() => {
  terminateRoutingWorker()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('postRouteRequest', () => {
  it('posts the lanes, preferences and barriers and resolves with the routes', async () => {
    const barriers = { barriers: [], crossings: [] }

    const pending = postRouteRequest(lanes, preferences, { barriers })
    const worker = lastWorker()
    const request = worker.posted[0]
    expect(worker.options).toEqual({ type: 'module' })
    expect(request).toMatchObject({ lanes, preferences, barriers })

    worker.reply({ type: 'routes', id: request.id, routes: [route('found')] })

    await expect(pending).resolves.toEqual([route('found')])
  })

  it('rejects with the message the worker reports', async () => {
    const pending = postRouteRequest(lanes, preferences)
    const worker = lastWorker()

    worker.reply({ type: 'error', id: worker.posted[0].id, message: 'graph exploded' })

    await expect(pending).rejects.toThrow('graph exploded')
  })

  it('forwards progress for the request in flight only', () => {
    const onProgress = vi.fn()
    void postRouteRequest(lanes, preferences, { onProgress }).catch(() => {})
    const worker = lastWorker()
    const { id } = worker.posted[0]

    worker.reply({ type: 'progress', id: id + 1, completed: 1, total: 4 })
    worker.reply({ type: 'progress', id, completed: 2, total: 4 })

    expect(onProgress).toHaveBeenCalledOnce()
    expect(onProgress).toHaveBeenCalledWith({ completed: 2, total: 4 })
  })

  it('abandons the request in flight when a new one arrives', async () => {
    const first = postRouteRequest(lanes, preferences)
    const firstWorker = lastWorker()

    const second = postRouteRequest(lanes, { ...preferences, roundTrip: true })
    const secondWorker = lastWorker()

    expect(firstWorker.terminated).toBe(true)
    expect(secondWorker).not.toBe(firstWorker)
    await expect(first).rejects.toBeInstanceOf(RouteRequestCancelledError)

    firstWorker.reply({ type: 'routes', id: firstWorker.posted[0].id, routes: [route('stale')] })
    secondWorker.reply({ type: 'routes', id: secondWorker.posted[0].id, routes: [route('fresh')] })

    await expect(second).resolves.toEqual([route('fresh')])
  })

  it('rejects the request in flight when cancelled', async () => {
    const pending = postRouteRequest(lanes, preferences)

    cancelRouteRequest()

    expect(lastWorker().terminated).toBe(true)
    await expect(pending).rejects.toBeInstanceOf(RouteRequestCancelledError)
  })

  it('keeps one worker across requests that complete', async () => {
    const first = postRouteRequest(lanes, preferences)
    const worker = lastWorker()
    worker.reply({ type: 'routes', id: worker.posted[0].id, routes: [] })
    await first

    void postRouteRequest(lanes, preferences).catch(() => {})

    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker.posted).toHaveLength(2)
  })

  it('ignores a reply for a request that is not in flight', async () => {
    const pending = postRouteRequest(lanes, preferences)
    const worker = lastWorker()
    const { id } = worker.posted[0]

    worker.reply({ type: 'routes', id: id + 1, routes: [route('stale')] })
    worker.reply({ type: 'routes', id, routes: [route('fresh')] })

    await expect(pending).resolves.toEqual([route('fresh')])
  })

  it('computes on the main thread when the worker cannot be constructed', async () => {
    vi.stubGlobal('Worker', undefined)
    findRoutesMock.mockReturnValue([route('direct')])
    const barriers = { barriers: [], crossings: [] }

    await expect(postRouteRequest(lanes, preferences, { barriers })).resolves.toEqual([
      route('direct'),
    ])
    expect(findRoutesMock).toHaveBeenCalledWith(lanes, preferences, {
      barriers,
      onProgress: expect.any(Function),
    })
  })

  it('computes on the main thread when the worker fails to load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    findRoutesMock.mockReturnValue([route('direct')])

    const pending = postRouteRequest(lanes, preferences)
    lastWorker().fail('404')

    await expect(pending).resolves.toEqual([route('direct')])
    expect(lastWorker().terminated).toBe(true)

    void postRouteRequest(lanes, preferences).catch(() => {})
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('does not run a main-thread computation that was cancelled before it started', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', undefined)
    findRoutesMock.mockReturnValue([route('direct')])

    const pending = postRouteRequest(lanes, preferences)
    cancelRouteRequest()
    const rejection = expect(pending).rejects.toBeInstanceOf(RouteRequestCancelledError)
    await vi.runAllTimersAsync()

    await rejection
    expect(findRoutesMock).not.toHaveBeenCalled()
  })
})

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<RouteReply>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: RouteRequest[] = []
  terminated = false

  constructor(
    readonly url: URL,
    readonly options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this)
  }

  postMessage(request: RouteRequest): void {
    this.posted.push(request)
  }

  terminate(): void {
    this.terminated = true
  }

  reply(reply: RouteReply): void {
    this.onmessage?.({ data: reply } as MessageEvent<RouteReply>)
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent)
  }
}

function lastWorker(): FakeWorker {
  return FakeWorker.instances[FakeWorker.instances.length - 1]
}

function route(id: string): Route {
  return {
    id,
    segments: [],
    totalDistanceMeters: 0,
    bikeLaneDistanceMeters: 0,
    bikeLaneCoverage: 0,
    gapCount: 0,
    gapDistanceMeters: 0,
    barrierCrossingCount: 0,
    barriersChecked: true,
    requestedGapMeters: 200,
    appliedGapMeters: 200,
    createdAt: new Date(0),
  }
}
