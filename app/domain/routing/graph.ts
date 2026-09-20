import Graph from 'graphology'
import * as turf from '@turf/turf'
import type { LineString, Position } from 'geojson'
import type { BikeLane, LaneType } from '../entities/bike-lane'
import type { BarrierData, BarrierKind } from '../entities/barrier'
import { coordKey } from './algorithms'
import { buildBarrierIndex, findBlockingBarrier } from './barriers'
import { buildPointIndex, forEachPairWithin, nearestPoint, pointsWithin } from './spatial-index'
import type { PointIndex } from './spatial-index'
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

/** Counts from the lane pass, so every fetched lane is either in the graph or accounted for. */
export interface LaneStats {
  /** Lanes given to buildGraph. */
  lanes: number
  /** Total length of those lanes in metres. */
  laneMeters: number
  /** Pieces the lanes were cut into, at junctions and by the cuts below (docs/algorithms.md §3.2). */
  pieces: number
  /** Pieces that became lane edges. */
  edges: number
  /** Total length of the lane edges in metres. */
  edgeMeters: number
  /** Pieces cut in two because both ends snapped to one node: closed loops nothing else touches. */
  splitClosedLoops: number
  /** Pieces cut in two because a lane edge already joined their two nodes. */
  splitParallel: number
  /** Closed pieces dropped because they had no interior vertex to cut at. */
  droppedClosedLoops: number
  /** Parallel pieces dropped because neither rival had an interior vertex; the shorter one stays. */
  droppedParallel: number
  /** Length of the dropped pieces in metres. */
  droppedMeters: number
}

/** The graph's nodes in a spatial index; `keys[i]` is the node at point i. */
export interface NodeIndex {
  keys: string[]
  points: PointIndex
}

