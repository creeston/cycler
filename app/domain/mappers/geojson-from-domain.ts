import type { FeatureCollection } from 'geojson'
import type { BikeLane } from '../entities/bike-lane'
import type { Route } from '../entities/route'

export function bikeLanesToFeatureCollection(lanes: BikeLane[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lanes.map(lane => ({
      type: 'Feature',
      geometry: lane.geometry,
      properties: { id: lane.osmId, laneType: lane.laneType, name: lane.name ?? null },
    })),
  }
}

/**
 * Returns a FeatureCollection with two kinds of features:
 *  kind='lane'      — the actual bike-lane segments of the route
 *  kind='connector' — straight-line gaps between consecutive segments
 *
 * Keeping both in one source lets MapLibre filter and style them in separate
 * layers without managing two data sources.
 */
export function routeToFeatureCollection(route: Route): FeatureCollection {
  const laneFeatures = route.segments.map((seg, i) => ({
    type: 'Feature' as const,
    geometry: seg.geometry,
    properties: { kind: 'lane', index: i, type: seg.type },
  }))

  const connectorFeatures = route.segments.slice(0, -1).map((seg, i) => {
    const fromCoord = seg.geometry.coordinates[seg.geometry.coordinates.length - 1]
    const toCoord = route.segments[i + 1].geometry.coordinates[0]
    return {
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: [fromCoord, toCoord] },
      properties: { kind: 'connector', index: i },
    }
  })

  return { type: 'FeatureCollection', features: [...laneFeatures, ...connectorFeatures] }
}
