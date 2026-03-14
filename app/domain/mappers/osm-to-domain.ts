import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { BikeLane, LaneType } from '../entities/bike-lane'

function resolveLaneType(props: Record<string, string>): LaneType {
  if (props['highway'] === 'cycleway') return 'cycleway'
  if (props['cycleway'] === 'track' || props['cycleway:left'] === 'track' || props['cycleway:right'] === 'track')
    return 'track'
  if (props['cycleway'] === 'lane' || props['cycleway:left'] === 'lane' || props['cycleway:right'] === 'lane')
    return 'lane'
  if (props['cycleway'] === 'shared_lane') return 'shared'
  return 'path'
}

function featureToBikeLane(feature: Feature<LineString>): BikeLane {
  const props = (feature.properties ?? {}) as Record<string, string>
  return {
    id: crypto.randomUUID(),
    osmId: String(props['id'] ?? props['@id'] ?? ''),
    geometry: feature.geometry,
    laneType: resolveLaneType(props),
    name: props['name'],
    surface: props['surface'],
    tags: props,
  }
}

export function geojsonToBikeLanes(fc: FeatureCollection): BikeLane[] {
  return fc.features
    .filter((f): f is Feature<LineString> => f.geometry?.type === 'LineString')
    .map(featureToBikeLane)
}
