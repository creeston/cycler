import Graph from 'graphology'
import * as turf from '@turf/turf'
import type { LineString, Position } from 'geojson'
import type { BikeLane, LaneType } from '../entities/bike-lane'
import type { BarrierData, BarrierKind } from '../entities/barrier'
import { approxMeters, coordKey } from './algorithms'
import { buildBarrierIndex, findBlockingBarrier } from './barriers'
import { osmLevel } from '../mappers/osm-to-barriers'

export interface NodeAttrs {
  /** A representative raw endpoint position; the snapped graph key is the node's identity. */
  lon: number
  lat: number
}

export interface EdgeAttrs {
  /** Graph key matching the first geometry coordinate. */
  startKey: string
  /** Graph key matching the last geometry coordinate. */
  endKey: string
  distanceMeters: number
  /** What the router minimises: distanceMeters, inflated for edges to avoid. */
  costMeters: number
  isGap: boolean
  geometry: LineString
  /** Set when this gap crosses a barrier away from any crossing. */
  barrier?: BarrierKind
  /** Lane edges carry the lane they were cut from; gap edges have none. */
  laneType?: LaneType
  surface?: string
  tags?: Record<string, string>
}

/** Counts from the gap pass, so pruning stays measurable and can be shown in a debug view. */
export interface GapStats {
  /** Node pairs within maxGapMeters that are not already joined by a lane edge. */
  candidates: number
  /** Candidates that became gap edges. */
  kept: number
  /** Candidates dropped because the two lanes sit on different levels. */
  droppedGradeSeparated: number
  /** Candidates dropped because lane edges already connect the two nodes. */
  droppedSameComponent: number
  /** Candidates dropped because both endpoints already had MAX_GAP_EDGES_PER_NODE gaps. */
  droppedBeyondLimit: number
  /** Of the kept edges, those restored past the per-node limit to preserve connectivity. */
  keptForConnectivity: number
  /** Of the kept edges, those marked as crossing a barrier. */
  barrierCrossings: number
  /** False when no barrier data was supplied, so nothing was checked. */
  barriersChecked: boolean
}

export interface GraphAttrs {
  gapStats?: GapStats
  /** The gap tolerance this graph was built with. */
  maxGapMeters?: number
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
  droppedGradeSeparated: 0,
  droppedSameComponent: 0,
  droppedBeyondLimit: 0,
  keptForConnectivity: 0,
  barrierCrossings: 0,
  barriersChecked: false,
}

/**
 * How much a gap that crosses a barrier costs the router beyond its length.
 * Heavy enough that a detour of any plausible length wins, finite so that a
 * flagged gap is still taken when it is the only way through — the task this
 * came from calls for marking, not dropping, until the false-positive rate on
 * real data is understood.
 */
export const BARRIER_COST_MULTIPLIER = 50

/**
 * What a metre off bike infrastructure costs, as a multiple of a metre on it.
 *
 * The product's premise is that riders accept a detour to stay on a lane, and
 * this is where that is stated: at 5, the router trades up to 5 m of cycleway
 * for every 1 m of road it avoids. Chosen by measuring route quality on the
 * Warsaw fixture — see docs/algorithms.md §3.3.5.
 */
export const GAP_PENALTY_FACTOR = 5

/**
 * The cost premium on a gap, as a multiple of its length. Grows with length
 * relative to the tolerance, so one long gap costs more than the same distance
 * split into several short ones — which is how the discomfort actually scales.
 * A gap at the full tolerance costs twice the base factor.
 */
export function gapPenaltyFactor(distanceMeters: number, maxGapMeters: number): number {
  if (maxGapMeters <= 0) return GAP_PENALTY_FACTOR
  return GAP_PENALTY_FACTOR * (1 + distanceMeters / maxGapMeters)
}

