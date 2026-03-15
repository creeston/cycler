import { describe, it, expect } from 'vitest'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { loadGeoGraphScenario } from './test-utils/geo-graph-scenario'
import type { GeoGraphScenario } from './test-utils/geo-graph-scenario'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dir = join(__dirname, 'scenarios', 'geo-to-graph')
const geojson = (name: string) => join(dir, `${name}.geojson`)
const expectedDot = (name: string) => join(dir, `${name}.expected.dot`)

function checkGeoGraph(sc: GeoGraphScenario) {
  expect(sc.graph.order).toBe(sc.expectedNodeCount)
  expect(sc.graph.size).toBe(sc.expectedEdges.length)

  for (const { from, to, isGap } of sc.expectedEdges) {
    const fromKey = sc.nameToKey.get(from)
    const toKey = sc.nameToKey.get(to)
    expect(fromKey, `node "${from}" has no _nodeStart/_nodeEnd annotation in GeoJSON`).toBeDefined()
    expect(toKey, `node "${to}" has no _nodeStart/_nodeEnd annotation in GeoJSON`).toBeDefined()
    expect(
      sc.graph.hasEdge(fromKey!, toKey!),
      `expected edge ${from}--${to} (${isGap ? 'gap' : 'lane'}) to exist in graph`,
    ).toBe(true)
    expect(sc.graph.getEdgeAttribute(sc.graph.edge(fromKey!, toKey!), 'isGap')).toBe(isGap)
  }
}

describe('geo to graph conversion scenarios', () => {
  it('simple-chain: shared endpoint B is merged into one node', () => {
    checkGeoGraph(loadGeoGraphScenario(geojson('simple-chain'), expectedDot('simple-chain')))
  })

  it('gap-bridging: endpoints within _maxGapMeters are connected by a synthetic gap edge', () => {
    checkGeoGraph(loadGeoGraphScenario(geojson('gap-bridging'), expectedDot('gap-bridging')))
  })

  it('shared-endpoint: three lanes meeting at B produce a single node with degree 3', () => {
    checkGeoGraph(loadGeoGraphScenario(geojson('shared-endpoint'), expectedDot('shared-endpoint')))
  })

  it('round-trip: three lanes forming a closed triangle produce 3 nodes and 3 lane edges', () => {
    checkGeoGraph(loadGeoGraphScenario(geojson('round-trip'), expectedDot('round-trip')))
  })
})
