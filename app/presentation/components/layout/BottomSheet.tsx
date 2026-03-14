import { useState } from 'react'
import { MapPin, Route, Download, RefreshCw, X } from 'lucide-react'
import { Button } from '~/presentation/components/ui/Button'
import { useBikeLanes } from '~/presentation/hooks/useBikeLanes'
import { useRoute } from '~/presentation/hooks/useRoute'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import { downloadGpx } from '~/infrastructure/export/gpx'

export function BottomSheet() {
  const [expanded, setExpanded] = useState(true)

  const { fetch: fetchLanes, isLoading, lastFetchedAt, isAreaTooLarge } = useBikeLanes()
  const { suggest, clear, currentRoute, isCalculating } = useRoute()

  const bikeLaneCount = useMapStore(s => s.bikeLanes.length)
  const fetchError = useMapStore(s => s.fetchError)
  const routeError = useRoutingStore(s => s.routeError)

  const error = fetchError ?? routeError

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-10 transition-transform duration-300"
      style={{ transform: expanded ? 'translateY(0)' : 'translateY(calc(100% - 56px))' }}
    >
      {/* drag handle */}
      <div
        className="flex cursor-pointer items-center justify-center rounded-t-2xl bg-white/95 backdrop-blur-sm px-4 pt-3 pb-2 shadow-lg"
        onClick={() => setExpanded(v => !v)}
        role="button"
        aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
      >
        <div className="h-1 w-10 rounded-full bg-gray-300" />
      </div>

      {/* panel body */}
      <div className="bg-white/95 backdrop-blur-sm px-4 pb-8 pt-2 shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold tracking-tight text-gray-900">CycleRoute</h1>
          {lastFetchedAt && (
            <span className="text-xs text-gray-400">{bikeLaneCount} lanes loaded</span>
          )}
        </div>

        <Button className="w-full" onClick={() => fetchLanes()} loading={isLoading} disabled={isLoading || isAreaTooLarge}>
          <MapPin size={16} />
          Load Bike Lanes
        </Button>
        {isAreaTooLarge && (
          <p className="text-center text-xs text-gray-400">Zoom in — area exceeds 50×50 km</p>
        )}

        {bikeLaneCount > 0 && !currentRoute && (
          <Button className="w-full" onClick={suggest} loading={isCalculating} disabled={isCalculating}>
            <Route size={16} />
            Suggest Route
          </Button>
        )}

        {currentRoute && (
          <>
            <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600 space-y-1">
              <div className="flex justify-between">
                <span>Distance</span>
                <span className="font-medium text-gray-900">
                  {(currentRoute.totalDistanceMeters / 1000).toFixed(1)} km
                </span>
              </div>
              <div className="flex justify-between">
                <span>Bike lane coverage</span>
                <span className="font-medium text-orange-500">
                  {Math.round(currentRoute.bikeLaneCoverage * 100)}%
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={suggest}
                loading={isCalculating}
                disabled={isCalculating}
                className="flex-1"
              >
                <RefreshCw size={15} />
                New Route
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => downloadGpx(currentRoute)}
              >
                <Download size={15} />
                Export GPX
              </Button>
              <Button
                variant="ghost"
                onClick={clear}
                className="px-3 text-gray-400 hover:text-gray-700"
                aria-label="Clear route"
              >
                <X size={16} />
              </Button>
            </div>
          </>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}
      </div>
    </div>
  )
}
