import { readFileSync } from 'fs'
import type { FeatureCollection, LineString } from 'geojson'
import { geojsonToBikeLanes } from '../../mappers/osm-to-domain'
import { buildGraph } from '../graph'
import { coordKey } from '../algorithms'
import { parseDot } from './dot-parser'
import type { BikeLaneGraph } from '../graph'

export interface GeoGraphScenario {
  graph: BikeLaneGraph
  /** Maps human-readable node name (from GeoJSON _nodeStart/_nodeEnd) to actual coordKey. */
  nameToKey: Map<string, string>
  expectedEdges: Array<{ from: string; to: string; isGap: boolean }>
  expectedNodeCount: number
}

/**
 * Loads a GeoJSON file (bike lanes) and an expected .dot file (graph structure),
 * builds the BikeLaneGraph, and returns everything needed for assertions.
 *
 * GeoJSON features must include `_nodeStart` and `_nodeEnd` properties to name
 * their endpoints — these names must match the node names used in the .dot file.
 * An optional top-level `_maxGapMeters` controls gap edge insertion.
 */
export function loadGeoGraphScenario(
  geojsonPath: string,
  expectedDotPath: string,
): GeoGraphScenario {
  const fc = JSON.parse(readFileSync(geojsonPath, 'utf-8')) as FeatureCollection & {
    _maxGapMeters?: number
  }

  const lanes = geojsonToBikeLanes(fc)
  const graph = buildGraph(lanes, fc._maxGapMeters ?? 0)

  const nameToKey = new Map<string, string>()
  for (const feature of fc.features) {
    if (feature.geometry?.type !== 'LineString') continue
    const coords = (feature.geometry as LineString).coordinates
    const props = (feature.properties ?? {}) as Record<string, string>
    if (props._nodeStart)
      nameToKey.set(props._nodeStart, coordKey(coords[0][0], coords[0][1]))
    if (props._nodeEnd)
      nameToKey.set(props._nodeEnd, coordKey(coords[coords.length - 1][0], coords[coords.length - 1][1]))
  }

  const { edges: dotEdges } = parseDot(readFileSync(expectedDotPath, 'utf-8'))
  const expectedEdges = dotEdges.map(e => ({
    from: e.from,
    to: e.to,
    isGap: e.attrs.type === 'gap',
  }))
  const uniqueNames = new Set(dotEdges.flatMap(e => [e.from, e.to]))

  return { graph, nameToKey, expectedEdges, expectedNodeCount: uniqueNames.size }
}
