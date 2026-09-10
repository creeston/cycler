import { describe, it, expect } from 'vitest'
import { coordKey } from './algorithms'
import {
  BARRIER_COST_MULTIPLIER,
  GAP_PENALTY_FACTOR,
  buildGraph,
  gapPenaltyFactor,
  getGapStats,
  getMaxGapMeters,
  nearestNode,
} from './graph'
import { geojsonToBarriers } from '../mappers/osm-to-barriers'
import type { BikeLane } from '../entities/bike-lane'
import type { BikeLaneGraph } from './graph'

function makeLane(
  id: string,
  coords: [number, number][],
  tags: Record<string, string> = {},
): BikeLane {
  return {
    id,
    osmId: id,
    geometry: { type: 'LineString', coordinates: coords },
    laneType: 'cycleway',
    tags,
  }
}

// ── coordKey ──────────────────────────────────────────────────────────────────

describe('coordKey', () => {
  it('snaps coordinates within the same ~1 m bucket to the same key', () => {
    expect(coordKey(13.4, 52.5)).toBe(coordKey(13.400002, 52.500002))
  })

  it('produces different keys for distant coordinates', () => {
    expect(coordKey(13.4, 52.5)).not.toBe(coordKey(14.4, 52.5))
  })
})

// ── buildGraph ────────────────────────────────────────────────────────────────

describe('buildGraph', () => {
  it('creates a node for each unique lane endpoint', () => {
    const lanes = [
      makeLane('a', [
        [0, 0],
        [1, 0],
      ]),
      makeLane('b', [
        [2, 0],
        [3, 0],
      ]),
    ]
    const g = buildGraph(lanes, 0)
    expect(g.order).toBe(4) // 4 unique endpoints
  })

  it('creates an edge for each lane', () => {
    const lanes = [
      makeLane('a', [
        [0, 0],
        [1, 0],
      ]),
    ]
    const g = buildGraph(lanes, 0)
    expect(g.size).toBe(1)
    expect(g.getEdgeAttribute(g.edges()[0], 'isGap')).toBe(false)
  })

  it('merges nodes when two lanes share an endpoint', () => {
    const a = makeLane('a', [
      [0, 0],
      [1, 0],
    ])
    const b = makeLane('b', [
      [1, 0],
      [2, 0],
    ])
    const g = buildGraph([a, b], 0)
    expect(g.order).toBe(3) // shared node at [1,0]
    expect(g.size).toBe(2)
  })

  it('adds gap edges between nodes within maxGapMeters', () => {
    // Two lanes whose endpoints are ~111 m apart in latitude
    const a = makeLane('a', [
      [0, 0],
      [0, 0.0005],
    ])
    const b = makeLane('b', [
      [0, 0.002],
      [0, 0.003],
    ])
    const gNoGap = buildGraph([a, b], 0)
    const gWithGap = buildGraph([a, b], 300)
    // Without gap tolerance: 4 nodes, 2 lane edges, no gap edges
    expect(gNoGap.size).toBe(2)
    // With 300 m gap: the ~111 m gap between a's end and b's start is bridged
    expect(gWithGap.size).toBeGreaterThan(2)
    const gapEdges = gWithGap.filterEdges((_k, a) => a.isGap)
    expect(gapEdges.length).toBeGreaterThan(0)
  })
})

// ── gap pruning ──────────────────────────────────────────────

