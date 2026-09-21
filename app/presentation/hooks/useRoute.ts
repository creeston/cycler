import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildRoute,
  cancelRouteBuild,
  DestinationRouteOutsideRangeError,
  RouteRequestCancelledError,
} from '~/application/use-cases/build-route'
import type { BuiltRoute } from '~/application/use-cases/build-route'
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
  const [outsideRangeRoute, setOutsideRangeRoute] = useState<BuiltRoute | null>(null)
  // Counts suggestions; only the latest one may touch the store when it settles.
  const latestRequest = useRef(0)

  useEffect(() => setOutsideRangeRoute(null), [preferences])

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
    setOutsideRangeRoute(null)
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
      if (err instanceof DestinationRouteOutsideRangeError) {
        setOutsideRangeRoute({ route: err.route, startSource: err.startSource })
      }
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

  const ignoreDistanceRange = useCallback(() => {
    if (!outsideRangeRoute) return
    setRoute(outsideRangeRoute.route, outsideRangeRoute.startSource)
    setRouteError(null)
    setOutsideRangeRoute(null)
  }, [outsideRangeRoute, setRoute, setRouteError])

  return {
    suggest,
    cancel,
    clear,
    currentRoute,
    routeStartSource,
    isCalculating,
    calculationProgress,
    preferences,
    canIgnoreDistanceRange: outsideRangeRoute !== null,
    ignoreDistanceRange,
  }
}