interface GapCandidate {
  from: number
  to: number
  distanceMeters: number
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

/** The snapped key of every vertex of a lane, in order. */
function laneVertexKeys(lane: BikeLane): string[] {
  return lane.geometry.coordinates.map(([lon, lat]) => coordKey(lon, lat))
}

/**
 * Counts, per snapped coordinate, how many distinct lanes have a vertex there.
 * A count of two or more marks a junction, wherever along the lanes it sits.
 */
function countLanesPerVertex(laneKeys: string[][]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const keys of laneKeys) {
    const seenInLane = new Set<string>()
    for (const key of keys) {
      if (seenInLane.has(key)) continue
      seenInLane.add(key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Cuts a lane at every interior vertex shared with another lane. Returns the
 * pieces in order; a lane touching no other lane inside comes back whole.
 *
 * Consecutive vertices inside one snapping cell are one junction: the cut is
 * made at the first of them, so the sub-metre geometry between them stays in
 * the next piece instead of becoming a zero-length piece that is dropped.
 */
function splitAtJunctions(
  coords: Position[],
  keys: string[],
  laneCounts: Map<string, number>,
): Position[][] {
  const pieces: Position[][] = []
  const last = coords.length - 1
  let from = 0
  for (let i = 1; i < last; i++) {
    if ((laneCounts.get(keys[i]) ?? 0) < 2 || keys[i] === keys[i - 1]) continue
    if (runReachesEnd(keys, i)) break
    pieces.push(coords.slice(from, i + 1))
    from = i
  }
  if (from === 0) return [coords]
  pieces.push(coords.slice(from))
  return pieces
}

/** True when every vertex from i to the last one shares the key of vertex i. */
function runReachesEnd(keys: string[], i: number): boolean {
  for (let j = i + 1; j < keys.length; j++) {
    if (keys[j] !== keys[i]) return false
  }
  return true
}

/**
 * Adds lane edges and returns the levels each node sits on. A lane becomes one
 * edge per piece between junctions (splitAtJunctions), so lanes that meet away
 * from their endpoints are connected. A node can carry several levels when
 * lanes at different heights pass through the same spot.
 */
function addLaneEdges(graph: BikeLaneGraph, lanes: BikeLane[]): Map<string, Set<number>> {
  const levels = new Map<string, Set<number>>()
  const laneKeys = lanes.map(laneVertexKeys)
  const laneCounts = countLanesPerVertex(laneKeys)

  lanes.forEach((lane, i) => {
    const level = osmLevel(lane.tags)
    for (const coords of splitAtJunctions(lane.geometry.coordinates, laneKeys[i], laneCounts)) {
      addLanePiece(graph, levels, lane, coords, level)
    }
  })

  return levels
}

function addLanePiece(
  graph: BikeLaneGraph,
  levels: Map<string, Set<number>>,
  lane: BikeLane,
  coords: Position[],
  level: number,
): void {
  const start = coords[0]
  const end = coords[coords.length - 1]
  const startKey = coordKey(start[0], start[1])
  const endKey = coordKey(end[0], end[1])

  // Multiple raw endpoints can share one snapped key. Deliberately keep the
  // last writer: this preserves a position from real lane geometry instead of
  // inventing a grid-centre coordinate. Identity-sensitive code must use the key.
  graph.mergeNode(startKey, { lon: start[0], lat: start[1] })
  graph.mergeNode(endKey, { lon: end[0], lat: end[1] })
  recordLevel(levels, startKey, level)
  recordLevel(levels, endKey, level)

  if (startKey === endKey || graph.hasEdge(startKey, endKey)) return

  const geometry: LineString =
    coords === lane.geometry.coordinates
      ? lane.geometry
      : { type: 'LineString', coordinates: coords }
  const dist = turf.length(turf.feature(geometry), { units: 'meters' })
  graph.addEdge(startKey, endKey, {
    startKey,
    endKey,
    distanceMeters: dist,
    costMeters: dist,
    isGap: false,
    geometry,
    laneType: lane.laneType,
    ...(lane.surface !== undefined ? { surface: lane.surface } : {}),
    tags: lane.tags,
  })
}

function recordLevel(levels: Map<string, Set<number>>, key: string, level: number): void {
  const known = levels.get(key)
  if (known) known.add(level)
  else levels.set(key, new Set([level]))
}

function sharesLevel(a: Set<number> | undefined, b: Set<number> | undefined): boolean {
  if (!a || !b) return true
  for (const level of a) {
    if (b.has(level)) return true
  }
  return false
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
): {
  selected: GapCandidate[]
  droppedSameComponent: number
  droppedBeyondLimit: number
  keptForConnectivity: number
} {
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
    droppedSameComponent: candidates.length - crossComponent.length,
    droppedBeyondLimit: crossComponent.length - selected.length,
    keptForConnectivity,
  }
}

function addGapEdges(
  graph: BikeLaneGraph,
  maxGapMeters: number,
  maxGapsPerNode: number,
  levels: Map<string, Set<number>>,
  barriers: BarrierData | undefined,
  gapPenalty: (distanceMeters: number, maxGapMeters: number) => number,
): GapStats {
  const nodes = graph.nodes()
  // Pre-compute to avoid repeated attribute lookups in the inner loop
  const attrs = nodes.map(k => graph.getNodeAttributes(k))

  const candidates = collectGapCandidates(graph, nodes, attrs, maxGapMeters)
  const onGrade = candidates.filter(c =>
    sharesLevel(levels.get(nodes[c.from]), levels.get(nodes[c.to])),
  )
  const { parent, rank } = laneComponents(graph, nodes)
  const { selected, droppedSameComponent, droppedBeyondLimit, keptForConnectivity } =
    selectGapEdges(onGrade, nodes.length, parent, rank, maxGapsPerNode)

  const index = barriers ? buildBarrierIndex(barriers) : null
  let barrierCrossings = 0

  for (const c of selected) {
    const a = attrs[c.from],
      b = attrs[c.to]
    const barrier = index ? findBlockingBarrier(index, a.lon, a.lat, b.lon, b.lat) : null
    if (barrier) barrierCrossings++

    const penalty =
      gapPenalty(c.distanceMeters, maxGapMeters) * (barrier ? BARRIER_COST_MULTIPLIER : 1)

    graph.addEdge(nodes[c.from], nodes[c.to], {
      startKey: nodes[c.from],
      endKey: nodes[c.to],
      distanceMeters: c.distanceMeters,
      costMeters: c.distanceMeters * penalty,
      isGap: true,
      ...(barrier ? { barrier } : {}),
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
    })
  }

  return {
    candidates: candidates.length,
    kept: selected.length,
    droppedGradeSeparated: candidates.length - onGrade.length,
    droppedSameComponent,
    droppedBeyondLimit,
    keptForConnectivity,
    barrierCrossings,
    barriersChecked: index !== null,
  }
}

export interface GraphOptions {
  /**
   * Gap edges kept per node. Exposed so the pruning limit can be measured and
   * tested; callers in the app leave it at MAX_GAP_EDGES_PER_NODE.
   */
  maxGapsPerNode?: number
  /**
   * Barrier geometry to test gaps against. Omitted means nothing is checked,
   * and `gapStats.barriersChecked` says so.
   */
  barriers?: BarrierData
  /**
   * Cost premium on a gap, as a multiple of its length. Exposed so alternative
   * penalty models can be measured; production uses gapPenaltyFactor.
   */
  gapPenalty?: (distanceMeters: number, maxGapMeters: number) => number
}

/**
 * Builds an undirected graphology graph from bike lanes. Nodes sit at lane
 * endpoints and at every vertex two lanes share, so lanes are split where
 * they meet (addLaneEdges).
 *
 * Adds synthetic gap edges between endpoint pairs within maxGapMeters, minus
 * the ones that are not worth having: pairs on different levels are dropped
 * (they pass over or under each other), the rest are pruned by selectGapEdges,
 * and survivors that cross a barrier away from a crossing are marked and made
 * expensive rather than removed. Every gap edge costs more to the router than
 * its length (gapPenaltyFactor); `distanceMeters` stays the real distance.
 * Counts are stored as the graph attribute `gapStats` and read with getGapStats.
 */
export function buildGraph(
  lanes: BikeLane[],
  maxGapMeters: number,
  options: GraphOptions = {},
): BikeLaneGraph {
  const graph: BikeLaneGraph = new Graph({ type: 'undirected', multi: false })

  const levels = addLaneEdges(graph, lanes)

  const stats =
    maxGapMeters > 0
      ? addGapEdges(
          graph,
          maxGapMeters,
          options.maxGapsPerNode ?? MAX_GAP_EDGES_PER_NODE,
          levels,
          options.barriers,
          options.gapPenalty ?? gapPenaltyFactor,
        )
      : EMPTY_GAP_STATS
  graph.setAttribute('gapStats', stats)
  graph.setAttribute('maxGapMeters', maxGapMeters)

  return graph
}

/** The gap tolerance a graph was built with; 0 for graphs not built by buildGraph. */
export function getMaxGapMeters(graph: BikeLaneGraph): number {
  return graph.getAttribute('maxGapMeters') ?? 0
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
