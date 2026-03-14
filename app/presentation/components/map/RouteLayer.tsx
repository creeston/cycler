import { Source, Layer } from 'react-map-gl/maplibre'
import { routeToFeatureCollection } from '~/domain/mappers/geojson-from-domain'
import { useRoutingStore } from '~/application/stores/routing-store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LANE_FILTER: any = ['==', ['get', 'kind'], 'lane']
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CONNECTOR_FILTER: any = ['==', ['get', 'kind'], 'connector']

export function RouteLayer() {
  const route = useRoutingStore(s => s.currentRoute)
  if (!route) return null

  return (
    <Source id="route" type="geojson" data={routeToFeatureCollection(route)}>
      {/* Lane segments — white casing + orange fill */}
      <Layer
        id="route-lane-casing"
        type="line"
        filter={LANE_FILTER}
        paint={{ 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.55 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
      <Layer
        id="route-lane-fill"
        type="line"
        filter={LANE_FILTER}
        paint={{ 'line-color': '#FF5400', 'line-width': 5, 'line-opacity': 1 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
      {/* Gap connectors — hidden for now, kept for future toggle feature */}
      <Layer
        id="route-connector"
        type="line"
        filter={CONNECTOR_FILTER}
        paint={{
          'line-color': '#FC4C02',
          'line-width': 2,
          'line-opacity': 0,
          'line-dasharray': [4, 3],
        }}
        layout={{ 'line-cap': 'butt' }}
      />
    </Source>
  )
}
