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

/** Returns one GeoJSON feature per route segment for type-based map styling. */
export function routeToFeatureCollection(route: Route): FeatureCollection {
  const features = route.segments.map((seg, i) => ({
    type: 'Feature' as const,
    geometry: seg.geometry,
    properties: { index: i, type: seg.type },
  }))

  return { type: 'FeatureCollection', features }
}