describe('buildGraph gap pruning', () => {
  it('adds no gap between endpoints that lane edges already connect', () => {
    // A─B─C─D, each lane ~56 m, so A–C, A–D and B–D are all within 200 m.
    const lanes = [
      makeLane('a', [
        [0, 0],
        [0.0005, 0],
      ]),
      makeLane('b', [
        [0.0005, 0],
        [0.001, 0],
      ]),
      makeLane('c', [
        [0.001, 0],
        [0.0015, 0],
      ]),
    ]
    const g = buildGraph(lanes, 200)
    expect(g.size).toBe(3)
    expect(getGapStats(g)).toMatchObject({ candidates: 3, kept: 0, droppedSameComponent: 3 })
  })

  it('keeps a gap that is the only link between two lane components', () => {
    const a = makeLane('a', [
      [0, 0],
      [0, 0.0005],
    ])
    const b = makeLane('b', [
      [0, 0.002],
      [0, 0.003],
    ])
    const g = buildGraph([a, b], 300)
    expect(g.hasEdge(coordKey(0, 0.0005), coordKey(0, 0.002))).toBe(true)
    expect(countComponents(g)).toBe(1)
  })

  it('drops the longest candidate when both endpoints already have nearer gaps', () => {
    const g = buildGraph(spacedLanes(), 30, { maxGapsPerNode: 2 })
    expect(getGapStats(g)).toMatchObject({ candidates: 5, kept: 5 })

    const limited = buildGraph(spacedLanes(), 30, { maxGapsPerNode: 1 })
    expect(getGapStats(limited)).toMatchObject({
      candidates: 5,
      kept: 3,
      droppedBeyondLimit: 2,
    })
  })

  it('restores a dropped candidate when nothing else connects the two components', () => {
    // At k=1 the two pairs saturate their endpoints, so the edge joining the
    // pairs is only kept because connectivity needs it.
    const g = buildGraph(spacedLanes(), 30, { maxGapsPerNode: 1 })
    expect(getGapStats(g).keptForConnectivity).toBe(1)
    expect(countComponents(g)).toBe(1)
  })

  it('leaves stats empty when gap bridging is off', () => {
    const g = buildGraph(spacedLanes(), 0)
    expect(getGapStats(g)).toMatchObject({ candidates: 0, kept: 0 })
  })
})

// ── gap pricing ──────────────────────────────────────────────

describe('gap pricing', () => {
  it('charges a lane edge its real length', () => {
    const g = buildGraph(severedLanes(), 200)
    const lane = g.edge(coordKey(0.0005, 0), coordKey(-0.002, 0))

    expect(g.getEdgeAttribute(lane, 'costMeters')).toBe(g.getEdgeAttribute(lane, 'distanceMeters'))
  })

  it('charges a gap edge its length times the penalty', () => {
    const g = buildGraph(severedLanes(), 200)
    const gap = g.edge(coordKey(0.0005, 0), coordKey(0.0015, 0))
    const distanceMeters = g.getEdgeAttribute(gap, 'distanceMeters')

    expect(g.getEdgeAttribute(gap, 'costMeters')).toBeCloseTo(
      distanceMeters * gapPenaltyFactor(distanceMeters, 200),
    )
    expect(g.getEdgeAttribute(gap, 'costMeters')).toBeGreaterThan(distanceMeters * 5)
  })

  it('records the tolerance the graph was built with', () => {
    expect(getMaxGapMeters(buildGraph(severedLanes(), 200))).toBe(200)
  })

  it('prices a gap at the base factor when it is vanishingly short', () => {
    expect(gapPenaltyFactor(0, 200)).toBe(GAP_PENALTY_FACTOR)
  })

  it('doubles the base factor for a gap at the full tolerance', () => {
    expect(gapPenaltyFactor(200, 200)).toBe(GAP_PENALTY_FACTOR * 2)
  })

  it('grows with gap length, so one long gap costs more than two short ones', () => {
    const long = 100 * gapPenaltyFactor(100, 200)
    const short = 2 * (50 * gapPenaltyFactor(50, 200))

    expect(long).toBeGreaterThan(short)
  })
})

// ── barrier veto ─────────────────────────────────────────────

