import { useEffect, useState } from 'react'
import { useRoutingStore } from '~/application/stores/routing-store'

type NumericPreference =
  'maxGapMeters' | 'startProximityMeters' | 'minDistanceMeters' | 'maxDistanceMeters'

const COMMIT_DELAY_MS = 200

/**
 * A slider value that follows the store but writes back only once the rider
 * has stopped moving it, so dragging does not rebuild the route cache key on
 * every step.
 */
export function useDebouncedPreference(key: NumericPreference): [number, (value: number) => void] {
  const committed = useRoutingStore(s => s.preferences[key])
  const setPreferences = useRoutingStore(s => s.setPreferences)
  const [pending, setPending] = useState(committed)

  useEffect(() => setPending(committed), [committed])

  useEffect(() => {
    if (pending === committed) return
    const timeout = window.setTimeout(() => setPreferences({ [key]: pending }), COMMIT_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [key, committed, pending, setPreferences])

  return [pending, setPending]
}
