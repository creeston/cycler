import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOverpassGeoJSON, OverpassError } from './overpass-client'

const SUCCESS_BODY = JSON.stringify({ elements: [] })

function response(
  body: string,
  status = 200,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): Response {
  return new Response(body, { status, headers })
}

describe('fetchOverpassGeoJSON', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('retries a rate-limited request and resolves on the second attempt', async () => {
    vi.useFakeTimers()
    const onRetry = vi.fn()
    fetchMock
      .mockResolvedValueOnce(response('busy', 429, { 'content-type': 'text/plain' }))
      .mockResolvedValueOnce(response(SUCCESS_BODY))

    const result = fetchOverpassGeoJSON('[out:json];out;', { onRetry })
    const expectation = expect(result).resolves.toMatchObject({ type: 'FeatureCollection' })
    await vi.advanceTimersByTimeAsync(1_000)

    await expectation
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith('OpenStreetMap is rate-limiting us. Retrying…')
  })

  it('retries a network failure', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response(SUCCESS_BODY))

    const result = fetchOverpassGeoJSON('[out:json];out;')
    const expectation = expect(result).resolves.toBeDefined()
    await vi.advanceTimersByTimeAsync(1_000)

    await expectation
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('honours Retry-After before making the second request', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(
        response('busy', 429, { 'content-type': 'text/plain', 'retry-after': '2' }),
      )
      .mockResolvedValueOnce(response(SUCCESS_BODY))

    const result = fetchOverpassGeoJSON('[out:json];out;')
    const expectation = expect(result).resolves.toBeDefined()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1)
    await expectation
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the next endpoint after three transient failures', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(response('busy', 429, { 'content-type': 'text/plain' }))
      .mockResolvedValueOnce(response('busy', 429, { 'content-type': 'text/plain' }))
      .mockResolvedValueOnce(response('busy', 429, { 'content-type': 'text/plain' }))
      .mockResolvedValueOnce(response(SUCCESS_BODY))

    const result = fetchOverpassGeoJSON('[out:json];out;')
    const expectation = expect(result).resolves.toBeDefined()
    await vi.advanceTimersByTimeAsync(3_000)
    await expectation

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[2][0])
    expect(fetchMock.mock.calls[3][0]).not.toBe(fetchMock.mock.calls[0][0])
  })

  it('does not retry a permanent client error', async () => {
    fetchMock.mockResolvedValueOnce(
      response('malformed query', 400, { 'content-type': 'text/plain' }),
    )

    await expect(fetchOverpassGeoJSON('invalid')).rejects.toMatchObject({
      name: 'OverpassError',
      status: 400,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns an actionable message after every mirror remains rate-limited', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(() =>
      Promise.resolve(response('busy', 429, { 'content-type': 'text/plain' })),
    )

    const result = fetchOverpassGeoJSON('[out:json];out;')
    const expectation = expect(result).rejects.toMatchObject({
      status: 429,
      message: 'Still busy — try again in a minute.',
    })
    await vi.advanceTimersByTimeAsync(12_000)

    await expectation
    expect(fetchMock).toHaveBeenCalledTimes(12)
  })

  it('wraps an HTML success body with its status and an excerpt', async () => {
    fetchMock.mockResolvedValueOnce(
      response('<html>upstream proxy failed</html>', 200, { 'content-type': 'text/html' }),
    )

    const error = await fetchOverpassGeoJSON('[out:json];out;').catch(reason => reason)

    expect(error).toBeInstanceOf(OverpassError)
    expect(error).toMatchObject({ status: 200, bodyExcerpt: '<html>upstream proxy failed</html>' })
  })

  it('rejects an implausibly large response before reading it', async () => {
    fetchMock.mockResolvedValueOnce(
      response('', 200, {
        'content-type': 'application/json',
        'content-length': String(26 * 1024 * 1024),
      }),
    )

    await expect(fetchOverpassGeoJSON('[out:json];out;')).rejects.toMatchObject({
      name: 'OverpassError',
      status: 200,
      message: 'That area is too large for the map server. Zoom in and try again.',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('passes abort through without retrying', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })

    const result = fetchOverpassGeoJSON('[out:json];out;', { signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('turns the overall deadline into an actionable timeout error', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })

    const result = fetchOverpassGeoJSON('[out:json];out;')
    const expectation = expect(result).rejects.toMatchObject({
      status: 0,
      message: 'That area is too large for the map server. Zoom in and try again.',
    })
    await vi.advanceTimersByTimeAsync(60_000)

    await expectation
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('allows only one Overpass query to be in flight', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(response(SUCCESS_BODY))

    const first = fetchOverpassGeoJSON('first')
    const second = fetchOverpassGeoJSON('second')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    resolveFirst!(response(SUCCESS_BODY))
    await expect(first).resolves.toBeDefined()
    await expect(second).resolves.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
