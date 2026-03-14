import { describe, it, expect } from 'vitest'
import type { FeatureCollection, Feature, LineString } from 'geojson'
import { geojsonToBikeLanes } from './osm-to-domain'

function makeLineFeature(
  props: Record<string, string>,
  coords = [[0, 0], [1, 1]] as [number, number][],
): Feature<LineString> {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: props,
  }
}

function makeFC(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features }
}

describe('geojsonToBikeLanes', () => {
  it('filters out non-LineString features', () => {
    const fc = makeFC([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { highway: 'cycleway' },
      },
      makeLineFeature({ highway: 'cycleway' }),
    ])
    const result = geojsonToBikeLanes(fc)
    expect(result).toHaveLength(1)
  })

  it('maps highway=cycleway to laneType cycleway', () => {
    const fc = makeFC([makeLineFeature({ highway: 'cycleway' })])
    const [lane] = geojsonToBikeLanes(fc)
    expect(lane.laneType).toBe('cycleway')
  })

  it('maps cycleway=track to laneType track', () => {
    const fc = makeFC([makeLineFeature({ highway: 'residential', cycleway: 'track' })])
    const [lane] = geojsonToBikeLanes(fc)
    expect(lane.laneType).toBe('track')
  })

  it('maps cycleway=lane to laneType lane', () => {
    const fc = makeFC([makeLineFeature({ highway: 'primary', cycleway: 'lane' })])
    const [lane] = geojsonToBikeLanes(fc)
    expect(lane.laneType).toBe('lane')
  })

  it('preserves name and surface tags', () => {
    const fc = makeFC([makeLineFeature({ highway: 'cycleway', name: 'Bike Path 1', surface: 'asphalt' })])
    const [lane] = geojsonToBikeLanes(fc)
    expect(lane.name).toBe('Bike Path 1')
    expect(lane.surface).toBe('asphalt')
  })

  it('returns an empty array for an empty FeatureCollection', () => {
    expect(geojsonToBikeLanes(makeFC([]))).toEqual([])
  })
})
