import Graph from 'graphology'
import { readFileSync } from 'fs'
import { BARRIER_COST_MULTIPLIER, gapPenaltyFactor } from '../graph'
import { DEFAULT_PREFERENCES } from '../../entities/route'
import { parseDot } from './dot-parser'
import { coordKey, haversineMeters, METERS_PER_DEGREE } from '../algorithms'
import type { BikeLaneGraph, EdgeAttrs } from '../graph'
import type { ParsedEdge } from './dot-parser'

export interface ScenarioExpect {
  minRoutes?: number
  maxRoutes?: number
  minCoverage?: number
  hasGap?: boolean
  maxGaps?: number
  /** One or more exact node sequences that must each appear in found routes. */
  routes?: string[][]
  /** At least one of these exact node sequences must appear in found routes. */
  anyRoute?: string[][]
  /** If true, at least one found route must start and end at the same node. */
  isRoundTrip?: boolean
}

export interface Scenario {
  name: string
  description: string
  graph: BikeLaneGraph
  startKey: string
  /** When set, triggers one-way routing from startKey to endKey. */
  endKey?: string
  minDist: number
  maxDist: number
  roundTrip: boolean
  /** Maps coordKey(lon, lat) → node name for route sequence verification. */
  keyToName: Map<string, string>
  expect: ScenarioExpect
}

/**
 * Longitude spacing of the line layout: the whole line spans no more than the
 * shortest edge, so the crow-flies distance between any two nodes never
 * exceeds the length of a path between them and the A* heuristic stays
 * admissible. Capped so nodes without a short edge are not spread far apart.
 */
function lineSpacingDegrees(edges: ParsedEdge[], nodeCount: number): number {
  const lengths = edges.map(e => parseFloat(e.attrs.distance ?? '0')).filter(d => d > 0)
  if (lengths.length === 0 || nodeCount < 2) return MAX_LINE_SPACING_DEGREES
  const spacing = Math.min(...lengths) / (nodeCount - 1) / METERS_PER_DEGREE
  if (spacing < MIN_LINE_SPACING_DEGREES) {
    throw new Error(
      `Line layout cannot keep ${nodeCount} nodes distinct and the heuristic admissible; give nodes x/y positions`,
    )
  }
  return Math.min(spacing, MAX_LINE_SPACING_DEGREES)
}

const MAX_LINE_SPACING_DEGREES = 0.001
/** Two grid cells of coordKey, so neighbouring nodes never snap to the same key. */
const MIN_LINE_SPACING_DEGREES = 0.00002

/**
 * Loads a .dot scenario file and builds a BikeLaneGraph directly from it,
 * bypassing geographic coordinate mapping. Used to test pure graph routing logic.
 *
 * A node declared as `A [x=120, y=-40]` sits that many metres east and north
 * of the origin, on the equator; an edge between two such nodes defaults its
 * `distance` to the crow-flies distance. Nodes without a position are placed
 * along a line (lineSpacingDegrees), which keeps every node distinguishable
 * after coordKey snapping while keeping the A* heuristic admissible.
 */
export function loadScenario(filePath: string): Scenario {
  const content = readFileSync(filePath, 'utf-8')
  const { name, graphAttrs: ga, nodes, edges } = parseDot(content)

  const graph: BikeLaneGraph = new Graph({ type: 'undirected', multi: false })

  const nodeOrder: string[] = []
  const seenNodes = new Set<string>()
  for (const edge of edges) {
    if (!seenNodes.has(edge.from)) {
      nodeOrder.push(edge.from)
      seenNodes.add(edge.from)
    }
    if (!seenNodes.has(edge.to)) {
      nodeOrder.push(edge.to)
      seenNodes.add(edge.to)
    }
  }
  const spacing = lineSpacingDegrees(edges, nodeOrder.length)
  for (let i = 0; i < nodeOrder.length; i++) {
    const declared = nodes[nodeOrder[i]]
    if (declared?.x !== undefined && declared.y !== undefined) {
      graph.mergeNode(nodeOrder[i], {
        lon: parseFloat(declared.x) / METERS_PER_DEGREE,
        lat: parseFloat(declared.y) / METERS_PER_DEGREE,
      })
    } else {
      graph.mergeNode(nodeOrder[i], { lon: i * spacing, lat: 0 })
    }
  }

  for (const edge of edges) {
    const from = graph.getNodeAttributes(edge.from)
    const to = graph.getNodeAttributes(edge.to)
    const positioned = nodes[edge.from]?.x !== undefined && nodes[edge.to]?.x !== undefined
    const distanceMeters =
      edge.attrs.distance !== undefined
        ? parseFloat(edge.attrs.distance)
        : positioned
          ? haversineMeters(from.lon, from.lat, to.lon, to.lat)
          : 0
    // `barrier=major_road|railway|water` marks a gap the router should avoid.
    const barrier = edge.attrs.barrier as EdgeAttrs['barrier']
    const isGap = edge.attrs.type === 'gap'
    // Scenario graphs carry no tolerance of their own, so gaps are priced
    // against the default one — enough to rank a gap against a lane.
    const penalty =
      (isGap ? gapPenaltyFactor(distanceMeters, DEFAULT_PREFERENCES.maxGapMeters) : 1) *
      (barrier ? BARRIER_COST_MULTIPLIER : 1)
    graph.mergeEdge(edge.from, edge.to, {
      startKey: edge.from,
      endKey: edge.to,
      distanceMeters,
      costMeters: distanceMeters * penalty,
      isGap,
      ...(barrier ? { barrier } : {}),
      geometry: {
        type: 'LineString',
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
      },
    })
  }

  // Build reverse map: coordKey(lon, lat) → node name for route verification
  const keyToName = new Map<string, string>()
  graph.forEachNode((nodeName, attrs) => {
    keyToName.set(coordKey(attrs.lon, attrs.lat), nodeName)
  })

  const expect: ScenarioExpect = {}
  if (ga.expect_minRoutes !== undefined) expect.minRoutes = parseInt(ga.expect_minRoutes, 10)
  if (ga.expect_maxRoutes !== undefined) expect.maxRoutes = parseInt(ga.expect_maxRoutes, 10)
  if (ga.expect_minCoverage !== undefined) expect.minCoverage = parseFloat(ga.expect_minCoverage)
  if (ga.expect_hasGap !== undefined) expect.hasGap = ga.expect_hasGap === 'true'
  if (ga.expect_maxGaps !== undefined) expect.maxGaps = parseInt(ga.expect_maxGaps, 10)
  if (ga.expect_isRoundTrip !== undefined) expect.isRoundTrip = ga.expect_isRoundTrip === 'true'
  if (ga.expect_route !== undefined) {
    expect.routes = ga.expect_route.split(';').map(r => r.trim().split(','))
  }
  if (ga.expect_any_route !== undefined) {
    expect.anyRoute = ga.expect_any_route.split(';').map(r => r.trim().split(','))
  }

  return {
    name,
    description: ga.description ?? '',
    graph,
    startKey: ga.start ?? edges[0]?.from ?? '',
    endKey: ga.end,
    minDist: parseFloat(ga.minDist ?? '100'),
    maxDist: parseFloat(ga.maxDist ?? '100000'),
    roundTrip: ga.roundTrip === 'true',
    keyToName,
    expect,
  }
}
