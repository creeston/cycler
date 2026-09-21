import { useCallback, useRef } from 'react'
import {
  buildRoute,
  cancelRouteBuild,
  RouteRequestCancelledError,
} from '~/application/use-cases/build-route'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import type { RoutingProgress } from '~/domain/routing/route-finder'

function fractionDone({ completed, total }: RoutingProgress): number | null {
  return total > 0 ? completed / total : null
}

export function useRoute() {
  const bikeLanes = useMapStore(s => s.bikeLanes)
  const barriers = useMapStore(s => s.barriers)
  const viewport = useMapStore(s => s.viewport)
  const currentRoute = useRoutingStore(s => s.currentRoute)
  const routeStartSource = useRoutingStore(s => s.routeStartSource)
  const preferences = useRoutingStore(s => s.preferences)
  const isCalculating = useRoutingStore(s => s.isCalculating)
  const calculationProgress = useRoutingStore(s => s.calculationProgress)
  const setRoute = useRoutingStore(s => s.setRoute)
  const setCalculating = useRoutingStore(s => s.setCalculating)
  const setCalculationProgress = useRoutingStore(s => s.setCalculationProgress)
  const setRouteError = useRoutingStore(s => s.setRouteError)
  // Counts suggestions; only the latest one may touch the store when it settles.
  const latestRequest = useRef(0)

  const finish = useCallback(() => {
    setCalculating(false)
    setCalculationProgress(null)
  }, [setCalculating, setCalculationProgress])

  const suggest = useCallback(async () => {
    if (bikeLanes.length === 0) return
    const request = ++latestRequest.current
    const isLatest = () => latestRequest.current === request
    setCalculating(true)
    setCalculationProgress(null)
    setRouteError(null)
    try {
      const built = await buildRoute(bikeLanes, preferences, barriers, {
        mapCentre: [viewport.longitude, viewport.latitude],
        onProgress: progress => {
          if (isLatest()) setCalculationProgress(fractionDone(progress))
        },
      })
      if (isLatest()) setRoute(built.route, built.startSource)
    } catch (err) {
      if (!isLatest() || err instanceof RouteRequestCancelledError) return
      setRouteError(err instanceof Error ? err.message : 'Failed to build route')
    } finally {
      if (isLatest()) finish()
    }
  }, [
    bikeLanes,
    barriers,
    viewport,
    preferences,
    setRoute,
    setCalculating,
    setCalculationProgress,
    setRouteError,
    finish,
  ])

  const cancel = useCallback(() => {
    latestRequest.current++
    cancelRouteBuild()
    finish()
  }, [finish])

  const clear = useCallback(() => setRoute(null), [setRoute])

  return {
    suggest,
    cancel,
    clear,
    currentRoute,
    routeStartSource,
    isCalculating,
    calculationProgress,
    preferences,
  }
}
