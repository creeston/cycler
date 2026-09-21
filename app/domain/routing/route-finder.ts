import type { LineString } from 'geojson'
import type { BikeLane } from '../entities/bike-lane'
import type { BarrierData } from '../entities/barrier'
import type {
  ResolvedRoutePreferences,
  Route,
  RoutePreferences,
  RouteSegment,
} from '../entities/route'
import { buildGraph, getGapStats, getMaxGapMeters, nearestNode, nodesWithinMeters } from './graph'
import type { BikeLaneGraph, EdgeAttrs } from './graph'
import { longestGapMeters } from '../entities/route'
import { bearingDegrees, coordKey, destinationPoint } from './algorithms'
import { seededRandom } from './random'
import { astar, haversineTo, shortestPathTree, treePath } from './search'
import type { TreeNode } from './search'

/** Expand gap tolerance to this if too few routes are found at normal gap. */
const EXPANDED_GAP_METERS = 1_000
const MIN_ROUTES_BEFORE_EXPAND = 3
/** Far points cast around the start for round trips, evenly spread; the seed rotates the fan. */
const N_BEARINGS = 12
/** Explore routes per start candidate, one per sector of bearing. */
const MAX_EXPLORE_ROUTES = 12
/**
 * What the return leg of a loop pays to ride an outbound edge again. Large
 * enough that it happens only where nothing else leads home — the retraced
 * tail of a dead end — which closeLoop then cuts off.
 */
const RETRACE_COST_FACTOR = 1_000

// ---------------------------------------------------------------------------
// Routing strategy interface
// ---------------------------------------------------------------------------

/**
 * A routing strategy encapsulates one algorithm variant (explore, round-trip,
 * one-way). Adding a new routing mode means implementing this interface and
 * registering it in buildStrategy — no changes needed elsewhere.
 */
