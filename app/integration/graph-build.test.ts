/**
 * buildGraph after the spatial index (backlog/16): the same graph as the
 * exhaustive pair loop produced, in sub-quadratic time.
 *
 * The equivalence table was recorded from the pair-loop implementation
 * before it was replaced: node and edge counts and a hash of the sorted
 * (u, v, isGap, barrier) edge list, per tolerance. The index must reproduce
 * every row exactly — the change is meant to be invisible to the router.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { FeatureCollection } from 'geojson'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { geojsonToBarriers } from '~/domain/mappers/osm-to-barriers'
import { buildGraph, getGapStats } from '~/domain/routing/graph'
import type { BikeLaneGraph } from '~/domain/routing/graph'
import { syntheticLanes } from '~/domain/routing/test-utils/synthetic-lanes'
import type { BarrierData } from '~/domain/entities/barrier'
import type { BikeLane } from '~/domain/entities/bike-lane'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, '../domain/routing/scenarios/overpass-data.geojson')
const BARRIER_PATH = join(__dirname, '../domain/routing/scenarios/overpass-barriers.geojson')

interface Expected {
  maxGapMeters: number
  nodes: number
  edges: number
  gapEdges: number
  candidates: number
  hash: string
}

const WARSAW_WITH_BARRIERS: Expected[] = [
  { maxGapMeters: 0, nodes: 360, edges: 378, gapEdges: 0, candidates: 0, hash: '1e55dbb0266a38e6' },
  {
    maxGapMeters: 50,
    nodes: 360,
    edges: 378,
    gapEdges: 0,
    candidates: 924,
    hash: '1e55dbb0266a38e6',
  },
  {
    maxGapMeters: 200,
    nodes: 360,
    edges: 384,
    gapEdges: 6,
    candidates: 2253,
    hash: 'f82f4b1bba989300',
  },
  {
    maxGapMeters: 500,
    nodes: 360,
    edges: 471,
    gapEdges: 93,
    candidates: 6150,
    hash: '7be0d7139dd6726a',
  },
  {
    maxGapMeters: 1000,
    nodes: 360,
    edges: 719,
    gapEdges: 341,
    candidates: 14437,
    hash: '6a9dc6050bb3ce20',
  },
]

const WARSAW_WITHOUT_BARRIERS: Expected[] = [
  {
    maxGapMeters: 200,
    nodes: 360,
    edges: 384,
    gapEdges: 6,
    candidates: 2253,
    hash: '2534c46fd9527a68',
  },
  {
    maxGapMeters: 500,
    nodes: 360,
    edges: 471,
    gapEdges: 93,
    candidates: 6150,
    hash: '00cc84bd1b7cd7d4',
  },
  {
    maxGapMeters: 1000,
    nodes: 360,
    edges: 719,
    gapEdges: 341,
    candidates: 14437,
    hash: '18a65022180d02fd',
  },
]

/** syntheticLanes(1_000) with the default seed: 2 000 nodes, every lane isolated. */
const SYNTHETIC_2K: Expected[] = [
  {
    maxGapMeters: 50,
    nodes: 2000,
    edges: 1037,
    gapEdges: 37,
    candidates: 37,
    hash: '818c97fada4f083a',
  },
  {
    maxGapMeters: 200,
    nodes: 2000,
    edges: 1628,
    gapEdges: 628,
    candidates: 656,
    hash: '84009cb606d5e553',
  },
  {
    maxGapMeters: 500,
    nodes: 2000,
    edges: 3329,
    gapEdges: 2329,
    candidates: 4049,
    hash: 'f90f3809392864cc',
  },
  {
    maxGapMeters: 1000,
    nodes: 2000,
    edges: 3858,
    gapEdges: 2858,
    candidates: 15285,
    hash: '04da320f084d8866',
  },
]

let lanes: BikeLane[]
let barriers: BarrierData

beforeAll(() => {
  lanes = geojsonToBikeLanes(JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as FeatureCollection)
  barriers = geojsonToBarriers(JSON.parse(readFileSync(BARRIER_PATH, 'utf-8')) as FeatureCollection)
})

describe('buildGraph equivalence with the exhaustive pair loop', () => {
  it.each(WARSAW_WITH_BARRIERS)('Warsaw fixture with barriers at $maxGapMeters m', expected => {
    expect(summarise(buildGraph(lanes, expected.maxGapMeters, { barriers }))).toEqual(expected)
  })

  it.each(WARSAW_WITHOUT_BARRIERS)(
    'Warsaw fixture without barriers at $maxGapMeters m',
    expected => {
      expect(summarise(buildGraph(lanes, expected.maxGapMeters))).toEqual(expected)
    },
  )

  it.each(SYNTHETIC_2K)('synthetic 2 000 nodes at $maxGapMeters m', expected => {
    expect(summarise(buildGraph(syntheticLanes(1_000), expected.maxGapMeters))).toEqual(expected)
  })
})

describe('buildGraph scaling', () => {
  it('grows sub-quadratically from 1 000 to 8 000 nodes', () => {
    // Doubling the node count three times multiplies a quadratic build by 64;
    // the pair loop measured 60 on this set. The index measured 13.5.
    const at1k = fastestBuildMs(syntheticLanes(500))
    const at8k = fastestBuildMs(syntheticLanes(4_000))
    expect(at8k / at1k).toBeLessThan(32)
  })
})

function summarise(graph: BikeLaneGraph): Expected {
  const triples: string[] = []
  let gapEdges = 0
  graph.forEachEdge((_edge, attrs, source, target) => {
    const [u, v] = source < target ? [source, target] : [target, source]
    triples.push(`${u}|${v}|${attrs.isGap}|${attrs.barrier ?? ''}`)
    if (attrs.isGap) gapEdges++
  })
  triples.sort()
  return {
    maxGapMeters: graph.getAttribute('maxGapMeters') ?? 0,
    nodes: graph.order,
    edges: graph.size,
    gapEdges,
    candidates: getGapStats(graph).candidates,
    hash: createHash('sha256').update(triples.join('\n')).digest('hex').slice(0, 16),
  }
}

function fastestBuildMs(set: BikeLane[]): number {
  buildGraph(set, 200)
  let fastest = Infinity
  for (let run = 0; run < 3; run++) {
    const started = performance.now()
    buildGraph(set, 200)
    fastest = Math.min(fastest, performance.now() - started)
  }
  return fastest
}
