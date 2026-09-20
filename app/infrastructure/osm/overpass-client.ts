import osmtogeojson from 'osmtogeojson'
import type { FeatureCollection } from 'geojson'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
] as const
const ATTEMPTS_PER_ENDPOINT = 3
const INITIAL_RETRY_DELAY_MS = 1_000
const OVERALL_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024
const BODY_EXCERPT_BYTES = 512
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504])
const AREA_TOO_LARGE_MESSAGE = 'That area is too large for the map server. Zoom in and try again.'

export interface OverpassRequestOptions {
  signal?: AbortSignal
  onRetry?: (message: string) => void
}

export class OverpassError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly bodyExcerpt?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'OverpassError'
  }
}

let requestQueue: Promise<void> = Promise.resolve()

/**
 * Fetches one Overpass query with bounded retries and endpoint fallback.
 *
 * Public Overpass instances are donated infrastructure. Their coverage and rate limits differ,
 * so requests are conservative and serialised as required by the usage policy:
 * https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
 */
export async function fetchOverpassGeoJSON(
  query: string,
  options: OverpassRequestOptions = {},
): Promise<FeatureCollection> {
  const timeoutController = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, OVERALL_TIMEOUT_MS)
  const abortFromCaller = () => timeoutController.abort(options.signal?.reason)

  if (options.signal?.aborted) abortFromCaller()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    return await serialiseRequest(timeoutController.signal, () =>
      fetchWithFallback(query, timeoutController.signal, options.onRetry),
    )
  } catch (error) {
    if (timedOut) throw new OverpassError(0, AREA_TOO_LARGE_MESSAGE)
    if (options.signal?.aborted) throw abortReason(options.signal)
    throw error
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

async function fetchWithFallback(
  query: string,
  signal: AbortSignal,
  onRetry?: (message: string) => void,
): Promise<FeatureCollection> {
  let lastError: unknown

  for (const [endpointIndex, endpoint] of OVERPASS_ENDPOINTS.entries()) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_ENDPOINT; attempt += 1) {
      throwIfAborted(signal)
      try {
        return await fetchOnce(endpoint, query, signal)
      } catch (error) {
        throwIfAborted(signal)
        if (!isTransient(error)) throw error
        lastError = error

        const anotherAttempt = attempt + 1 < ATTEMPTS_PER_ENDPOINT
        const anotherEndpoint = endpointIndex + 1 < OVERPASS_ENDPOINTS.length
        if (anotherAttempt || anotherEndpoint) onRetry?.(retryMessage(error))
        if (anotherAttempt) await wait(retryDelayMs(error, attempt), signal)
      }
    }
  }

  throw finalTransientError(lastError)
}

async function fetchOnce(
  endpoint: string,
  query: string,
  signal: AbortSignal,
): Promise<FeatureCollection> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    })
  } catch (error) {
    throwIfAborted(signal)
    throw error
  }

  const contentLength = parseContentLength(response.headers.get('content-length'))
  if (contentLength !== undefined && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new OverpassError(response.status, AREA_TOO_LARGE_MESSAGE)
  }

  if (!response.ok) {
    const bodyExcerpt = await readBody(response, BODY_EXCERPT_BYTES, true)
    throw new OverpassError(
      response.status,
      statusMessage(response.status),
      bodyExcerpt,
      parseRetryAfter(response.headers.get('retry-after')),
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!isJsonContentType(contentType)) {
    const bodyExcerpt = await readBody(response, BODY_EXCERPT_BYTES, true)
    throw new OverpassError(
      response.status,
      'OpenStreetMap returned an unexpected response. Try again shortly.',
      bodyExcerpt,
    )
  }

  const body = await readBody(response, MAX_RESPONSE_BYTES, false)
  let osmData: unknown
  try {
    osmData = JSON.parse(body)
  } catch {
    throw new OverpassError(
      response.status,
      'OpenStreetMap returned an unreadable response. Try again shortly.',
      excerpt(body),
    )
  }

  return osmtogeojson(osmData) as FeatureCollection
}

async function serialiseRequest<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  const predecessor = requestQueue
  let release: (() => void) | undefined
  const slot = new Promise<void>(resolve => {
    release = resolve
  })
  requestQueue = predecessor.catch(() => undefined).then(() => slot)

  try {
    await waitForTurn(predecessor, signal)
    throwIfAborted(signal)
    return await task()
  } finally {
    release?.()
  }
}

async function waitForTurn(predecessor: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortReason(signal)

  let rejectOnAbort: ((reason?: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject
  })
  const onAbort = () => rejectOnAbort?.(abortReason(signal))
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    await Promise.race([predecessor, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal))

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timeoutId)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function readBody(
  response: Response,
  maximumBytes: number,
  truncate: boolean,
): Promise<string> {
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let byteCount = 0
  let body = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) return body + decoder.decode()

    const remaining = maximumBytes - byteCount
    if (value.byteLength > remaining) {
      if (truncate) {
        body += decoder.decode(value.subarray(0, Math.max(0, remaining)), { stream: true })
        await reader.cancel()
        return body + decoder.decode()
      }
      await reader.cancel()
      throw new OverpassError(response.status, AREA_TOO_LARGE_MESSAGE)
    }

    byteCount += value.byteLength
    body += decoder.decode(value, { stream: true })
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof OverpassError) return TRANSIENT_STATUSES.has(error.status)
  return error instanceof TypeError
}

function retryDelayMs(error: unknown, attempt: number): number {
  if (error instanceof OverpassError && error.retryAfterMs !== undefined) {
    return error.retryAfterMs
  }
  const jitter = 0.75 + Math.random() * 0.5
  return INITIAL_RETRY_DELAY_MS * 2 ** attempt * jitter
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function statusMessage(status: number): string {
  if (status === 429) return 'Still busy — try again in a minute.'
  if (status === 504) return AREA_TOO_LARGE_MESSAGE
  if (status === 502 || status === 503) {
    return 'OpenStreetMap is temporarily unavailable. Try again shortly.'
  }
  return 'OpenStreetMap rejected this request. Zoom in and try again.'
}

function retryMessage(error: unknown): string {
  if (error instanceof OverpassError && error.status === 429) {
    return 'OpenStreetMap is rate-limiting us. Retrying…'
  }
  if (error instanceof OverpassError && error.status === 504) {
    return 'The map server timed out. Retrying…'
  }
  if (error instanceof OverpassError) return 'OpenStreetMap is busy. Retrying…'
  return 'No connection to OpenStreetMap. Retrying…'
}

function finalTransientError(error: unknown): OverpassError {
  if (error instanceof OverpassError) return error
  return new OverpassError(0, 'No connection to OpenStreetMap.')
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function isJsonContentType(value: string): boolean {
  return /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(value)
}

function excerpt(body: string): string | undefined {
  const trimmed = body.trim()
  return trimmed.length > 0 ? trimmed.slice(0, BODY_EXCERPT_BYTES) : undefined
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}
