/**
 * Gap pruning against the real Warsaw Bemowo export.
 *
 * buildGraph keeps only a fraction of the endpoint pairs within maxGapMeters
 * (see graph.ts). These tests pin the two properties that pruning must not
 * break: the graph stays as connected as an unpruned build, and the router
 * still finds many distinct routes.
 *
 * buildGraphUnpruned at the bottom of this file is the pre-pruning algorithm,
 * kept as the baseline to compare against.
 *
 * Since lanes are split at shared vertices (task 09) the lane graph alone is
 * almost connected, so at the default 200 m only a handful of gaps survive;
 * the numbers below are re-measured from that state.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { FeatureCollection } from 'geojson'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { buildGraph, getGapStats, nodesWithinMeters } from '~/domain/routing/graph'
import type { BikeLaneGraph } from '~/domain/routing/graph'
import { osmLevel } from '~/domain/mappers/osm-to-barriers'
import { routeSignature, runExplore, runRoundTrip } from '~/domain/routing/route-finder'
import type { BikeLane } from '~/domain/entities/bike-lane'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, '../domain/routing/scenarios/overpass-data.geojson')

const START_LON = 20.93628
const START_LAT = 52.290873
const GAP_TOLERANCES = [50, 100, 200, 500]

let lanes: BikeLane[]

beforeAll(() => {
  const fc = JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as FeatureCollection
  lanes = geojsonToBikeLanes(fc)
})

describe('gap pruning — Warsaw overpass data', () => {
  it.each(GAP_TOLERANCES)(
    'reaches the same connected component count as an unpruned build at %i m',
    maxGap => {
      const pruned = countComponents(buildGraph(lanes, maxGap))
      const unpruned = countComponents(buildGraphUnpruned(lanes, maxGap))
      expect(pruned).toBe(unpruned)
    },
  )

  it('keeps under a quarter of the gap edges an unpruned build would add', () => {
    const pruned = countGapEdges(buildGraph(lanes, 200))
    const unpruned = countGapEdges(buildGraphUnpruned(lanes, 200))
    // Measured: 441 of 2 303 — an 80.9 % drop.
    expect(pruned).toBeLessThan(unpruned * 0.25)
  })

  it.each(GAP_TOLERANCES)(
    'adds no gap between nodes lane edges already connect at %i m',
    maxGap => {
      const graph = buildGraph(lanes, maxGap)
      const laneComponent = laneOnlyComponents(graph)

      graph.forEachEdge((_key, attrs, source, target) => {
        if (!attrs.isGap) return
        expect(
          laneComponent.get(source),
          `gap edge ${source}--${target} joins nodes already connected by lanes`,
        ).not.toBe(laneComponent.get(target))
      })
    },
  )

  it('reports candidates, kept edges and the reason for each drop', () => {
    // At 200 m no node reaches the per-node limit (6 gaps kept); 500 m exercises every rule.
    const graph = buildGraph(lanes, 500)
    const stats = getGapStats(graph)

    expect(stats.kept).toBe(countGapEdges(graph))
    expect(stats.candidates).toBe(
      stats.kept +
        stats.droppedGradeSeparated +
        stats.droppedSameComponent +
        stats.droppedBeyondLimit,
    )
    expect(stats.droppedSameComponent).toBeGreaterThan(0)
    expect(stats.droppedBeyondLimit).toBeGreaterThan(0)
  })

  it('still finds many distinct explore routes', () => {
    // Measured: 126 routes; explore is deterministic.
    expect(countRoutes(buildGraph(lanes, 200), false)).toBeGreaterThan(20)
  })

  it('still finds many distinct round-trip routes', () => {
    // Measured: 14 distinct loops at 200 m with seed 42; the random walk this
    // replaced found 3.2 on average and needed the 1 000 m fallback.
    expect(countRoutes(buildGraph(lanes, 200), true)).toBeGreaterThan(5)
  })
})

function countGapEdges(graph: BikeLaneGraph): number {
  return graph.filterEdges((_key, attrs) => attrs.isGap).length
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

/** Maps each node to a component id derived from lane edges only. */
function laneOnlyComponents(graph: BikeLaneGraph): Map<string, string> {
  const component = new Map<string, string>()

  for (const node of graph.nodes()) {
    if (component.has(node)) continue
    component.set(node, node)
    const stack = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      for (const neighbour of graph.neighbors(current)) {
        if (component.has(neighbour)) continue
        if (graph.getEdgeAttribute(graph.edge(current, neighbour), 'isGap')) continue
        component.set(neighbour, node)
        stack.push(neighbour)
      }
    }
  }

  return component
}

function countRoutes(graph: BikeLaneGraph, roundTrip: boolean): number {
  const signatures = new Set<string>()

  for (const startKey of nodesWithinMeters(graph, START_LON, START_LAT, 300)) {
    const routes = roundTrip
      ? runRoundTrip(graph, startKey, 2_000, 10_000, 42)
      : runExplore(graph, startKey, 2_000, 10_000)
    for (const route of routes) {
      signatures.add(routeSignature(route.segments))
    }
  }

  return signatures.size
}

function shareLevel(a: Set<number> | undefined, b: Set<number> | undefined): boolean {
  if (!a || !b) return true
  return [...a].some(level => b.has(level))
}

function approxMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const avgLat = (((lat1 + lat2) / 2) * Math.PI) / 180
  return R * Math.sqrt(dLat * dLat + (dLon * Math.cos(avgLat)) ** 2)
}

/**
 * The pre-pruning graph builder: every node pair within maxGapMeters that no
 * lane edge joins becomes a gap edge. Lane edges come from buildGraph itself,
 * so the baseline shares the lane splitting and the comparison isolates pruning.
 *
 * It applies one rule that is not pruning: lanes on different levels are never
 * bridged (task 28). That is a correctness rule about what a connection is, so
 * the baseline has to honour it. Levels are read back from the lane edges.
 */
function buildGraphUnpruned(lanes: BikeLane[], maxGapMeters: number): BikeLaneGraph {
  const graph = buildGraph(lanes, 0)

  const levels = new Map<string, Set<number>>()
  graph.forEachEdge((_key, attrs, source, target) => {
    const level = osmLevel(attrs.tags ?? {})
    for (const key of [source, target]) {
      const known = levels.get(key)
      if (known) known.add(level)
      else levels.set(key, new Set([level]))
    }
  })

  const nodes = graph.nodes()
  const attrs = nodes.map(key => graph.getNodeAttributes(key))

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (graph.hasEdge(nodes[i], nodes[j])) continue
      const a = attrs[i]
      const b = attrs[j]
      const distanceMeters = approxMeters(a.lon, a.lat, b.lon, b.lat)
      if (distanceMeters > maxGapMeters) continue
      if (!shareLevel(levels.get(nodes[i]), levels.get(nodes[j]))) continue
      graph.addEdge(nodes[i], nodes[j], {
        startKey: nodes[i],
        endKey: nodes[j],
        distanceMeters,
        costMeters: distanceMeters,
        isGap: true,
        geometry: {
          type: 'LineString',
          coordinates: [
            [a.lon, a.lat],
            [b.lon, b.lat],
          ],
        },
      })
    }
  }

  return graph
}
