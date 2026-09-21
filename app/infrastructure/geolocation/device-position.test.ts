import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_POSITION_TIMEOUT_MS, locateDevice } from './device-position'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('locateDevice', () => {
  it('resolves the device coordinates as [longitude, latitude]', async () => {
    stubGeolocation((onSuccess: PositionCallback) =>
      onSuccess({ coords: { longitude: 21.01, latitude: 52.23 } } as GeolocationPosition),
    )

    await expect(locateDevice()).resolves.toEqual([21.01, 52.23])
  })

  it('resolves null when the position is refused or times out', async () => {
    const getCurrentPosition = stubGeolocation(
      (_onSuccess: PositionCallback, onError?: PositionErrorCallback | null) =>
        onError?.({ code: 1, message: 'denied' } as GeolocationPositionError),
    )

    await expect(locateDevice()).resolves.toBeNull()
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ timeout: DEVICE_POSITION_TIMEOUT_MS }),
    )
  })

  it('resolves null when the browser has no geolocation API', async () => {
    vi.stubGlobal('navigator', {})

    await expect(locateDevice()).resolves.toBeNull()
  })
})

function stubGeolocation(
  implementation: (onSuccess: PositionCallback, onError?: PositionErrorCallback | null) => void,
) {
  const getCurrentPosition = vi.fn(implementation)
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  return getCurrentPosition
}
