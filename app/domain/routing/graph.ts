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

/** Counts from the gap pass, so pruning stays measurable and can be shown in a debug view. */
export interface GapStats {
  /** Node pairs within maxGapMeters that are not already joined by a lane edge. */
  candidates: number
  /** Candidates that became gap edges. */
  kept: number
  /** Candidates dropped because lane edges already connect the two nodes. */
  droppedSameComponent: number
  /** Candidates dropped because both endpoints already had MAX_GAP_EDGES_PER_NODE gaps. */
  droppedBeyondLimit: number
  /** Of the kept edges, those restored past the per-node limit to preserve connectivity. */
  keptForConnectivity: number
}

export interface GraphAttrs {
  gapStats?: GapStats
}

export type BikeLaneGraph = Graph<NodeAttrs, EdgeAttrs, GraphAttrs>

/**
 * Gap edges kept per node. Every candidate that is among the shortest
 * MAX_GAP_EDGES_PER_NODE of either endpoint survives; the rest are dropped
 * unless connectivity needs them.
 *
 * Chosen by measuring route counts on the Warsaw Bemowo fixture for k ∈ {1,2,3}:
 * k=1 loses route diversity, k=2 and k=3 hold it, so k=2 is the smallest value
 * that costs nothing. See docs/algorithms.md §3.3.2.
 */
export const MAX_GAP_EDGES_PER_NODE = 2

const EMPTY_GAP_STATS: GapStats = {
  candidates: 0,
  kept: 0,
  droppedSameComponent: 0,
  droppedBeyondLimit: 0,
  keptForConnectivity: 0,
}

interface GapCandidate {
  from: number
  to: number
  distanceMeters: number
}

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

function findRoot(parent: number[], node: number): number {
  let root = node
  while (parent[root] !== root) root = parent[root]
  let walk = node
  while (parent[walk] !== root) {
    const next = parent[walk]
    parent[walk] = root
    walk = next
  }
  return root
}

/** Joins the components of a and b. Returns false when they were already joined. */
function joinComponents(parent: number[], rank: number[], a: number, b: number): boolean {
  const rootA = findRoot(parent, a)
  const rootB = findRoot(parent, b)
  if (rootA === rootB) return false
  if (rank[rootA] < rank[rootB]) {
    parent[rootA] = rootB
  } else if (rank[rootA] > rank[rootB]) {
    parent[rootB] = rootA
  } else {
    parent[rootB] = rootA
    rank[rootA]++
  }
  return true
}

function addLaneEdges(graph: BikeLaneGraph, lanes: BikeLane[]): void {
  for (const lane of lanes) {
    const coords = lane.geometry.coordinates
    const startKey = coordKey(coords[0][0], coords[0][1])
    const endKey = coordKey(coords[coords.length - 1][0], coords[coords.length - 1][1])

    graph.mergeNode(startKey, { lon: coords[0][0], lat: coords[0][1] })
    graph.mergeNode(endKey, {
      lon: coords[coords.length - 1][0],
      lat: coords[coords.length - 1][1],
    })

    if (startKey !== endKey && !graph.hasEdge(startKey, endKey)) {
      const dist = turf.length(turf.feature(lane.geometry), { units: 'meters' })
      graph.addEdge(startKey, endKey, {
        distanceMeters: dist,
        isGap: false,
        geometry: lane.geometry,
      })
    }
  }
}

/**
 * Every unordered pair of nodes within maxGapMeters that no lane edge already joins.
 * A rectangular prefilter rejects distant pairs before the distance call; it is
 * conservative up to ~70.6° latitude (docs/algorithms.md §3.4).
 */
function collectGapCandidates(
  graph: BikeLaneGraph,
  nodes: string[],
  attrs: NodeAttrs[],
  maxGapMeters: number,
): GapCandidate[] {
  const candidates: GapCandidate[] = []
  const maxDeg = (maxGapMeters / 111_000) * 1.5

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (graph.hasEdge(nodes[i], nodes[j])) continue
      const a = attrs[i],
        b = attrs[j]
      if (Math.abs(a.lat - b.lat) > maxDeg || Math.abs(a.lon - b.lon) > maxDeg * 2) continue
      const distanceMeters = approxMeters(a.lon, a.lat, b.lon, b.lat)
      if (distanceMeters <= maxGapMeters) candidates.push({ from: i, to: j, distanceMeters })
    }
  }

  return candidates
}

/** Union-find parents for the components formed by lane edges alone. */
function laneComponents(
  graph: BikeLaneGraph,
  nodes: string[],
): { parent: number[]; rank: number[] } {
  const parent = nodes.map((_, i) => i)
  const rank = new Array<number>(nodes.length).fill(0)
  const indexOf = new Map(nodes.map((key, i) => [key, i]))

  graph.forEachEdge((_edge, _attrs, source, target) => {
    joinComponents(parent, rank, indexOf.get(source)!, indexOf.get(target)!)
  })

  return { parent, rank }
}

/**
 * Picks which candidates become gap edges, shortest first:
 *
 * 1. Drop candidates whose endpoints lane edges already connect — they cannot
 *    change reachability.
 * 2. Keep a candidate when either endpoint still has fewer than
 *    MAX_GAP_EDGES_PER_NODE gaps, which is the union of the k shortest gaps per node.
 * 3. Restore any dropped candidate that still joins two separate components, so
 *    the component count matches an unpruned build.
 */
