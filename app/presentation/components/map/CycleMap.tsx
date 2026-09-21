import { useEffect, useRef, useState } from 'react'
import Map, { NavigationControl, GeolocateControl, Marker } from 'react-map-gl/maplibre'
import type {
  MapMouseEvent,
  MapRef,
  MapTouchEvent,
  ViewStateChangeEvent,
} from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import type { Route } from '~/domain/entities/route'
import { BikeLaneLayer } from './BikeLaneLayer'
import { RouteLayer } from './RouteLayer'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const LONG_PRESS_MS = 500

function routeStartPosition(route: Route): [number, number] | null {
  if (route.segments.length === 0) return null
  const first = route.segments[0].geometry.coordinates[0]
  return [first[0], first[1]]
}

function routeEndPosition(route: Route): [number, number] | null {
  if (route.segments.length === 0) return null
  const lastSegment = route.segments[route.segments.length - 1]
  const last = lastSegment.geometry.coordinates[lastSegment.geometry.coordinates.length - 1]
  return [last[0], last[1]]
}

export function CycleMap() {
  const mapRef = useRef<MapRef>(null)
  const longPressTimer = useRef<number | null>(null)
  const viewport = useMapStore(s => s.viewport)
  const setViewport = useMapStore(s => s.setViewport)
  const setBbox = useMapStore(s => s.setBbox)
  const startLon = useRoutingStore(s => s.preferences.startLon)
  const startLat = useRoutingStore(s => s.preferences.startLat)
  const endLon = useRoutingStore(s => s.preferences.endLon)
  const endLat = useRoutingStore(s => s.preferences.endLat)
  const currentRoute = useRoutingStore(s => s.currentRoute)
  const isChoosingStart = useRoutingStore(s => s.isChoosingStart)
  const isChoosingDestination = useRoutingStore(s => s.isChoosingDestination)
  const setPreferences = useRoutingStore(s => s.setPreferences)
  const setChoosingStart = useRoutingStore(s => s.setChoosingStart)
  const setChoosingDestination = useRoutingStore(s => s.setChoosingDestination)
  const setRoute = useRoutingStore(s => s.setRoute)
  const setRouteError = useRoutingStore(s => s.setRouteError)
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null)

  // A route's own endpoints win over the tapped points: they show where the
  // network was actually joined.
  const tappedStart: [number, number] | null =
    startLon !== undefined && startLat !== undefined ? [startLon, startLat] : null
  const startPosition = currentRoute ? routeStartPosition(currentRoute) : tappedStart
  const tappedDestination: [number, number] | null =
    endLon !== undefined && endLat !== undefined ? [endLon, endLat] : null
  const destinationPosition = tappedDestination
    ? currentRoute
      ? (routeEndPosition(currentRoute) ?? tappedDestination)
      : tappedDestination
    : null

  function clearLongPress(): void {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }

  function setStart(longitude: number, latitude: number): void {
    setPreferences({ startLon: longitude, startLat: latitude })
    setChoosingStart(false)
    setRoute(null)
    setRouteError(null)
  }

  function setDestination(longitude: number, latitude: number): void {
    setPreferences({ endLon: longitude, endLat: latitude, roundTrip: false })
    setChoosingDestination(false)
    setRoute(null)
    setRouteError(null)
  }

  /** A long-press or right-click serves the start while one is being chosen, else the destination. */
  function pickPoint(longitude: number, latitude: number): void {
    if (isChoosingStart) setStart(longitude, latitude)
    else setDestination(longitude, latitude)
  }

  useEffect(() => {
    if (!navigator.permissions || !navigator.geolocation) return
    navigator.permissions.query({ name: 'geolocation' }).then(result => {
      if (result.state !== 'granted') return
      navigator.geolocation.getCurrentPosition(pos => {
        const { longitude, latitude } = pos.coords
        setUserPosition([longitude, latitude])
        mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 14, duration: 1_500 })
      })
    })
  }, [])

  useEffect(
    () => () => {
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
    },
    [],
  )

  function handleMove(e: ViewStateChangeEvent) {
    const { longitude, latitude, zoom } = e.viewState
    setViewport({ longitude, latitude, zoom })
  }

  /**
   * The box is what decides which lanes are drawn and which cached areas are
   * held, so it is updated when the map settles rather than on every frame of a
   * pan — otherwise both are recomputed sixty times a second.
   */
  function handleMoveEnd(e: ViewStateChangeEvent) {
    const b = e.target.getBounds()
    setBbox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() })
  }

  return (
    <Map
      ref={mapRef}
      longitude={viewport.longitude}
      latitude={viewport.latitude}
      zoom={viewport.zoom}
      style={{ width: '100%', height: '100%' }}
      mapStyle={MAP_STYLE}
      workerUrl={maplibreWorkerUrl}
      onMove={handleMove}
      onMoveEnd={handleMoveEnd}
      onClick={event => {
        if (isChoosingStart || isChoosingDestination) pickPoint(event.lngLat.lng, event.lngLat.lat)
      }}
      onContextMenu={(event: MapMouseEvent) => {
        event.originalEvent.preventDefault()
        pickPoint(event.lngLat.lng, event.lngLat.lat)
      }}
      onTouchStart={(event: MapTouchEvent) => {
        clearLongPress()
        const { lng, lat } = event.lngLat
        longPressTimer.current = window.setTimeout(() => pickPoint(lng, lat), LONG_PRESS_MS)
      }}
      onTouchMove={clearLongPress}
      onTouchEnd={clearLongPress}
      onLoad={e => {
        const b = e.target.getBounds()
        setBbox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() })
      }}
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
    >
      <NavigationControl position="top-right" showCompass={false} />
      <GeolocateControl
        position="top-right"
        trackUserLocation={false}
        fitBoundsOptions={{ maxZoom: 15 }}
        onGeolocate={e => setUserPosition([e.coords.longitude, e.coords.latitude])}
      />
      {userPosition && (
        <Marker longitude={userPosition[0]} latitude={userPosition[1]} anchor="center">
          <div className="relative flex items-center justify-center">
            <div className="absolute h-8 w-8 rounded-full bg-blue-400/30 animate-ping" />
            <div className="h-4 w-4 rounded-full bg-blue-500 border-2 border-white shadow-md" />
          </div>
        </Marker>
      )}
      {startPosition && (
        <Marker longitude={startPosition[0]} latitude={startPosition[1]} anchor="center">
          <div
            aria-label="Start"
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-600 shadow-lg"
          >
            <div className="h-2.5 w-2.5 rounded-full bg-white" />
          </div>
        </Marker>
      )}
      {destinationPosition && (
        <Marker
          longitude={destinationPosition[0]}
          latitude={destinationPosition[1]}
          anchor="bottom"
        >
          <div
            aria-label="Destination"
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-orange-500 text-sm font-bold text-white shadow-lg"
          >
            ×
          </div>
        </Marker>
      )}
      <BikeLaneLayer />
      <RouteLayer />
    </Map>
  )
}
