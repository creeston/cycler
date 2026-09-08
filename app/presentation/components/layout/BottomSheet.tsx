import { useEffect, useState } from 'react'
import { ChevronDown, MapPin, Route, Download, RefreshCw, X } from 'lucide-react'
import { Button } from '~/presentation/components/ui/Button'
import { SegmentedControl } from '~/presentation/components/ui/SegmentedControl'
import { Slider } from '~/presentation/components/ui/Slider'
import { useBikeLanes } from '~/presentation/hooks/useBikeLanes'
import { useRoute } from '~/presentation/hooks/useRoute'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import { downloadGpx } from '~/infrastructure/export/gpx'
import { isRoundTrip } from '~/domain/entities/route'

type RouteMode = 'explore' | 'loop' | 'destination'

const ROUTE_MODES: { label: string; value: RouteMode }[] = [
  { label: 'Explore', value: 'explore' },
  { label: 'Loop', value: 'loop' },
  { label: 'To destination', value: 'destination' },
]

export function BottomSheet() {
  const [expanded, setExpanded] = useState(true)

  const { fetch: fetchLanes, isLoading, lastFetchedAt, isAreaTooLarge } = useBikeLanes()
  const {
    suggest,
    clear,
    currentRoute,
    isCalculating,
    canIgnoreDistanceRange,
    ignoreDistanceRange,
  } = useRoute()

  const bikeLaneCount = useMapStore(s => s.bikeLanes.length)
  const fetchError = useMapStore(s => s.fetchError)
  const routeError = useRoutingStore(s => s.routeError)
  const maxGapMeters = useRoutingStore(s => s.preferences.maxGapMeters)
  const roundTrip = useRoutingStore(s => s.preferences.roundTrip)
  const endLon = useRoutingStore(s => s.preferences.endLon)
  const endLat = useRoutingStore(s => s.preferences.endLat)
  const isChoosingDestination = useRoutingStore(s => s.isChoosingDestination)
  const setPreferences = useRoutingStore(s => s.setPreferences)
  const setChoosingDestination = useRoutingStore(s => s.setChoosingDestination)
  const setRoute = useRoutingStore(s => s.setRoute)
  const setRouteError = useRoutingStore(s => s.setRouteError)
  const [pendingMaxGapMeters, setPendingMaxGapMeters] = useState(maxGapMeters)

  useEffect(() => setPendingMaxGapMeters(maxGapMeters), [maxGapMeters])

  useEffect(() => {
    if (pendingMaxGapMeters === maxGapMeters) return

    const timeout = window.setTimeout(
      () => setPreferences({ maxGapMeters: pendingMaxGapMeters }),
      200,
    )
    return () => window.clearTimeout(timeout)
  }, [maxGapMeters, pendingMaxGapMeters, setPreferences])

  const error = fetchError ?? routeError
  const hasDestination = endLon !== undefined && endLat !== undefined
  const routeMode: RouteMode =
    hasDestination || isChoosingDestination ? 'destination' : roundTrip ? 'loop' : 'explore'

  function selectRouteMode(mode: RouteMode): void {
    setRoute(null)
    setRouteError(null)
    if (mode === 'destination') {
      setPreferences({ endLon: undefined, endLat: undefined, roundTrip: false })
      setChoosingDestination(true)
      return
    }
    setChoosingDestination(false)
    setPreferences({
      endLon: undefined,
      endLat: undefined,
      roundTrip: mode === 'loop',
    })
  }

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

        <Button
          className="w-full"
          onClick={() => fetchLanes()}
          loading={isLoading}
          disabled={isLoading || isAreaTooLarge}
        >
          <MapPin size={16} />
          Load Bike Lanes
        </Button>
        {isAreaTooLarge && (
          <p className="text-center text-xs text-gray-400">Zoom in — area exceeds 50×50 km</p>
        )}

        {bikeLaneCount > 0 && !currentRoute && (
          <Button
            className="w-full"
            onClick={suggest}
            loading={isCalculating}
            disabled={isCalculating}
          >
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
              {isRoundTrip(currentRoute) && (
                <div className="flex justify-between">
                  <span>Route type</span>
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-600">
                    Loop
                  </span>
                </div>
              )}
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
              <Button variant="ghost" className="flex-1" onClick={() => downloadGpx(currentRoute)}>
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

        <details className="group rounded-xl border border-gray-200 bg-white/70">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">
            Preferences
            <ChevronDown
              aria-hidden="true"
              className="transition-transform group-open:rotate-180"
              size={16}
            />
          </summary>
          <div className="space-y-3 border-t border-gray-100 px-4 py-3">
            <SegmentedControl
              label="Route mode"
              options={ROUTE_MODES}
              value={routeMode}
              onChange={selectRouteMode}
            />
            {isChoosingDestination && (
              <p className="text-center text-xs text-orange-600">
                Tap the map to choose a destination
              </p>
            )}
            {hasDestination && (
              <Button
                variant="ghost"
                className="w-full py-2"
                onClick={() => selectRouteMode('explore')}
              >
                Clear destination
              </Button>
            )}
            <Slider
              label="Gap tolerance"
              valueLabel={`${pendingMaxGapMeters} m`}
              min={0}
              max={500}
              step={25}
              value={pendingMaxGapMeters}
              aria-valuetext={`${pendingMaxGapMeters} metres`}
              onChange={event => setPendingMaxGapMeters(Number(event.currentTarget.value))}
            />
          </div>
        </details>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        {canIgnoreDistanceRange && routeError && (
          <Button variant="ghost" className="w-full" onClick={ignoreDistanceRange}>
            Ignore distance range
          </Button>
        )}
      </div>
    </div>
  )
}