function selectGapEdges(
  candidates: GapCandidate[],
  nodeCount: number,
  laneParent: number[],
  laneRank: number[],
  maxGapsPerNode: number,
): { selected: GapCandidate[]; stats: GapStats } {
  const crossComponent = candidates.filter(
    c => findRoot(laneParent, c.from) !== findRoot(laneParent, c.to),
  )
  crossComponent.sort((a, b) => a.distanceMeters - b.distanceMeters)

  const gapDegree = new Array<number>(nodeCount).fill(0)
  const keptFlags = new Array<boolean>(crossComponent.length).fill(false)
  const parent = [...laneParent]
  const rank = [...laneRank]

  for (let i = 0; i < crossComponent.length; i++) {
    const c = crossComponent[i]
    if (gapDegree[c.from] >= maxGapsPerNode && gapDegree[c.to] >= maxGapsPerNode) continue
    keptFlags[i] = true
    gapDegree[c.from]++
    gapDegree[c.to]++
    joinComponents(parent, rank, c.from, c.to)
  }

  let keptForConnectivity = 0
  for (let i = 0; i < crossComponent.length; i++) {
    if (keptFlags[i]) continue
    const c = crossComponent[i]
    if (!joinComponents(parent, rank, c.from, c.to)) continue
    keptFlags[i] = true
    keptForConnectivity++
  }

  const selected = crossComponent.filter((_, i) => keptFlags[i])
  return {
    selected,
    stats: {
      candidates: candidates.length,
      kept: selected.length,
      droppedSameComponent: candidates.length - crossComponent.length,
      droppedBeyondLimit: crossComponent.length - selected.length,
      keptForConnectivity,
    },
  }
}

function addGapEdges(graph: BikeLaneGraph, maxGapMeters: number, maxGapsPerNode: number): GapStats {
  const nodes = graph.nodes()
  // Pre-compute to avoid repeated attribute lookups in the inner loop
  const attrs = nodes.map(k => graph.getNodeAttributes(k))

  const candidates = collectGapCandidates(graph, nodes, attrs, maxGapMeters)
  const { parent, rank } = laneComponents(graph, nodes)
  const { selected, stats } = selectGapEdges(candidates, nodes.length, parent, rank, maxGapsPerNode)

  for (const c of selected) {
    const a = attrs[c.from],
      b = attrs[c.to]
    graph.addEdge(nodes[c.from], nodes[c.to], {
      distanceMeters: c.distanceMeters,
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

  return stats
}

/**
 * Builds an undirected graphology graph from bike lane endpoints.
 * Adds pruned synthetic gap edges between endpoint pairs within maxGapMeters —
 * see selectGapEdges for which pairs survive. The pruning counts are stored as
 * the graph attribute `gapStats` and read with getGapStats.
 *
 * maxGapsPerNode exists so the pruning limit can be measured and tested; callers
 * in the app leave it at MAX_GAP_EDGES_PER_NODE.
 */
export function buildGraph(
  lanes: BikeLane[],
  maxGapMeters: number,
  maxGapsPerNode: number = MAX_GAP_EDGES_PER_NODE,
): BikeLaneGraph {
  const graph: BikeLaneGraph = new Graph({ type: 'undirected', multi: false })

  addLaneEdges(graph, lanes)

  const stats =
    maxGapMeters > 0 ? addGapEdges(graph, maxGapMeters, maxGapsPerNode) : EMPTY_GAP_STATS
  graph.setAttribute('gapStats', stats)

  return graph
}

/** Gap pruning counts for a graph, all zero for graphs not built by buildGraph. */
export function getGapStats(graph: BikeLaneGraph): GapStats {
  return graph.getAttribute('gapStats') ?? EMPTY_GAP_STATS
}

/** Returns the key of the graph node closest to the given coordinate. */
export function nearestNode(graph: BikeLaneGraph, lon: number, lat: number): string | null {
  let minSq = Infinity
  let nearest: string | null = null
  graph.forEachNode((key, a) => {
    const sq = (a.lon - lon) ** 2 + (a.lat - lat) ** 2
    if (sq < minSq) {
      minSq = sq
      nearest = key
    }
  })
  return nearest
}

/**
 * Returns keys of all graph nodes within maxMeters of the given coordinate.
 * Uses the same equirectangular approximation as gap detection.
 * Falls back to the single nearest node when none are within the radius,
 * so the result is never empty as long as the graph has at least one node.
 */
export function nodesWithinMeters(
  graph: BikeLaneGraph,
  lon: number,
  lat: number,
  maxMeters: number,
): string[] {
  const maxDeg = (maxMeters / 111_000) * 1.5
  const candidates: string[] = []

  graph.forEachNode((key, a) => {
    if (Math.abs(a.lat - lat) > maxDeg || Math.abs(a.lon - lon) > maxDeg * 2) return
    if (approxMeters(lon, lat, a.lon, a.lat) <= maxMeters) candidates.push(key)
  })

  if (candidates.length === 0) {
    const nearest = nearestNode(graph, lon, lat)
    if (nearest) candidates.push(nearest)
  }

  return candidates
}
