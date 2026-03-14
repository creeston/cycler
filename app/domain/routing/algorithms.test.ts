import { describe, it, expect } from 'vitest'
import { coordKey } from './algorithms'
import { buildGraph, nearestNode } from './graph'
import { findRoutes } from './route-finder'
import type { BikeLane } from '../entities/bike-lane'
import type { RoutePreferences } from '../entities/route'

function makeLane(id: string, coords: [number, number][]): BikeLane {
  return { id, osmId: id, geometry: { type: 'LineString', coordinates: coords }, laneType: 'cycleway', tags: {} }
}

const PREFS: RoutePreferences = {
  maxGapMeters: 200,
  minDistanceMeters: 100,
  maxDistanceMeters: 100_000,
  roundTrip: false,
}

// ── coordKey ──────────────────────────────────────────────────────────────────

describe('coordKey', () => {
  it('snaps coordinates within the same ~1 m bucket to the same key', () => {
    expect(coordKey(13.40000, 52.50000)).toBe(coordKey(13.400002, 52.500002))
  })

  it('produces different keys for distant coordinates', () => {
    expect(coordKey(13.4, 52.5)).not.toBe(coordKey(14.4, 52.5))
  })
})

// ── buildGraph ────────────────────────────────────────────────────────────────

describe('buildGraph', () => {
  it('creates a node for each unique lane endpoint', () => {
    const lanes = [makeLane('a', [[0, 0], [1, 0]]), makeLane('b', [[2, 0], [3, 0]])]
    const g = buildGraph(lanes, 0)
    expect(g.order).toBe(4) // 4 unique endpoints
  })

  it('creates an edge for each lane', () => {
    const lanes = [makeLane('a', [[0, 0], [1, 0]])]
    const g = buildGraph(lanes, 0)
    expect(g.size).toBe(1)
    expect(g.getEdgeAttribute(g.edges()[0], 'isGap')).toBe(false)
  })

  it('merges nodes when two lanes share an endpoint', () => {
    const a = makeLane('a', [[0, 0], [1, 0]])
    const b = makeLane('b', [[1, 0], [2, 0]])
    const g = buildGraph([a, b], 0)
    expect(g.order).toBe(3) // shared node at [1,0]
    expect(g.size).toBe(2)
  })

  it('adds gap edges between nodes within maxGapMeters', () => {
    // Two lanes whose endpoints are ~111 m apart in latitude
    const a = makeLane('a', [[0, 0], [0, 0.0005]])
    const b = makeLane('b', [[0, 0.002], [0, 0.003]])
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

// ── nearestNode ───────────────────────────────────────────────────────────────

describe('nearestNode', () => {
  it('returns the key of the closest node', () => {
    const lanes = [makeLane('a', [[0, 0], [10, 0]])]
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

// ── findRoutes ────────────────────────────────────────────────────────────────

describe('findRoutes', () => {
  it('returns an empty array when there are no lanes', () => {
    expect(findRoutes([], 0, 0, PREFS)).toEqual([])
  })

  it('returns routes whose distance is within [min, max]', () => {
    // Build a chain of lanes long enough to reach 100 m minimum
    // Each segment: ~111 m (0.001° latitude ≈ 111 m)
    const lanes = Array.from({ length: 10 }, (_, i) =>
      makeLane(String(i), [[0, i * 0.001], [0, (i + 1) * 0.001]]),
    )
    const routes = findRoutes(lanes, 0, 0, PREFS)
    for (const r of routes) {
      expect(r.totalDistanceMeters).toBeGreaterThanOrEqual(PREFS.minDistanceMeters)
      expect(r.totalDistanceMeters).toBeLessThanOrEqual(PREFS.maxDistanceMeters)
    }
  })

  it('route segments reference valid geometries', () => {
    const lanes = Array.from({ length: 5 }, (_, i) =>
      makeLane(String(i), [[0, i * 0.001], [0, (i + 1) * 0.001]]),
    )
    const routes = findRoutes(lanes, 0, 0, PREFS)
    if (routes.length > 0) {
      for (const seg of routes[0].segments) {
        expect(seg.geometry.type).toBe('LineString')
        expect(seg.geometry.coordinates.length).toBeGreaterThanOrEqual(2)
      }
    }
  })
})
