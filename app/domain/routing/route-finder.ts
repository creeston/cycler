import type { LineString } from 'geojson'
import dijkstra from 'graphology-shortest-path/dijkstra'
import type { BikeLane } from '../entities/bike-lane'
import type { BarrierData } from '../entities/barrier'
import type { Route, RoutePreferences, RouteSegment } from '../entities/route'
import { buildGraph, getGapStats, getMaxGapMeters, nearestNode, nodesWithinMeters } from './graph'
import type { BikeLaneGraph, EdgeAttrs } from './graph'
import { longestGapMeters } from '../entities/route'

const N_ATTEMPTS = 80
/** Expand gap tolerance to this if too few routes are found at normal gap. */
const EXPANDED_GAP_METERS = 1_000
const MIN_ROUTES_BEFORE_EXPAND = 3

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

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Picks one item with probability proportional to its weight. */
function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return pickRandom(items)

  let ticket = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    ticket -= weights[i]
    if (ticket < 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * Returns edge geometry oriented in the traversal direction (fromKey → toKey).
 * Edge geometries are stored in the direction the lane was ingested, which may
 * differ from the walk traversal direction. Reversing when needed ensures that
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

/**
 * Chooses the next node, weighted against gaps rather than forbidding them.
 *
 * Each edge weighs `distanceMeters / costMeters`, the reciprocal of its cost
 * premium: 1 for a lane, 1/gapPenaltyFactor for a gap. Dividing by length
 * matters — weighing raw cost would make the walk prefer short lanes over long
 * ones, which has nothing to do with the premise.
 *
 * Gaps that cross a barrier stay a strict last resort instead of joining the
 * draw. Their premium would give them a small but real chance at every
 * junction, and "a route that crosses an arterial where you cannot cross, 2 %
 * of the time" is not a trade the premise allows.
 */
function chooseNeighbour(graph: BikeLaneGraph, current: string, neighbours: string[]): string {
  const open: string[] = []
  const weights: number[] = []
  const barrierGaps: string[] = []

  for (const neighbour of neighbours) {
    const attrs = graph.getEdgeAttributes(graph.edge(current, neighbour)!)
    if (attrs.barrier) {
      barrierGaps.push(neighbour)
      continue
    }
    open.push(neighbour)
    weights.push(attrs.costMeters > 0 ? attrs.distanceMeters / attrs.costMeters : 1)
  }

  if (open.length === 0) return pickRandom(barrierGaps)
  return pickWeighted(open, weights)
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
  return {
    id: crypto.randomUUID(),
    segments,
    totalDistanceMeters: total,
    bikeLaneDistanceMeters: laneDist,
    bikeLaneCoverage: total > 0 ? laneDist / total : 0,
    gapCount: segments.filter(s => s.type === 'gap').length,
    barrierCrossingCount: segments.filter(s => s.crossesBarrier !== undefined).length,
    barriersChecked,
    requestedGapMeters: gapMeters,
    appliedGapMeters: gapMeters,
    createdAt: new Date(),
  }
}

/** Route signature for deduplication — first coord of every segment joined. */
function signature(segments: RouteSegment[]): string {
  return segments.map(s => s.geometry.coordinates[0].join(',')).join('|')
}

// ---------------------------------------------------------------------------
// Core walk algorithms (used by the strategies below)
// ---------------------------------------------------------------------------

/**
 * Single random walk from startKey.
 * At each step chooses a neighbour with chooseNeighbour, which weighs gaps
 * against lanes by their cost premium.
 * Returns segments if a walk of [minDist, maxDist] was completed, else null.
 */
function randomWalk(
  graph: BikeLaneGraph,
  startKey: string,
  minDist: number,
  maxDist: number,
): RouteSegment[] | null {
  const visited = new Set([startKey])
  let current = startKey
  let total = 0
  const segments: RouteSegment[] = []

  while (total < maxDist) {
    const neighbours = graph.neighbors(current).filter(n => !visited.has(n))
    if (neighbours.length === 0) break

    const next = chooseNeighbour(graph, current, neighbours)

    const edgeKey = graph.edge(current, next)
    const attrs = graph.getEdgeAttributes(edgeKey)

    total += attrs.distanceMeters
    segments.push(toSegment(current, attrs))

    visited.add(next)
    current = next

    if (total >= minDist) return segments
  }

  return null
}

/**
 * Round-trip random walk from startKey.
 * Never reuses the same edge. Returns to startKey to complete the loop.
 * Uses the same weighted choice as randomWalk at each step.
 * Returns segments when back at startKey with total in [minDist, maxDist], else null.
 */
function randomWalkRoundTrip(
  graph: BikeLaneGraph,
  startKey: string,
  minDist: number,
  maxDist: number,
): RouteSegment[] | null {
  const visitedEdges = new Set<string>()
  let current = startKey
  let total = 0
  const segments: RouteSegment[] = []

  while (true) {
    if (segments.length > 0 && current === startKey) {
      return total >= minDist ? segments : null
    }

    const availableNeighbours = graph.neighbors(current).filter(n => {
      const edgeKey = graph.edge(current, n)!
      return !visitedEdges.has(edgeKey)
    })

    if (availableNeighbours.length === 0) return null

    const next = chooseNeighbour(graph, current, availableNeighbours)

    const edgeKey = graph.edge(current, next)!
    const attrs = graph.getEdgeAttributes(edgeKey)

    if (total + attrs.distanceMeters > maxDist) return null

    total += attrs.distanceMeters
    visitedEdges.add(edgeKey)
    segments.push(toSegment(current, attrs))
    current = next
  }
}

/**
 * Finds the cheapest path from startKey to endKey using Dijkstra's algorithm,
 * weighted by costMeters — length for an ordinary edge, length times
 * BARRIER_COST_MULTIPLIER for a gap that crosses a barrier. The distance
 * bounds are still checked against real length, not cost.
 * Returns null when no path exists or the path falls outside [minDist, maxDist].
 */
function findShortestPath(
  graph: BikeLaneGraph,
  startKey: string,
  endKey: string,
  minDist: number,
  maxDist: number,
): RouteSegment[] | null {
  const nodePath = dijkstra.bidirectional(graph, startKey, endKey, 'costMeters')
  if (!nodePath) return null

  const segments: RouteSegment[] = []
  let total = 0

  for (let i = 0; i < nodePath.length - 1; i++) {
    const from = nodePath[i]
    const to = nodePath[i + 1]
    const edgeKey = graph.edge(from, to)!
    const attrs = graph.getEdgeAttributes(edgeKey)
    total += attrs.distanceMeters
    segments.push(toSegment(from, attrs))
  }

  if (total < minDist || total > maxDist) return null
  return segments
}

// ---------------------------------------------------------------------------
// Public walk runners (used directly by tests and by strategy implementations)
// ---------------------------------------------------------------------------

export function runWalks(
  graph: BikeLaneGraph,
  startKey: string,
  minDist: number,
  maxDist: number,
  roundTrip = false,
): Route[] {
  const barriersChecked = getGapStats(graph).barriersChecked
  const gapMeters = getMaxGapMeters(graph)
  const seen = new Set<string>()
  const routes: Route[] = []
  for (let i = 0; i < N_ATTEMPTS; i++) {
    const segs = roundTrip
      ? randomWalkRoundTrip(graph, startKey, minDist, maxDist)
      : randomWalk(graph, startKey, minDist, maxDist)
    if (!segs) continue
    const sig = signature(segs)
    if (!seen.has(sig)) {
      seen.add(sig)
      routes.push(segmentsToRoute(segs, barriersChecked, gapMeters))
    }
  }
  return routes
}

/**
 * Finds the shortest one-way route from startKey to endKey using Dijkstra.
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
  return [segmentsToRoute(segments, getGapStats(graph).barriersChecked, getMaxGapMeters(graph))]
}

// ---------------------------------------------------------------------------
// Strategy implementations
// ---------------------------------------------------------------------------

function exploreStrategy(minDist: number, maxDist: number): RoutingStrategy {
  return {
    findRoutes: (graph, startKey) => runWalks(graph, startKey, minDist, maxDist, false),
  }
}

function roundTripStrategy(minDist: number, maxDist: number): RoutingStrategy {
  return {
    findRoutes: (graph, startKey) => runWalks(graph, startKey, minDist, maxDist, true),
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

function buildStrategy(preferences: RoutePreferences, endKey?: string): RoutingStrategy {
  const { minDistanceMeters: min, maxDistanceMeters: max } = preferences
  if (endKey) return oneWayStrategy(endKey, min, max)
  if (preferences.roundTrip) return roundTripStrategy(min, max)
  return exploreStrategy(min, max)
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
): Route[] {
  const startCandidates = nodesWithinMeters(graph, startLon, startLat, proximityMeters)
  const seen = new Set<string>()
  const routes: Route[] = []

  for (const startKey of startCandidates) {
    for (const route of strategy.findRoutes(graph, startKey)) {
      const sig = signature(route.segments)
      if (!seen.has(sig)) {
        seen.add(sig)
        routes.push(route)
      }
    }
  }

  return routes
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Finds route candidates based on the given preferences.
 *
 * - One-way  (endLon + endLat set): DFS finds all simple paths from start to end
 *   without repeating any edge, up to MAX_ONE_WAY_PATHS routes.
 * - Round-trip (roundTrip: true): random walks returning to start without edge repetition.
 * - Explore   (default): random walks from start up to maxDistanceMeters.
 *
 * All bike lane endpoints within startProximityMeters of the start coordinate are
 * used as candidates, increasing route diversity near multi-lane junctions.
 *
 * When too few routes are found the tolerance is widened to EXPANDED_GAP_METERS and the
 * search repeats. Routes from that pass keep the rider's original figure in
 * requestedGapMeters, so wasGapToleranceWidened can say what happened — the override is
 * recorded rather than silent.
 */
export function findRoutes(
  lanes: BikeLane[],
  preferences: RoutePreferences,
  barriers?: BarrierData,
): Route[] {
  const { startLon, startLat, endLon, endLat, startProximityMeters } = preferences

  let graph = buildGraph(lanes, preferences.maxGapMeters, { barriers })

  const endKey =
    endLon !== undefined && endLat !== undefined
      ? (nearestNode(graph, endLon, endLat) ?? undefined)
      : undefined

  const strategy = buildStrategy(preferences, endKey)

  let routes = withinTolerance(
    executeWithCandidates(graph, startLon, startLat, startProximityMeters, strategy),
  )

  const tooFew = endKey ? routes.length === 0 : routes.length < MIN_ROUTES_BEFORE_EXPAND
  if (tooFew && preferences.maxGapMeters < EXPANDED_GAP_METERS) {
    graph = buildGraph(lanes, EXPANDED_GAP_METERS, { barriers })
    routes = withinTolerance(
      executeWithCandidates(graph, startLon, startLat, startProximityMeters, strategy),
    ).map(route => ({ ...route, requestedGapMeters: preferences.maxGapMeters }))
  }

  // One-way routing uses Dijkstra per start candidate — return only the globally shortest.
  if (endKey && routes.length > 1) {
    routes = [routes.reduce((a, b) => (a.totalDistanceMeters <= b.totalDistanceMeters ? a : b))]
  }

  return routes
}
