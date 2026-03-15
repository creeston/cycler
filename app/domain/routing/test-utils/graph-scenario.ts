import Graph from 'graphology'
import { readFileSync } from 'fs'
import { parseDot } from './dot-parser'
import type { BikeLaneGraph } from '../graph'

export interface ScenarioExpect {
  minRoutes?: number
  maxRoutes?: number
  minCoverage?: number
  hasGap?: boolean
  maxGaps?: number
}

export interface Scenario {
  name: string
  description: string
  graph: BikeLaneGraph
  startKey: string
  minDist: number
  maxDist: number
  expect: ScenarioExpect
}

/**
 * Loads a .dot scenario file and builds a BikeLaneGraph directly from it,
 * bypassing geographic coordinate mapping. Used to test pure graph routing logic.
 */
export function loadScenario(filePath: string): Scenario {
  const content = readFileSync(filePath, 'utf-8')
  const { name, graphAttrs: ga, edges } = parseDot(content)

  const graph: BikeLaneGraph = new Graph({ type: 'undirected', multi: false })

  // Assign each node a unique longitude so edge geometries are distinguishable.
  // The signature() deduplication in runWalks relies on geometry coordinates[0],
  // so nodes must have unique positions for route diversity to be detected correctly.
  const nodeOrder: string[] = []
  const seenNodes = new Set<string>()
  for (const edge of edges) {
    if (!seenNodes.has(edge.from)) { nodeOrder.push(edge.from); seenNodes.add(edge.from) }
    if (!seenNodes.has(edge.to)) { nodeOrder.push(edge.to); seenNodes.add(edge.to) }
  }
  for (let i = 0; i < nodeOrder.length; i++) {
    graph.mergeNode(nodeOrder[i], { lon: i * 0.001, lat: 0 })
  }

  for (const edge of edges) {
    const fromLon = graph.getNodeAttribute(edge.from, 'lon')
    const toLon = graph.getNodeAttribute(edge.to, 'lon')
    graph.mergeEdge(edge.from, edge.to, {
      distanceMeters: parseFloat(edge.attrs.distance ?? '0'),
      isGap: edge.attrs.type === 'gap',
      geometry: { type: 'LineString', coordinates: [[fromLon, 0], [toLon, 0]] },
    })
  }

  const expect: ScenarioExpect = {}
  if (ga.expect_minRoutes !== undefined) expect.minRoutes = parseInt(ga.expect_minRoutes, 10)
  if (ga.expect_maxRoutes !== undefined) expect.maxRoutes = parseInt(ga.expect_maxRoutes, 10)
  if (ga.expect_minCoverage !== undefined) expect.minCoverage = parseFloat(ga.expect_minCoverage)
  if (ga.expect_hasGap !== undefined) expect.hasGap = ga.expect_hasGap === 'true'
  if (ga.expect_maxGaps !== undefined) expect.maxGaps = parseInt(ga.expect_maxGaps, 10)

  return {
    name,
    description: ga.description ?? '',
    graph,
    startKey: ga.start ?? edges[0]?.from ?? '',
    minDist: parseFloat(ga.minDist ?? '100'),
    maxDist: parseFloat(ga.maxDist ?? '100000'),
    expect,
  }
}
