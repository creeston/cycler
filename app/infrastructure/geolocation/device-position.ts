export const DEVICE_POSITION_TIMEOUT_MS = 3_000

/**
 * Asks the browser where the device is. Resolves null when there is no
 * geolocation API, the permission is refused, or no position arrives within
 * DEVICE_POSITION_TIMEOUT_MS — the caller decides what stands in.
 */
export function locateDevice(): Promise<[number, number] | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve([pos.coords.longitude, pos.coords.latitude]),
      () => resolve(null),
      { timeout: DEVICE_POSITION_TIMEOUT_MS, maximumAge: 60_000 },
    )
  })
}
