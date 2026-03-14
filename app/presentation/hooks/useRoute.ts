import { useCallback } from 'react'
import { buildRoute } from '~/application/use-cases/build-route'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'

async function resolveStartPoint(
  fallbackLon: number,
  fallbackLat: number,
): Promise<[number, number]> {
  if (!navigator.geolocation) return [fallbackLon, fallbackLat]
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve([pos.coords.longitude, pos.coords.latitude]),
      () => resolve([fallbackLon, fallbackLat]),
      { timeout: 3_000, maximumAge: 60_000 },
    )
  })
}

export function useRoute() {
  const bikeLanes = useMapStore(s => s.bikeLanes)
  const viewport = useMapStore(s => s.viewport)
  const { currentRoute, preferences, isCalculating, setRoute, setCalculating, setRouteError } =
    useRoutingStore()

  const suggest = useCallback(async () => {
    if (bikeLanes.length === 0 || isCalculating) return
    setCalculating(true)
    setRouteError(null)
    // Yield to React so the loading spinner renders before the synchronous graph work begins
    await new Promise(resolve => setTimeout(resolve, 0))
    try {
      const [startLon, startLat] = await resolveStartPoint(viewport.longitude, viewport.latitude)
      const route = buildRoute(bikeLanes, preferences, startLon, startLat)
      setRoute(route)
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : 'Failed to build route')
    } finally {
      setCalculating(false)
    }
  }, [bikeLanes, viewport, isCalculating, preferences, setRoute, setCalculating, setRouteError])

  const clear = useCallback(() => setRoute(null), [setRoute])

  return { suggest, clear, currentRoute, isCalculating, preferences }
}
