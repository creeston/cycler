import { useCallback, useEffect, useState } from 'react'
import { buildRoute, DestinationRouteOutsideRangeError } from '~/application/use-cases/build-route'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import type { Route } from '~/domain/entities/route'

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
  const currentRoute = useRoutingStore(s => s.currentRoute)
  const preferences = useRoutingStore(s => s.preferences)
  const isCalculating = useRoutingStore(s => s.isCalculating)
  const setRoute = useRoutingStore(s => s.setRoute)
  const setCalculating = useRoutingStore(s => s.setCalculating)
  const setRouteError = useRoutingStore(s => s.setRouteError)
  const [outsideRangeRoute, setOutsideRangeRoute] = useState<Route | null>(null)

  useEffect(() => setOutsideRangeRoute(null), [preferences])

  const suggest = useCallback(async () => {
    if (bikeLanes.length === 0 || isCalculating) return
    setCalculating(true)
    setRouteError(null)
    setOutsideRangeRoute(null)
    // Yield to React so the loading spinner renders before the synchronous graph work begins
    await new Promise(resolve => setTimeout(resolve, 0))
    try {
      const [startLon, startLat] = await resolveStartPoint(viewport.longitude, viewport.latitude)
      const route = buildRoute(bikeLanes, { ...preferences, startLon, startLat })
      setRoute(route)
    } catch (err) {
      if (err instanceof DestinationRouteOutsideRangeError) setOutsideRangeRoute(err.route)
      setRouteError(err instanceof Error ? err.message : 'Failed to build route')
    } finally {
      setCalculating(false)
    }
  }, [bikeLanes, viewport, isCalculating, preferences, setRoute, setCalculating, setRouteError])

  const clear = useCallback(() => setRoute(null), [setRoute])

  const ignoreDistanceRange = useCallback(() => {
    if (!outsideRangeRoute) return
    setRoute(outsideRangeRoute)
    setRouteError(null)
    setOutsideRangeRoute(null)
  }, [outsideRangeRoute, setRoute, setRouteError])

  return {
    suggest,
    clear,
    currentRoute,
    isCalculating,
    preferences,
    canIgnoreDistanceRange: outsideRangeRoute !== null,
    ignoreDistanceRange,
  }
}
