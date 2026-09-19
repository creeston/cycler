import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import { bikeLanesToFeatureCollection } from '~/domain/mappers/geojson-from-domain'
import { expandBbox, lineIntersectsBbox } from '~/domain/entities/area'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'

/**
 * How far beyond the visible map lanes are still drawn, as a multiple of the
 * view's own span. Enough that a short pan finds lanes already there, small
 * enough that a city's worth of geometry never reaches MapLibre at once.
 */
const RENDER_MARGIN = 0.25

export function BikeLaneLayer() {
  const bikeLanes = useMapStore(s => s.bikeLanes)
  const bbox = useMapStore(s => s.bbox)
  const hasRoute = useRoutingStore(s => s.currentRoute !== null)

  // Rebuilt only when the lanes or the box change. Without the memo this runs
  // on every render of the map — including every frame of a pan — and each new
  // object identity makes MapLibre re-parse the whole source.
  const data = useMemo(() => {
    if (bikeLanes.length === 0) return null
    if (!bbox) return bikeLanesToFeatureCollection(bikeLanes)

    const view = expandBbox(bbox, RENDER_MARGIN)
    return bikeLanesToFeatureCollection(
      bikeLanes.filter(lane => lineIntersectsBbox(lane.geometry.coordinates, view)),
    )
  }, [bikeLanes, bbox])

  if (!data) return null

  return (
    <Source id="bike-lanes" type="geojson" data={data}>
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