export interface RoutingStrategy {
  findRoutes(graph: BikeLaneGraph, startKey: string): Route[]
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Returns edge geometry oriented in the traversal direction (fromKey → toKey).
 * Edge geometries are stored in the direction the lane was ingested, which may
 * differ from the direction of travel. Reversing when needed ensures that
 * segment geometries always reflect the actual path direction.
 */
function orientedGeometry(fromKey: string, attrs: EdgeAttrs): LineString {
  if (attrs.startKey === fromKey) return attrs.geometry
  return { type: 'LineString', coordinates: [...attrs.geometry.coordinates].reverse() }
}

function toSegment(fromKey: string, attrs: EdgeAttrs): RouteSegment {
  return {
    geometry: orientedGeometry(fromKey, attrs),
    type: attrs.isGap ? 'gap' : 'bike_lane',
    distanceMeters: attrs.distanceMeters,
    ...(attrs.barrier ? { crossesBarrier: attrs.barrier } : {}),
  }
}

function segmentsToRoute(
  segments: RouteSegment[],
  barriersChecked: boolean,
  gapMeters: number,
): Route {
  const total = segments.reduce((s, seg) => s + seg.distanceMeters, 0)
  const laneDist = segments
    .filter(s => s.type === 'bike_lane')
    .reduce((s, seg) => s + seg.distanceMeters, 0)
  const gapDist = segments
    .filter(s => s.type === 'gap')
    .reduce((s, seg) => s + seg.distanceMeters, 0)
  return {
    id: crypto.randomUUID(),
    segments,
    totalDistanceMeters: total,
    bikeLaneDistanceMeters: laneDist,
    bikeLaneCoverage: total > 0 ? laneDist / total : 0,
    gapCount: segments.filter(s => s.type === 'gap').length,
    gapDistanceMeters: gapDist,
    barrierCrossingCount: segments.filter(s => s.crossesBarrier !== undefined).length,
    barriersChecked,
    requestedGapMeters: gapMeters,
    appliedGapMeters: gapMeters,
    createdAt: new Date(),
  }
}

function compareKeys(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Returns the lexicographically smallest rotation in linear time. */
function minimalRotation(keys: string[]): string[] {
  if (keys.length < 2) return [...keys]

  const doubled = [...keys, ...keys]
  const length = keys.length
  let first = 0
  let second = 1
  let offset = 0

  while (first < length && second < length && offset < length) {
    const comparison = compareKeys(doubled[first + offset], doubled[second + offset])
    if (comparison === 0) {
      offset++
      continue
    }

    if (comparison > 0) {
      first += offset + 1
      if (first === second) first++
    } else {
      second += offset + 1
      if (first === second) second++
    }
    offset = 0
  }

  const start = Math.min(first, second)
  return doubled.slice(start, start + length)
}

/**
 * Canonical node-sequence signature for route deduplication.
 *
 * Coordinates are snapped through coordKey, open routes compare equal in
 * either direction, and loops additionally compare equal from every entry
 * node. Keeping the ordered node sequence (rather than only an edge set)
 * preserves repeated traversals as part of the ride.
 */
export function routeSignature(segments: RouteSegment[]): string {
  if (segments.length === 0) return ''

  const keys = segments.map(segment => {
    const [lon, lat] = segment.geometry.coordinates[0]
    return coordKey(lon, lat)
  })
  const finalCoordinates = segments[segments.length - 1].geometry.coordinates
  const [finalLon, finalLat] = finalCoordinates[finalCoordinates.length - 1]
  keys.push(coordKey(finalLon, finalLat))

  if (keys[0] === keys[keys.length - 1]) {
    const cycle = keys.slice(0, -1)
    const forward = minimalRotation(cycle).join('|')
    const reverse = minimalRotation([...cycle].reverse()).join('|')
    return forward < reverse ? forward : reverse
  }

  const forward = keys.join('|')
  const reverse = [...keys].reverse().join('|')
  return forward < reverse ? forward : reverse
}

// ---------------------------------------------------------------------------
// Core search algorithms (used by the strategies below)
// ---------------------------------------------------------------------------

function pathSegments(graph: BikeLaneGraph, nodePath: string[]): RouteSegment[] {
  const segments: RouteSegment[] = []
  for (let i = 0; i < nodePath.length - 1; i++) {
    const attrs = graph.getEdgeAttributes(graph.edge(nodePath[i], nodePath[i + 1])!)
    segments.push(toSegment(nodePath[i], attrs))
  }
  return segments
}

function pathEdges(graph: BikeLaneGraph, nodePath: string[]): string[] {
  const edges: string[] = []
  for (let i = 0; i < nodePath.length - 1; i++) {
    edges.push(graph.edge(nodePath[i], nodePath[i + 1])!)
  }
  return edges
}

function totalMeters(segments: RouteSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.distanceMeters, 0)
}

/**
 * Finds the cheapest path from startKey to endKey with A*, weighted by
 * costMeters and guided by the great-circle distance to the end (see
 * haversineTo for why that stays admissible with gap penalties). The
 * distance bounds are checked against real length, not cost.
 * Returns null when no path exists or the path falls outside [minDist, maxDist].
 */
function findShortestPath(
  graph: BikeLaneGraph,
  startKey: string,
  endKey: string,
  minDist: number,
  maxDist: number,
): RouteSegment[] | null {
  const { path } = astar(graph, startKey, endKey, { heuristic: haversineTo(graph, endKey) })
  if (!path) return null

  const segments = pathSegments(graph, path)
  const total = totalMeters(segments)
  if (total < minDist || total > maxDist) return null
  return segments
}

/**
 * Closes a loop through farKey: the cheapest path out (read from the start's
 * shortest-path tree), then the cheapest path back that pays
 * RETRACE_COST_FACTOR to reuse an outbound edge. When the far node is a dead
 * end the return has no choice but to retrace the spur; that shared tail is
 * cut off both legs, which moves the far point back to the last junction. Any
 * other repeated edge means no loop exists that respects the round-trip
 * promise, and null is returned.
 */
function closeLoop(
  graph: BikeLaneGraph,
  tree: Map<string, TreeNode>,
  startKey: string,
  farKey: string,
): string[] | null {
  if (!tree.has(farKey)) return null
  const out = treePath(tree, farKey)
  const outEdges = pathEdges(graph, out)
  const outSet = new Set(outEdges)

  const back = astar(graph, farKey, startKey, {
    heuristic: haversineTo(graph, startKey),
    edgeCostFactor: edgeKey => (outSet.has(edgeKey) ? RETRACE_COST_FACTOR : 1),
  }).path
  if (!back) return null
  const backEdges = pathEdges(graph, back)

  let shared = 0
  while (
    shared < outEdges.length &&
    shared < backEdges.length &&
    outEdges[outEdges.length - 1 - shared] === backEdges[shared]
  ) {
    shared++
  }
  const outNodes = out.slice(0, out.length - shared)
  const backNodes = back.slice(shared)
  if (outNodes.length < 2) return null

  const kept = new Set(outEdges.slice(0, outEdges.length - shared))
  if (backEdges.slice(shared).some(edgeKey => kept.has(edgeKey))) return null

  return [...outNodes, ...backNodes.slice(1)]
}

/**
 * Round trips from startKey. A loop of length L is roughly a circle of
 * diameter L/π, so a far point is cast that far from the start on each of
 * N_BEARINGS bearings, snapped to the nearest node, and closeLoop joins the
 * two legs. The outbound legs all come from one shortest-path tree, bounded
 * at maxDist because a longer leg cannot be part of a loop that fits. Loops
 * outside [minDist, maxDist] are dropped; the bearing fan is rotated by
 * bearingOffset so different seeds cast at different points.
 */
function farPointLoops(
  graph: BikeLaneGraph,
  startKey: string,
  minDist: number,
  maxDist: number,
  bearingOffset: number,
): RouteSegment[][] {
  const start = graph.getNodeAttributes(startKey)
  const tree = shortestPathTree(graph, startKey, maxDist)
  const farMeters = (minDist + maxDist) / 2 / Math.PI
  const step = 360 / N_BEARINGS
  const loops: RouteSegment[][] = []
  const tried = new Set<string>()

  for (let i = 0; i < N_BEARINGS; i++) {
    const [lon, lat] = destinationPoint(start.lon, start.lat, farMeters, bearingOffset + i * step)
    const farKey = nearestNode(graph, lon, lat)?.key
    if (!farKey || farKey === startKey || tried.has(farKey)) continue
    tried.add(farKey)

    const loop = closeLoop(graph, tree, startKey, farKey)
    if (!loop) continue
    const segments = pathSegments(graph, loop)
    const total = totalMeters(segments)
    if (total >= minDist && total <= maxDist) loops.push(segments)
  }

  return loops
}

/**
 * Explore routes from startKey: the cheapest path to a destination in each
 * direction. One bounded shortest-path tree gives the cheapest path to every
 * node within maxDist; the nodes at least minDist away are the candidates.
 * They are split into MAX_EXPLORE_ROUTES sectors by bearing from the start,
 * and each sector contributes the candidate nearest the middle of the
 * distance range. A destination on the way to another chosen destination is
 * dropped, since its route is a prefix of the longer one.
 */
function exploreRoutes(
  graph: BikeLaneGraph,
  startKey: string,
  minDist: number,
  maxDist: number,
): RouteSegment[][] {
  const tree = shortestPathTree(graph, startKey, maxDist)
  const inRange = [...tree.entries()].filter(
    ([key, node]) => key !== startKey && node.distanceMeters >= minDist,
  )
  const candidates = lastResortFilter(inRange, ([, node]) => node.barrierCrossings > 0)
  if (candidates.length === 0) return []

  const start = graph.getNodeAttributes(startKey)
  const bearingOf = new Map(
    candidates.map(([key]) => {
      const node = graph.getNodeAttributes(key)
      return [key, bearingDegrees(start.lon, start.lat, node.lon, node.lat)]
    }),
  )
  candidates.sort(([a], [b]) => bearingOf.get(a)! - bearingOf.get(b)!)

  const target = (minDist + maxDist) / 2
  const sectors = Math.min(MAX_EXPLORE_ROUTES, candidates.length)
  const sectorSize = candidates.length / sectors
  const picked = new Set<string>()
  for (let i = 0; i < sectors; i++) {
    const sector = candidates.slice(Math.floor(i * sectorSize), Math.floor((i + 1) * sectorSize))
    const [best] = sector.reduce((a, b) => (closerToTarget(a[1], b[1], target) ? a : b))
    picked.add(best)
  }

  const onTheWay = new Set<string>()
  for (const key of picked) {
    for (const ancestor of treePath(tree, key).slice(0, -1)) onTheWay.add(ancestor)
  }

  return [...picked]
    .filter(key => !onTheWay.has(key))
    .map(key => pathSegments(graph, treePath(tree, key)))
}

function closerToTarget(a: TreeNode, b: TreeNode, target: number): boolean {
  const gapA = Math.abs(a.distanceMeters - target)
  const gapB = Math.abs(b.distanceMeters - target)
  if (gapA !== gapB) return gapA < gapB
  return a.costMeters <= b.costMeters
}

/**
 * Keeps the items that are not a last resort, unless nothing else is left.
 * Gaps that cross a barrier are priced 50× so a search takes them only when
 * nothing cheaper leads there; this is the second half of that rule — a route
 * over one is offered only when no clean route exists at all.
 */
function lastResortFilter<T>(items: T[], isLastResort: (item: T) => boolean): T[] {
  const clean = items.filter(item => !isLastResort(item))
  return clean.length > 0 ? clean : items
}

// ---------------------------------------------------------------------------
// Public runners (used directly by tests and by strategy implementations)
// ---------------------------------------------------------------------------

function toRoutes(graph: BikeLaneGraph, candidates: RouteSegment[][]): Route[] {
  const barriersChecked = getGapStats(graph).barriersChecked
  const gapMeters = getMaxGapMeters(graph)
  const seen = new Set<string>()
  const routes: Route[] = []
  for (const segments of candidates) {
    const sig = routeSignature(segments)
    if (seen.has(sig)) continue
    seen.add(sig)
    routes.push(segmentsToRoute(segments, barriersChecked, gapMeters))
  }
  return routes
}

/** Explore routes from startKey; see exploreRoutes. Deterministic. */
export function runExplore(
  graph: BikeLaneGraph,
  startKey: string,
  minDist: number,
  maxDist: number,
): Route[] {
  return toRoutes(graph, exploreRoutes(graph, startKey, minDist, maxDist))
}

/**
 * Round trips from startKey; see farPointLoops. The seed only rotates the
 * bearing fan, so the same seed always gives the same loops. Loops crossing a
 * barrier are offered only when no clean loop was found.
 */
export function runRoundTrip(
  graph: BikeLaneGraph,
  startKey: string,
  minDist: number,
  maxDist: number,
  seed = 0,
): Route[] {
  const bearingOffset = seededRandom(seed)() * (360 / N_BEARINGS)
  const loops = farPointLoops(graph, startKey, minDist, maxDist, bearingOffset)
  return toRoutes(
    graph,
    lastResortFilter(loops, segments => segments.some(s => s.crossesBarrier !== undefined)),
  )
}

/**
 * Finds the shortest one-way route from startKey to endKey with A*.
 * Returns an array with one route, or empty if no path exists within [minDist, maxDist].
 */
export function runOneWay(
  graph: BikeLaneGraph,
  startKey: string,
  endKey: string,
  minDist: number,
  maxDist: number,
): Route[] {
  const segments = findShortestPath(graph, startKey, endKey, minDist, maxDist)
  if (!segments) return []
  return toRoutes(graph, [segments])
}

// ---------------------------------------------------------------------------
// Strategy implementations
// ---------------------------------------------------------------------------

function exploreStrategy(minDist: number, maxDist: number): RoutingStrategy {
  return {
    findRoutes: (graph, startKey) => runExplore(graph, startKey, minDist, maxDist),
  }
}

function roundTripStrategy(minDist: number, maxDist: number, seed: number): RoutingStrategy {
  return {
    findRoutes: (graph, startKey) => runRoundTrip(graph, startKey, minDist, maxDist, seed),
  }
}

function oneWayStrategy(endKey: string, minDist: number, maxDist: number): RoutingStrategy {
  return {
    findRoutes: (graph, startKey) => {
      if (startKey === endKey) return []
      return runOneWay(graph, startKey, endKey, minDist, maxDist)
    },
  }
}

function buildStrategy(
  preferences: RoutePreferences,
  seed: number,
  endKey?: string,
): RoutingStrategy {
  const { minDistanceMeters: min, maxDistanceMeters: max } = preferences
  if (endKey) return oneWayStrategy(endKey, min, max)
  if (preferences.roundTrip) return roundTripStrategy(min, max, seed)
  return exploreStrategy(min, max)
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** How far a search has got: the graph build is one step, each start candidate another. */
export interface RoutingProgress {
  completed: number
  /** Grows when the search widens the gap tolerance and runs again. */
  total: number
}

interface ProgressCounter {
  add(steps: number): void
  step(): void
}

function progressCounter(onProgress?: (progress: RoutingProgress) => void): ProgressCounter {
  let completed = 0
  let total = 0
  const report = () => onProgress?.({ completed, total })
  return {
    add: steps => {
      total += steps
      report()
    },
    step: () => {
      completed++
      report()
    },
  }
}

// ---------------------------------------------------------------------------
// Multi-candidate execution
// ---------------------------------------------------------------------------

/**
 * Drops any route carrying a gap longer than the tolerance it was built for.
 *
 * buildGraph cannot create such an edge, so this is a guard rather than a
 * filter: if it ever removes a route, the graph and the promise made to the
 * rider have come apart, and the rider should not be the one to find out.
 */
function withinTolerance(routes: Route[]): Route[] {
  const kept = routes.filter(route => longestGapMeters(route) <= route.appliedGapMeters)
  if (kept.length !== routes.length) {
    console.warn(
      `Dropped ${routes.length - kept.length} route(s) carrying a gap longer than the tolerance they were built for.`,
    )
  }
  return kept
}

/**
 * Runs a routing strategy from every start candidate within startProximityMeters
 * of the given coordinate, deduplicating routes across all candidates.
 * Using multiple start candidates increases route diversity when the user is
 * near several bike lane entrances.
 */
function executeWithCandidates(
  graph: BikeLaneGraph,
  startLon: number,
  startLat: number,
  proximityMeters: number,
  strategy: RoutingStrategy,
  progress: ProgressCounter,
): Route[] {
  const startCandidates = nodesWithinMeters(graph, startLon, startLat, proximityMeters)
  progress.add(startCandidates.length)
  const seen = new Set<string>()
  const routes: Route[] = []

  for (const startKey of startCandidates) {
    for (const route of strategy.findRoutes(graph, startKey)) {
      const sig = routeSignature(route.segments)
      if (!seen.has(sig)) {
        seen.add(sig)
        routes.push(route)
      }
    }
    progress.step()
  }

  return routes
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface RoutingOptions {
  /** Barrier geometry for the gap veto; omitted means gaps are not checked. */
  barriers?: BarrierData
  /**
   * Rotates the round-trip bearing fan. The same lanes, preferences and seed
   * always give the same routes, so a route can be reproduced from its inputs.
   */
  seed?: number
  /** Called after the graph build and after each start candidate. */
  onProgress?: (progress: RoutingProgress) => void
}

/**
 * Finds route candidates based on the given preferences. The three strategies
 * are described in docs/algorithms.md §5; in one line each:
 *
 * - One-way  (endLon + endLat set): A* to the node nearest the destination,
 *   guided by great-circle distance; one route, the cheapest.
 * - Round-trip (roundTrip: true): far points cast around the start, a path
 *   out to each and an edge-disjoint path back.
 * - Explore   (default): the cheapest path to a destination in each direction,
 *   from one bounded shortest-path tree.
 *
 * Every strategy runs from each lane endpoint within startProximityMeters of
 * the start coordinate, and the routes are deduplicated across candidates.
 *
 * When too few routes are found the tolerance is widened to EXPANDED_GAP_METERS and the
 * search repeats. Routes from that pass keep the rider's original figure in
 * requestedGapMeters, so wasGapToleranceWidened can say what happened — the override is
 * recorded rather than silent.
 */
export function findRoutes(
  lanes: BikeLane[],
  preferences: ResolvedRoutePreferences,
  options: RoutingOptions = {},
): Route[] {
  const { startLon, startLat, endLon, endLat, startProximityMeters } = preferences
  const { barriers, seed = 0, onProgress } = options
  const progress = progressCounter(onProgress)

  progress.add(1)
  let graph = buildGraph(lanes, preferences.maxGapMeters, { barriers })
  progress.step()

  const endKey =
    endLon !== undefined && endLat !== undefined
      ? nearestNode(graph, endLon, endLat)?.key
      : undefined

  const strategy = buildStrategy(preferences, seed, endKey)

  let routes = withinTolerance(
    executeWithCandidates(graph, startLon, startLat, startProximityMeters, strategy, progress),
  )

  const tooFew = endKey ? routes.length === 0 : routes.length < MIN_ROUTES_BEFORE_EXPAND
  if (tooFew && preferences.maxGapMeters < EXPANDED_GAP_METERS) {
    progress.add(1)
    graph = buildGraph(lanes, EXPANDED_GAP_METERS, { barriers })
    progress.step()
    routes = withinTolerance(
      executeWithCandidates(graph, startLon, startLat, startProximityMeters, strategy, progress),
    ).map(route => ({ ...route, requestedGapMeters: preferences.maxGapMeters }))
  }

  // One-way routing runs A* per start candidate — return only the globally cheapest.
  if (endKey && routes.length > 1) {
    routes = [routes.reduce((a, b) => (a.totalDistanceMeters <= b.totalDistanceMeters ? a : b))]
  }

  return routes
}
