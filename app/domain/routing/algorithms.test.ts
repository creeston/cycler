import { describe, it, expect } from 'vitest'
import { coordKey } from './algorithms'
import { buildGraph, getGapStats, nearestNode } from './graph'
import type { BikeLane } from '../entities/bike-lane'
import type { BikeLaneGraph } from './graph'

function makeLane(id: string, coords: [number, number][]): BikeLane {
  return {
    id,
    osmId: id,
    geometry: { type: 'LineString', coordinates: coords },
    laneType: 'cycleway',
    tags: {},
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
    const g = buildGraph(spacedLanes(), 30, 2)
    expect(getGapStats(g)).toMatchObject({ candidates: 5, kept: 5 })

    const limited = buildGraph(spacedLanes(), 30, 1)
    expect(getGapStats(limited)).toMatchObject({
      candidates: 5,
      kept: 3,
      droppedBeyondLimit: 2,
    })
  })

  it('restores a dropped candidate when nothing else connects the two components', () => {
    // At k=1 the two pairs saturate their endpoints, so the edge joining the
    // pairs is only kept because connectivity needs it.
    const g = buildGraph(spacedLanes(), 30, 1)
    expect(getGapStats(g).keptForConnectivity).toBe(1)
    expect(countComponents(g)).toBe(1)
  })

  it('leaves stats empty when gap bridging is off', () => {
    const g = buildGraph(spacedLanes(), 0)
    expect(getGapStats(g)).toMatchObject({ candidates: 0, kept: 0 })
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
