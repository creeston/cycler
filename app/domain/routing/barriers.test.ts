import { describe, it, expect } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { buildBarrierIndex, findBlockingBarrier } from './barriers'
import { geojsonToBarriers, osmLevel } from '../mappers/osm-to-barriers'
import type { BarrierData } from '../entities/barrier'

/**
 * All fixtures sit near the equator so that a degree of longitude and a degree
 * of latitude are the same length: 0.0001° ≈ 11 m. The road runs north–south
 * along lon 0.001 and every gap runs west–east across it.
 */
const ROAD_LON = 0.001

describe('findBlockingBarrier', () => {
  it('vetoes a gap that crosses a major road', () => {
    const index = buildBarrierIndex(fromFeatures([road('primary')]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBe('major_road')
  })

  it('leaves a gap that stays clear of the road alone', () => {
    const index = buildBarrierIndex(fromFeatures([road('primary')]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0009, 0)).toBeNull()
  })

  it('vetoes a gap that crosses a river', () => {
    const index = buildBarrierIndex(fromFeatures([river()]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBe('water')
  })

  it('vetoes a gap that crosses the bank of a water body', () => {
    const index = buildBarrierIndex(fromFeatures([lake()]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBe('water')
  })

  it('vetoes a gap that crosses a railway', () => {
    const index = buildBarrierIndex(fromFeatures([railway()]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBe('railway')
  })

  it('allows a gap that crosses at a marked crossing', () => {
    const index = buildBarrierIndex(fromFeatures([road('primary'), crossingNode(ROAD_LON, 0)]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBeNull()
  })

  it('allows a gap that crosses a railway at a level crossing', () => {
    const index = buildBarrierIndex(fromFeatures([railway(), levelCrossingNode(ROAD_LON, 0)]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBeNull()
  })

  it('allows a gap that crosses a river on a bridge', () => {
    const bridge = {
      type: 'Feature' as const,
      properties: { '@id': 'way/bridge', highway: 'residential', bridge: 'yes' },
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0.0005, 0],
          [0.0015, 0],
        ],
      },
    }
    const index = buildBarrierIndex(fromFeatures([river(), bridge]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBeNull()
  })

  it('still vetoes when the crossing is 60 m up the road', () => {
    const index = buildBarrierIndex(
      fromFeatures([road('primary'), crossingNode(ROAD_LON, 0.00055)]),
    )
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBe('major_road')
  })

  it('still vetoes when the nearby crossing belongs to a different road', () => {
    // A crossing 11 m away, but on the side street rather than on the arterial.
    const sideStreet = {
      type: 'Feature' as const,
      properties: { '@id': 'way/side', highway: 'residential' },
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0.0011, -0.0005],
          [0.0011, 0.0005],
        ],
      },
    }
    const index = buildBarrierIndex(
      fromFeatures([road('primary'), sideStreet, crossingNode(0.0011, 0)]),
    )
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBe('major_road')
  })

  it('ignores a road that is on a bridge where the gap passes under it', () => {
    const index = buildBarrierIndex(fromFeatures([road('primary', { bridge: 'yes' })]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBeNull()
  })

  it('ignores a minor road', () => {
    const index = buildBarrierIndex(fromFeatures([road('residential')]))
    expect(findBlockingBarrier(index, 0.0005, 0, 0.0015, 0)).toBeNull()
  })

  it('finds barriers far from the origin, where the index cells differ', () => {
    const index = buildBarrierIndex(fromFeatures([road('trunk', {}, 52.29)]))
    expect(findBlockingBarrier(index, 0.0005, 52.29, 0.0015, 52.29)).toBe('major_road')
  })
})

describe('geojsonToBarriers', () => {
  it('classifies each barrier kind and keeps crossings apart', () => {
    const data = fromFeatures([
      road('motorway'),
      railway(),
      river(),
      lake(),
      crossingNode(ROAD_LON, 0),
    ])
    expect(data.barriers.map(b => b.kind).sort()).toEqual([
      'major_road',
      'railway',
      'water',
      'water',
    ])
    expect(data.crossings).toHaveLength(1)
  })

  it('drops a grade-separated barrier instead of recording it', () => {
    const data = fromFeatures([road('primary', { tunnel: 'yes' })])
    expect(data.barriers).toHaveLength(0)
    expect(data.crossings).toHaveLength(0)
  })
})

describe('osmLevel', () => {
  it('reads an explicit layer', () => {
    expect(osmLevel({ layer: '-2' })).toBe(-2)
  })

  it('puts an untagged bridge above ground and a tunnel below it', () => {
    expect(osmLevel({ bridge: 'yes' })).toBe(1)
    expect(osmLevel({ tunnel: 'yes' })).toBe(-1)
  })

  it('defaults to ground level', () => {
    expect(osmLevel({ highway: 'cycleway' })).toBe(0)
  })
})

function fromFeatures(features: FeatureCollection['features']): BarrierData {
  return geojsonToBarriers({ type: 'FeatureCollection', features })
}

function road(
  highway: string,
  extraTags: Record<string, string> = {},
  lat = 0,
): FeatureCollection['features'][number] {
  return {
    type: 'Feature',
    properties: { '@id': `way/${highway}`, highway, ...extraTags },
    geometry: {
      type: 'LineString',
      coordinates: [
        [ROAD_LON, lat - 0.001],
        [ROAD_LON, lat + 0.001],
      ],
    },
  }
}

function railway(): FeatureCollection['features'][number] {
  return {
    type: 'Feature',
    properties: { '@id': 'way/rail', railway: 'rail' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [ROAD_LON, -0.001],
        [ROAD_LON, 0.001],
      ],
    },
  }
}

function river(): FeatureCollection['features'][number] {
  return {
    type: 'Feature',
    properties: { '@id': 'way/river', waterway: 'river' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [ROAD_LON, -0.001],
        [ROAD_LON, 0.001],
      ],
    },
  }
}

function lake(): FeatureCollection['features'][number] {
  return {
    type: 'Feature',
    properties: { '@id': 'way/lake', natural: 'water' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [ROAD_LON, -0.001],
          [0.003, -0.001],
          [0.003, 0.001],
          [ROAD_LON, 0.001],
          [ROAD_LON, -0.001],
        ],
      ],
    },
  }
}

function crossingNode(lon: number, lat: number): FeatureCollection['features'][number] {
  return {
    type: 'Feature',
    properties: { '@id': 'node/crossing', highway: 'crossing' },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  }
}

function levelCrossingNode(lon: number, lat: number): FeatureCollection['features'][number] {
  return {
    type: 'Feature',
    properties: { '@id': 'node/level', railway: 'level_crossing' },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  }
}
