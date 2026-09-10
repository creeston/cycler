/**
 * The barrier veto against the real Warsaw Bemowo export and the barrier
 * layer fetched for the same bounding box.
 *
 * The numbers in the assertions are the ones recorded in
 * backlog/28-barrier-veto.md; they are ranges rather than exact values so an
 * OSM refresh does not break the suite, but a large move should be looked at.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { FeatureCollection } from 'geojson'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { geojsonToBarriers } from '~/domain/mappers/osm-to-barriers'
import { buildGraph, getGapStats } from '~/domain/routing/graph'
import type { BikeLaneGraph } from '~/domain/routing/graph'
import type { BarrierData } from '~/domain/entities/barrier'
import type { BikeLane } from '~/domain/entities/bike-lane'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LANES_PATH = join(__dirname, '../domain/routing/scenarios/overpass-data.geojson')
const BARRIERS_PATH = join(__dirname, '../domain/routing/scenarios/overpass-barriers.geojson')

let lanes: BikeLane[]
let barriers: BarrierData

beforeAll(() => {
  lanes = geojsonToBikeLanes(JSON.parse(readFileSync(LANES_PATH, 'utf-8')) as FeatureCollection)
  barriers = geojsonToBarriers(
    JSON.parse(readFileSync(BARRIERS_PATH, 'utf-8')) as FeatureCollection,
  )
})

describe('barrier veto — Warsaw overpass data', () => {
  it('reads barriers of every kind and the crossings that excuse them', () => {
    expect(kindCounts(barriers)).toMatchObject({
      major_road: expect.any(Number),
      railway: expect.any(Number),
      water: expect.any(Number),
    })
    expect(barriers.barriers.length).toBeGreaterThan(200)
    expect(barriers.crossings.length).toBeGreaterThan(500)
  })

  it('flags a minority of gap edges at the default tolerance', () => {
    const stats = getGapStats(buildGraph(lanes, 200, { barriers }))

    // Recorded: 41 of 441 gap edges, 9.3 %.
    expect(stats.barriersChecked).toBe(true)
    expect(stats.barrierCrossings).toBeGreaterThan(0)
    expect(stats.barrierCrossings).toBeLessThan(stats.kept * 0.2)
  })

  it('excuses most crossings of a barrier where a crossing exists', () => {
    const withCrossings = getGapStats(buildGraph(lanes, 200, { barriers })).barrierCrossings
    const withoutCrossings = getGapStats(
      buildGraph(lanes, 200, { barriers: { barriers: barriers.barriers, crossings: [] } }),
    ).barrierCrossings

    // Recorded: 41 flagged with crossings, 109 without — crossings excuse 62 %.
    expect(withCrossings).toBeLessThan(withoutCrossings * 0.6)
  })

  it('marks gaps without disconnecting the graph', () => {
    for (const tolerance of [50, 100, 200, 500]) {
      const checked = buildGraph(lanes, tolerance, { barriers })
      const unchecked = buildGraph(lanes, tolerance)
      expect(countComponents(checked), `at ${tolerance} m`).toBe(countComponents(unchecked))
      expect(checked.size, `at ${tolerance} m`).toBe(unchecked.size)
    }
  })

  it('records the barrier kind on every flagged edge', () => {
    const graph = buildGraph(lanes, 200, { barriers })

    graph.forEachEdge((_key, attrs) => {
      if (attrs.barrier === undefined) return
      expect(['major_road', 'railway', 'water']).toContain(attrs.barrier)
      expect(attrs.isGap, 'only gaps are ever flagged').toBe(true)
      expect(attrs.costMeters).toBeGreaterThan(attrs.distanceMeters)
    })
  })

  it('leaves lane edges at their true cost', () => {
    const graph = buildGraph(lanes, 200, { barriers })

    graph.forEachEdge((_key, attrs) => {
      if (attrs.isGap) return
      expect(attrs.costMeters).toBe(attrs.distanceMeters)
    })
  })
})

function kindCounts(data: BarrierData): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const barrier of data.barriers) counts[barrier.kind] = (counts[barrier.kind] ?? 0) + 1
  return counts
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