describe('buildGraph barrier veto', () => {
  it('adds no gap between lanes that pass over one another', () => {
    // Endpoints 15 m apart, one lane at street level and one on a bridge.
    const ground = makeLane('ground', [
      [0, 0],
      [-0.003, 0],
    ])
    const overhead = makeLane(
      'overhead',
      [
        [0.00014, 0],
        [0.003, 0],
      ],
      { layer: '1' },
    )
    const g = buildGraph([ground, overhead], 200)
    expect(g.size).toBe(2)
    expect(getGapStats(g)).toMatchObject({ candidates: 1, kept: 0, droppedGradeSeparated: 1 })
  })

  it('bridges the same endpoints when both lanes are at street level', () => {
    const west = makeLane('west', [
      [0, 0],
      [-0.003, 0],
    ])
    const east = makeLane('east', [
      [0.00014, 0],
      [0.003, 0],
    ])
    const g = buildGraph([west, east], 200)
    expect(g.size).toBe(3)
    expect(getGapStats(g).droppedGradeSeparated).toBe(0)
  })

  it('marks a gap that crosses a major road and makes it expensive', () => {
    const g = buildGraph(severedLanes(), 200, { barriers: arterial() })
    const edge = g.edge(coordKey(0.0005, 0), coordKey(0.0015, 0))

    expect(edge, 'the gap edge is marked, not dropped').toBeDefined()
    expect(g.getEdgeAttribute(edge, 'barrier')).toBe('major_road')
    const distanceMeters = g.getEdgeAttribute(edge, 'distanceMeters')
    expect(g.getEdgeAttribute(edge, 'costMeters')).toBeCloseTo(
      distanceMeters * gapPenaltyFactor(distanceMeters, 200) * BARRIER_COST_MULTIPLIER,
    )
    expect(getGapStats(g)).toMatchObject({ kept: 1, barrierCrossings: 1, barriersChecked: true })
  })

  it('leaves the gap unmarked when a crossing sits on the road', () => {
    const g = buildGraph(severedLanes(), 200, { barriers: arterialWithCrossing() })
    const edge = g.edge(coordKey(0.0005, 0), coordKey(0.0015, 0))

    expect(g.getEdgeAttribute(edge, 'barrier')).toBeUndefined()
    expect(getGapStats(g)).toMatchObject({ kept: 1, barrierCrossings: 0, barriersChecked: true })
  })

  it('says nothing was checked when no barrier data is given', () => {
    const g = buildGraph(severedLanes(), 200)
    expect(getGapStats(g)).toMatchObject({ kept: 1, barrierCrossings: 0, barriersChecked: false })
  })
})

// ── nearestNode ───────────────────────────────────────────────────────────────

describe('nearestNode', () => {
  it('returns the key of the closest node', () => {
    const lanes = [
      makeLane('a', [
        [0, 0],
        [10, 0],
      ]),
    ]
    const g = buildGraph(lanes, 0)
    const key = nearestNode(g, 0.001, 0.001)
    // Nearest to (0.001, 0.001) should be the node at (0,0)
    expect(g.getNodeAttribute(key!, 'lon')).toBe(0)
  })

  it('returns null for an empty graph', () => {
    const g = buildGraph([], 0)
    expect(nearestNode(g, 0, 0)).toBeNull()
  })
})

/**
 * Four lanes whose near endpoints sit on one line at 0, 11, 28 and 39 m, and
 * whose far endpoints scatter more than 200 m away. Within a 30 m tolerance
 * this yields exactly five gap candidates: two short ones inside each pair and
 * three longer ones across the pairs.
 */
function spacedLanes(): BikeLane[] {
  return [
    makeLane('l1', [
      [0, 0],
      [-0.002, 0.002],
    ]),
    makeLane('l2', [
      [0.0001, 0],
      [0.0001, 0.002],
    ]),
    makeLane('l3', [
      [0.00025, 0],
      [0.00025, -0.002],
    ]),
    makeLane('l4', [
      [0.00035, 0],
      [0.0025, 0.0005],
    ]),
  ]
}

function countComponents(graph: BikeLaneGraph): number {
  const seen = new Set<string>()
  let components = 0

  for (const node of graph.nodes()) {
    if (seen.has(node)) continue
    components++
    const stack = [node]
    seen.add(node)
    while (stack.length > 0) {
      const current = stack.pop()!
      for (const neighbour of graph.neighbors(current)) {
        if (seen.has(neighbour)) continue
        seen.add(neighbour)
        stack.push(neighbour)
      }
    }
  }

  return components
}

/**
 * Two lanes either side of lon 0.001. Their inner endpoints are 110 m apart
 * and the outer ones run far enough away that this is the only gap candidate.
 */
function severedLanes(): BikeLane[] {
  return [
    makeLane('west', [
      [0.0005, 0],
      [-0.002, 0],
    ]),
    makeLane('east', [
      [0.0015, 0],
      [0.004, 0],
    ]),
  ]
}

function arterial() {
  return geojsonToBarriers({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { '@id': 'way/arterial', highway: 'primary' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0.001, -0.001],
            [0.001, 0.001],
          ],
        },
      },
    ],
  })
}

function arterialWithCrossing() {
  const data = arterial()
  return {
    ...data,
    crossings: [
      {
        osmId: 'node/crossing',
        kind: 'crossing' as const,
        geometry: { type: 'Point' as const, coordinates: [0.001, 0] },
      },
    ],
  }
}