export interface GraphAttrs {
  laneStats?: LaneStats
  gapStats?: GapStats
  /** The gap tolerance this graph was built with. */
  maxGapMeters?: number
  /** Built once by buildGraph, after which the node set does not change. */
  nodeIndex?: NodeIndex
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

/**
 * Index cell size when the graph is built without gaps, so nearestNode and
 * nodesWithinMeters still have an index to query. With gaps the cell is the
 * gap tolerance itself, which makes the gap pass a nine-cell lookup.
 */
const INDEX_CELL_METERS_WITHOUT_GAPS = 200

const EMPTY_LANE_STATS: LaneStats = {
  lanes: 0,
  laneMeters: 0,
  pieces: 0,
  edges: 0,
  edgeMeters: 0,
  splitClosedLoops: 0,
  splitParallel: 0,
  droppedClosedLoops: 0,
  droppedParallel: 0,
  droppedMeters: 0,
}

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

/** A run of one lane's geometry that becomes one edge, unless cut further. */
interface LanePiece {
  lane: BikeLane
  coords: Position[]
  level: number
}

/**
 * Adds lane edges and returns the levels each node sits on. A lane becomes one
 * edge per piece between junctions (splitAtJunctions), so lanes that meet away
 * from their endpoints are connected. A node can carry several levels when
 * lanes at different heights pass through the same spot.
 */
function addLaneEdges(
  graph: BikeLaneGraph,
  lanes: BikeLane[],
): { levels: Map<string, Set<number>>; stats: LaneStats } {
  const levels = new Map<string, Set<number>>()
  const stats: LaneStats = { ...EMPTY_LANE_STATS, lanes: lanes.length }
  const pieceOf = new Map<string, LanePiece>()
  const laneKeys = lanes.map(laneVertexKeys)
  const laneCounts = countLanesPerVertex(laneKeys)

  lanes.forEach((lane, i) => {
    const level = osmLevel(lane.tags)
    stats.laneMeters += turf.length(turf.feature(lane.geometry), { units: 'meters' })
    for (const coords of splitAtJunctions(lane.geometry.coordinates, laneKeys[i], laneCounts)) {
      addLanePiece(graph, levels, stats, pieceOf, { lane, coords, level })
    }
  })

  return { levels, stats }
}

/**
 * Adds a piece as one edge between its snapped ends. The graph is simple, so
 * two pieces cannot fit as they are: one whose ends snap to the same node (a
 * closed loop nothing else touches) and one whose nodes a lane edge already
 * joins (a parallel lane). Either is cut at an interior vertex and both halves
 * added, which turns a loop into a cycle of three edges and keeps a parallel
 * lane as two edges through a new node. When the parallel piece has no
 * interior vertex but the edge it rivals does, the edge is cut instead, so the
 * result does not depend on ingestion order. Only when neither can be cut is
 * a piece dropped: a closed piece as a whole, and of two straight parallel
 * pieces the longer one. Every outcome is counted in `stats`.
 */
function addLanePiece(
  graph: BikeLaneGraph,
  levels: Map<string, Set<number>>,
  stats: LaneStats,
  pieceOf: Map<string, LanePiece>,
  piece: LanePiece,
): void {
  const { lane, coords, level } = piece
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

  const closed = startKey === endKey
  const rivalEdge = closed ? undefined : graph.edge(startKey, endKey)

  if (closed || rivalEdge !== undefined) {
    const cut = interiorCut(coords, startKey, endKey)
    if (cut !== -1) {
      if (closed) stats.splitClosedLoops++
      else stats.splitParallel++
      addLanePiece(graph, levels, stats, pieceOf, { ...piece, coords: coords.slice(0, cut + 1) })
      addLanePiece(graph, levels, stats, pieceOf, { ...piece, coords: coords.slice(cut) })
      return
    }
  }

  if (rivalEdge !== undefined) {
    const rival = pieceOf.get(rivalEdge)!
    const cut = interiorCut(rival.coords, startKey, endKey)
    if (cut !== -1) {
      removeLaneEdge(graph, stats, pieceOf, rivalEdge)
      stats.splitParallel++
      addLanePiece(graph, levels, stats, pieceOf, {
        ...rival,
        coords: rival.coords.slice(0, cut + 1),
      })
      addLanePiece(graph, levels, stats, pieceOf, { ...rival, coords: rival.coords.slice(cut) })
      addLanePiece(graph, levels, stats, pieceOf, piece)
      return
    }
  }

  const geometry: LineString =
    coords === lane.geometry.coordinates
      ? lane.geometry
      : { type: 'LineString', coordinates: coords }
  const dist = turf.length(turf.feature(geometry), { units: 'meters' })
  stats.pieces++

  if (closed) {
    stats.droppedClosedLoops++
    stats.droppedMeters += dist
    return
  }

  const attrs: EdgeAttrs = {
    startKey,
    endKey,
    distanceMeters: dist,
    costMeters: dist,
    isGap: false,
    geometry,
    laneType: lane.laneType,
    ...(lane.surface !== undefined ? { surface: lane.surface } : {}),
    tags: lane.tags,
  }

  if (rivalEdge !== undefined) {
    const rivalDist = graph.getEdgeAttribute(rivalEdge, 'distanceMeters')
    stats.droppedParallel++
    if (dist >= rivalDist) {
      stats.droppedMeters += dist
      return
    }
    stats.droppedMeters += rivalDist
    stats.edgeMeters += dist - rivalDist
    graph.replaceEdgeAttributes(rivalEdge, attrs)
    pieceOf.set(rivalEdge, piece)
    return
  }

  stats.edges++
  stats.edgeMeters += dist
  pieceOf.set(graph.addEdge(startKey, endKey, attrs), piece)
}

/**
 * The index of the interior vertex nearest the middle of a piece whose snapped
 * key differs from both ends, or -1 when there is none. Cutting there gives two
 * pieces that meet at a node of their own.
 */
function interiorCut(coords: Position[], startKey: string, endKey: string): number {
  const last = coords.length - 1
  const mid = Math.floor(last / 2)
  for (let before = mid, after = mid + 1; before > 0 || after < last; before--, after++) {
    if (before > 0 && isCutVertex(coords[before], startKey, endKey)) return before
    if (after < last && isCutVertex(coords[after], startKey, endKey)) return after
  }
  return -1
}

function isCutVertex(vertex: Position, startKey: string, endKey: string): boolean {
  const key = coordKey(vertex[0], vertex[1])
  return key !== startKey && key !== endKey
}

/** Takes a lane edge back out so its piece can be added again in halves. */
function removeLaneEdge(
  graph: BikeLaneGraph,
  stats: LaneStats,
  pieceOf: Map<string, LanePiece>,
  edge: string,
): void {
  stats.pieces--
  stats.edges--
  stats.edgeMeters -= graph.getEdgeAttribute(edge, 'distanceMeters')
  pieceOf.delete(edge)
  graph.dropEdge(edge)
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
 * Every unordered pair of nodes within maxGapMeters that no lane edge already
 * joins, found through the spatial index (docs/algorithms.md §3.4). The
 * distance test is the same approxMeters comparison as before the index, so
 * the candidate set is exactly the set of pairs within the tolerance.
 */
function collectGapCandidates(
  graph: BikeLaneGraph,
  index: NodeIndex,
  maxGapMeters: number,
): GapCandidate[] {
  const candidates: GapCandidate[] = []
  forEachPairWithin(index.points, maxGapMeters, (from, to, distanceMeters) => {
    if (graph.hasEdge(index.keys[from], index.keys[to])) return
    candidates.push({ from, to, distanceMeters })
  })
  return candidates
}

function buildNodeIndex(graph: BikeLaneGraph, cellMeters: number): NodeIndex {
  const keys = graph.nodes()
  const lons = new Array<number>(keys.length)
  const lats = new Array<number>(keys.length)
  keys.forEach((key, i) => {
    const attrs = graph.getNodeAttributes(key)
    lons[i] = attrs.lon
    lats[i] = attrs.lat
  })
  return { keys, points: buildPointIndex(lons, lats, cellMeters) }
}

/** The index buildGraph stored, or a fresh one for a graph assembled some other way. */
function nodeIndexOf(graph: BikeLaneGraph): NodeIndex {
  return graph.getAttribute('nodeIndex') ?? buildNodeIndex(graph, INDEX_CELL_METERS_WITHOUT_GAPS)
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
 * Picks which candidates become gap edges, shortest first (ties by node
 * order, so the result does not depend on how the candidates were found):
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
  crossComponent.sort(
    (a, b) => a.distanceMeters - b.distanceMeters || a.from - b.from || a.to - b.to,
  )

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
  index: NodeIndex,
  maxGapMeters: number,
  maxGapsPerNode: number,
  levels: Map<string, Set<number>>,
  barriers: BarrierData | undefined,
  gapPenalty: (distanceMeters: number, maxGapMeters: number) => number,
): GapStats {
  const nodes = index.keys
  const { lons, lats } = index.points

  const candidates = collectGapCandidates(graph, index, maxGapMeters)
  const onGrade = candidates.filter(c =>
    sharesLevel(levels.get(nodes[c.from]), levels.get(nodes[c.to])),
  )
  const { parent, rank } = laneComponents(graph, nodes)
  const { selected, droppedSameComponent, droppedBeyondLimit, keptForConnectivity } =
    selectGapEdges(onGrade, nodes.length, parent, rank, maxGapsPerNode)

  const barrierIndex = barriers ? buildBarrierIndex(barriers) : null
  let barrierCrossings = 0

  for (const c of selected) {
    const aLon = lons[c.from],
      aLat = lats[c.from],
      bLon = lons[c.to],
      bLat = lats[c.to]
    const barrier = barrierIndex ? findBlockingBarrier(barrierIndex, aLon, aLat, bLon, bLat) : null
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
          [aLon, aLat],
          [bLon, bLat],
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
    barriersChecked: barrierIndex !== null,
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
 * Counts are stored as the graph attribute `gapStats` and read with getGapStats;
 * the node index that found the pairs is stored as `nodeIndex` for the
 * queries below.
 */
export function buildGraph(
  lanes: BikeLane[],
  maxGapMeters: number,
  options: GraphOptions = {},
): BikeLaneGraph {
  const graph: BikeLaneGraph = new Graph({ type: 'undirected', multi: false })

  const { levels, stats: laneStats } = addLaneEdges(graph, lanes)
  const index = buildNodeIndex(
    graph,
    maxGapMeters > 0 ? maxGapMeters : INDEX_CELL_METERS_WITHOUT_GAPS,
  )

  const stats =
    maxGapMeters > 0
      ? addGapEdges(
          graph,
          index,
          maxGapMeters,
          options.maxGapsPerNode ?? MAX_GAP_EDGES_PER_NODE,
          levels,
          options.barriers,
          options.gapPenalty ?? gapPenaltyFactor,
        )
      : EMPTY_GAP_STATS
  graph.setAttribute('laneStats', laneStats)
  graph.setAttribute('gapStats', stats)
  graph.setAttribute('maxGapMeters', maxGapMeters)
  graph.setAttribute('nodeIndex', index)

  return graph
}

/** The gap tolerance a graph was built with; 0 for graphs not built by buildGraph. */
export function getMaxGapMeters(graph: BikeLaneGraph): number {
  return graph.getAttribute('maxGapMeters') ?? 0
}

/** Lane pass counts for a graph, all zero for graphs not built by buildGraph. */
export function getLaneStats(graph: BikeLaneGraph): LaneStats {
  return graph.getAttribute('laneStats') ?? EMPTY_LANE_STATS
}

/** Gap pruning counts for a graph, all zero for graphs not built by buildGraph. */
export function getGapStats(graph: BikeLaneGraph): GapStats {
  return graph.getAttribute('gapStats') ?? EMPTY_GAP_STATS
}

/**
 * Returns the key of the graph node closest to the given coordinate, or null
 * for an empty graph. Distance is approxMeters through the node index, the
 * same measure nodesWithinMeters uses, so the two cannot disagree about
 * which node is nearest.
 */
export function nearestNode(graph: BikeLaneGraph, lon: number, lat: number): string | null {
  const index = nodeIndexOf(graph)
  const nearest = nearestPoint(index.points, lon, lat)
  return nearest ? index.keys[nearest.index] : null
}

/**
 * Returns keys of all graph nodes within maxMeters of the given coordinate,
 * in node order. Falls back to the single nearest node when none are within
 * the radius, so the result is never empty as long as the graph has at least
 * one node.
 */
export function nodesWithinMeters(
  graph: BikeLaneGraph,
  lon: number,
  lat: number,
  maxMeters: number,
): string[] {
  const index = nodeIndexOf(graph)
  const candidates = pointsWithin(index.points, lon, lat, maxMeters).map(i => index.keys[i])

  if (candidates.length === 0) {
    const nearest = nearestPoint(index.points, lon, lat)
    if (nearest) candidates.push(index.keys[nearest.index])
  }

  return candidates
}
