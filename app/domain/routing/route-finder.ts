import type { LineString } from 'geojson'
import dijkstra from 'graphology-shortest-path/dijkstra'
import type { BikeLane } from '../entities/bike-lane'
import type { BarrierData } from '../entities/barrier'
import type { Route, RoutePreferences, RouteSegment } from '../entities/route'
import { buildGraph, getGapStats, nearestNode, nodesWithinMeters } from './graph'
import type { BikeLaneGraph, EdgeAttrs } from './graph'

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

/**
 * Returns edge geometry oriented in the traversal direction (fromKey → toKey).
 * Edge geometries are stored in the direction the lane was ingested, which may
 * differ from the walk traversal direction. Reversing when needed ensures that
 * segment geometries always reflect the actual path direction.
 */
function orientedGeometry(graph: BikeLaneGraph, fromKey: string, attrs: EdgeAttrs): LineString {
  const fromAttrs = graph.getNodeAttributes(fromKey)
  const first = attrs.geometry.coordinates[0]
  if (Math.abs(first[0] - fromAttrs.lon) < 1e-9 && Math.abs(first[1] - fromAttrs.lat) < 1e-9) {
    return attrs.geometry
  }
  return { type: 'LineString', coordinates: [...attrs.geometry.coordinates].reverse() }
}

function toSegment(graph: BikeLaneGraph, fromKey: string, attrs: EdgeAttrs): RouteSegment {
  return {
    geometry: orientedGeometry(graph, fromKey, attrs),
    type: attrs.isGap ? 'gap' : 'bike_lane',
    distanceMeters: attrs.distanceMeters,
    ...(attrs.barrier ? { crossesBarrier: attrs.barrier } : {}),
  }
}

/**
 * Bike lanes first, then clean gaps, then gaps that cross a barrier. Each tier
 * is offered only when the tier above it is empty, so a flagged gap is a last
 * resort rather than one option among many.
 */
function preferredNeighbours(
  graph: BikeLaneGraph,
  current: string,
  neighbours: string[],
): string[] {
  const lanes: string[] = []
  const cleanGaps: string[] = []
  const barrierGaps: string[] = []

  for (const neighbour of neighbours) {
    const attrs = graph.getEdgeAttributes(graph.edge(current, neighbour)!)
    if (!attrs.isGap) lanes.push(neighbour)
    else if (attrs.barrier) barrierGaps.push(neighbour)
    else cleanGaps.push(neighbour)
  }

  if (lanes.length > 0) return lanes
  return cleanGaps.length > 0 ? cleanGaps : barrierGaps
}

function segmentsToRoute(segments: RouteSegment[], barriersChecked: boolean): Route {
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
 * At each step picks from the best available tier of edges (preferredNeighbours):
 * bike lanes, then clean gaps, then gaps that cross a barrier.
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

    const next = pickRandom(preferredNeighbours(graph, current, neighbours))

    const edgeKey = graph.edge(current, next)
    const attrs = graph.getEdgeAttributes(edgeKey)

    total += attrs.distanceMeters
    segments.push(toSegment(graph, current, attrs))

    visited.add(next)
    current = next

    if (total >= minDist) return segments
  }

  return null
}

/**
 * Round-trip random walk from startKey.
 * Never reuses the same edge. Returns to startKey to complete the loop.
 * Uses the same tier preference as randomWalk at each step.
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

    const next = pickRandom(preferredNeighbours(graph, current, availableNeighbours))

    const edgeKey = graph.edge(current, next)!
    const attrs = graph.getEdgeAttributes(edgeKey)

    if (total + attrs.distanceMeters > maxDist) return null

    total += attrs.distanceMeters
    visitedEdges.add(edgeKey)
    segments.push(toSegment(graph, current, attrs))
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
    segments.push(toSegment(graph, from, attrs))
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
      routes.push(segmentsToRoute(segs, barriersChecked))
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
  return segments ? [segmentsToRoute(segments, getGapStats(graph).barriersChecked)] : []
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
 * Expands gap tolerance to EXPANDED_GAP_METERS when too few routes are found.
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

  let routes = executeWithCandidates(graph, startLon, startLat, startProximityMeters, strategy)

  const tooFew = endKey ? routes.length === 0 : routes.length < MIN_ROUTES_BEFORE_EXPAND
  if (tooFew && preferences.maxGapMeters < EXPANDED_GAP_METERS) {
    graph = buildGraph(lanes, EXPANDED_GAP_METERS, { barriers })
    routes = executeWithCandidates(graph, startLon, startLat, startProximityMeters, strategy)
  }

  // One-way routing uses Dijkstra per start candidate — return only the globally shortest.
  if (endKey && routes.length > 1) {
    routes = [routes.reduce((a, b) => (a.totalDistanceMeters <= b.totalDistanceMeters ? a : b))]
  }

  return routes
}
