import { Source, Layer } from 'react-map-gl/maplibre'
import { bikeLanesToFeatureCollection } from '~/domain/mappers/geojson-from-domain'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'

export function BikeLaneLayer() {
  const bikeLanes = useMapStore(s => s.bikeLanes)
  const hasRoute = useRoutingStore(s => s.currentRoute !== null)

  if (bikeLanes.length === 0) return null

  return (
    <Source id="bike-lanes" type="geojson" data={bikeLanesToFeatureCollection(bikeLanes)}>
      <Layer
        id="bike-lanes-casing"
        type="line"
        paint={{ 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': hasRoute ? 0.3 : 0.6 }}
      />
      <Layer
        id="bike-lanes-fill"
        type="line"
        paint={{ 'line-color': '#f86324', 'line-width': 3, 'line-opacity': hasRoute ? 0.3 : 0.85 }}
      />
    </Source>
  )
}
