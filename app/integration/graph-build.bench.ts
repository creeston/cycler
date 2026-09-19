/**
 * Wall time of buildGraph, the app's dominant cost (backlog/16).
 *
 * Run with `npm run bench`. Not part of `npm test`: the numbers are for a
 * human to compare across commits, not for CI to gate on.
 */
import { it } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { FeatureCollection } from 'geojson'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { buildGraph } from '~/domain/routing/graph'
import { syntheticLanes } from '~/domain/routing/test-utils/synthetic-lanes'
import type { BikeLane } from '~/domain/entities/bike-lane'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, '../domain/routing/scenarios/overpass-data.geojson')
const RUNS = 5

interface Row {
  set: string
  maxGapMeters: number
  nodes: number
  edges: number
  minMs: number
  medianMs: number
}

it('reports buildGraph wall time', () => {
  const warsaw = geojsonToBikeLanes(
    JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as FeatureCollection,
  )
  const synthetic = syntheticLanes(5_000)

  const rows = [
    measure('Warsaw fixture', warsaw, 200),
    measure('Warsaw fixture', warsaw, 1_000),
    measure('synthetic 10k nodes', synthetic, 200),
    measure('synthetic 10k nodes', synthetic, 1_000),
  ]
  console.log(formatTable(rows))
})

function measure(label: string, lanes: BikeLane[], maxGapMeters: number): Row {
  const graph = buildGraph(lanes, maxGapMeters)
  const times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    buildGraph(lanes, maxGapMeters)
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  return {
    set: label,
    maxGapMeters,
    nodes: graph.order,
    edges: graph.size,
    minMs: Math.round(times[0]),
    medianMs: Math.round(times[Math.floor(RUNS / 2)]),
  }
}

function formatTable(rows: Row[]): string {
  const lines = [
    '| set | gap m | nodes | edges | min ms | median ms |',
    '|---|---|---|---|---|---|',
  ]
  for (const r of rows) {
    lines.push(
      `| ${r.set} | ${r.maxGapMeters} | ${r.nodes} | ${r.edges} | ${r.minMs} | ${r.medianMs} |`,
    )
  }
  return '\n' + lines.join('\n') + '\n'
}
