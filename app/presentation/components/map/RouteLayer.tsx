import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import { routeToFeatureCollection } from '~/domain/mappers/geojson-from-domain'
import { useRoutingStore } from '~/application/stores/routing-store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BIKE_LANE_FILTER: any = ['==', ['get', 'type'], 'bike_lane']
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GAP_FILTER: any = ['==', ['get', 'type'], 'gap']

export function RouteLayer() {
  const route = useRoutingStore(s => s.currentRoute)
  // Rebuilt only when the route changes, not on every render of the map.
  const data = useMemo(() => (route ? routeToFeatureCollection(route) : null), [route])

  if (!data) return null

  return (
    <Source id="route" type="geojson" data={data}>
      {/* Mapped bike-lane segments — white casing + orange fill */}
      <Layer
        id="route-lane-casing"
        type="line"
        filter={BIKE_LANE_FILTER}
        paint={{ 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.55 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
      <Layer
        id="route-lane-fill"
        type="line"
        filter={BIKE_LANE_FILTER}
        paint={{ 'line-color': '#FF5400', 'line-width': 5, 'line-opacity': 1 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
      {/* Road gaps — a strong casing and blue dashes keep them legible outdoors. */}
      <Layer
        id="route-gap-casing"
        type="line"
        filter={GAP_FILTER}
        paint={{ 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.9 }}
        layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
      />
      <Layer
        id="route-gap-fill"
        type="line"
        filter={GAP_FILTER}
        paint={{
          'line-color': '#0072B2',
          'line-width': 6,
          'line-opacity': 1,
          'line-dasharray': [1.5, 1.25],
        }}
        layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
      />
    </Source>
  )
}
