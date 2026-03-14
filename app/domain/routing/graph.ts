import Graph from 'graphology'
import * as turf from '@turf/turf'
import type { LineString } from 'geojson'
import type { BikeLane } from '../entities/bike-lane'
import { coordKey } from './algorithms'

export interface NodeAttrs {
  lon: number
  lat: number
}

export interface EdgeAttrs {
  distanceMeters: number
  isGap: boolean
  geometry: LineString
}

export type BikeLaneGraph = Graph<NodeAttrs, EdgeAttrs>

/**
 * Equirectangular distance approximation — much faster than Haversine for
 * the inner O(n²) gap-detection loop. Accurate to < 0.1% for d < 10 km.
 */
function approxMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const avgLat = (((lat1 + lat2) / 2) * Math.PI) / 180
  return R * Math.sqrt(dLat * dLat + (dLon * Math.cos(avgLat)) ** 2)
}

/**
 * Builds an undirected graphology graph from bike lane endpoints.
 * Adds synthetic gap edges between endpoint pairs within maxGapMeters.
 */
export function buildGraph(lanes: BikeLane[], maxGapMeters: number): BikeLaneGraph {
  const graph: BikeLaneGraph = new Graph({ type: 'undirected', multi: false })

  for (const lane of lanes) {
    const coords = lane.geometry.coordinates
    const startKey = coordKey(coords[0][0], coords[0][1])
    const endKey = coordKey(coords[coords.length - 1][0], coords[coords.length - 1][1])

    graph.mergeNode(startKey, { lon: coords[0][0], lat: coords[0][1] })
    graph.mergeNode(endKey, { lon: coords[coords.length - 1][0], lat: coords[coords.length - 1][1] })

    if (startKey !== endKey && !graph.hasEdge(startKey, endKey)) {
      const dist = turf.length(turf.feature(lane.geometry), { units: 'meters' })
      graph.addEdge(startKey, endKey, { distanceMeters: dist, isGap: false, geometry: lane.geometry })
    }
  }

  if (maxGapMeters > 0) {
    const nodes = graph.nodes()
    // Pre-compute to avoid repeated attribute lookups in the inner loop
    const attrs = nodes.map(k => graph.getNodeAttributes(k))
    // Degree-based early exit: skip if lat/lon delta already exceeds threshold
    const maxDeg = (maxGapMeters / 111_000) * 1.5

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (graph.hasEdge(nodes[i], nodes[j])) continue
        const a = attrs[i], b = attrs[j]
        if (Math.abs(a.lat - b.lat) > maxDeg || Math.abs(a.lon - b.lon) > maxDeg * 2) continue
        const dist = approxMeters(a.lon, a.lat, b.lon, b.lat)
        if (dist <= maxGapMeters) {
          graph.addEdge(nodes[i], nodes[j], {
            distanceMeters: dist,
            isGap: true,
            geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
          })
        }
      }
    }
  }

  return graph
}

/** Returns the key of the graph node closest to the given coordinate. */
export function nearestNode(graph: BikeLaneGraph, lon: number, lat: number): string | null {
  let minSq = Infinity
  let nearest: string | null = null
  graph.forEachNode((key, a) => {
    const sq = (a.lon - lon) ** 2 + (a.lat - lat) ** 2
    if (sq < minSq) { minSq = sq; nearest = key }
  })
  return nearest
}
