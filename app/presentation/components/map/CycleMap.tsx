import { useEffect, useRef, useState } from 'react'
import Map, { NavigationControl, GeolocateControl, Marker } from 'react-map-gl/maplibre'
import type { MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapStore } from '~/application/stores/map-store'
import { BikeLaneLayer } from './BikeLaneLayer'
import { RouteLayer } from './RouteLayer'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

export function CycleMap() {
  const mapRef = useRef<MapRef>(null)
  const { viewport, setViewport, setBbox } = useMapStore()
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null)

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

  function handleMove(e: ViewStateChangeEvent) {
    const { longitude, latitude, zoom } = e.viewState
    setViewport({ longitude, latitude, zoom })
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
      onMove={handleMove}
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
      <BikeLaneLayer />
      <RouteLayer />
    </Map>
  )
}
