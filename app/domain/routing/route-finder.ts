import type { LineString } from 'geojson'
import type { BikeLane } from '../entities/bike-lane'
import type { Route, RoutePreferences, RouteSegment } from '../entities/route'
import { buildGraph, nearestNode } from './graph'
import type { BikeLaneGraph, EdgeAttrs } from './graph'

const N_ATTEMPTS = 80
/** Expand gap tolerance to this if fewer than MIN_ROUTES are found at normal gap. */
const EXPANDED_GAP_METERS = 1_000
const MIN_ROUTES_BEFORE_EXPAND = 3

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Returns edge geometry oriented in the traversal direction (fromKey → toKey).
 * Edge geometries are stored in the direction the lane was ingested, which may
 * differ from the walk traversal direction. Reversing when needed ensures that
 * segment geometries always reflect the actual path direction.
 */
function orientedGeometry(
  graph: BikeLaneGraph,
  fromKey: string,
  attrs: EdgeAttrs,
): LineString {
  const fromAttrs = graph.getNodeAttributes(fromKey)
  const first = attrs.geometry.coordinates[0]
  if (Math.abs(first[0] - fromAttrs.lon) < 1e-9 && Math.abs(first[1] - fromAttrs.lat) < 1e-9) {
    return attrs.geometry
  }
  return { type: 'LineString', coordinates: [...attrs.geometry.coordinates].reverse() }
}

/**
 * Single random walk from startKey.
 * At each step prefers non-gap (bike-lane) edges; falls back to gap edges
 * only when no lane neighbours are available.
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

    const laneNeighbours = neighbours.filter(n => {
      const key = graph.edge(current, n)
      return !graph.getEdgeAttributes(key).isGap
    })
    const next = pickRandom(laneNeighbours.length > 0 ? laneNeighbours : neighbours)

    const edgeKey = graph.edge(current, next)
    const attrs = graph.getEdgeAttributes(edgeKey)

    total += attrs.distanceMeters
    segments.push({
      geometry: orientedGeometry(graph, current, attrs),
      type: attrs.isGap ? 'gap' : 'bike_lane',
      distanceMeters: attrs.distanceMeters,
    })

    visited.add(next)
    current = next

    if (total >= minDist) return segments
  }

  return null
}

/**
 * Round-trip random walk from startKey.
 * Never reuses the same edge. Returns to startKey to complete the loop.
 * Prefers bike-lane edges over gap edges at each step.
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

    const laneNeighbours = availableNeighbours.filter(n => {
      const key = graph.edge(current, n)!
      return !graph.getEdgeAttributes(key).isGap
    })
    const next = pickRandom(laneNeighbours.length > 0 ? laneNeighbours : availableNeighbours)

    const edgeKey = graph.edge(current, next)!
    const attrs = graph.getEdgeAttributes(edgeKey)

    if (total + attrs.distanceMeters > maxDist) return null

    total += attrs.distanceMeters
    visitedEdges.add(edgeKey)
    segments.push({
      geometry: orientedGeometry(graph, current, attrs),
      type: attrs.isGap ? 'gap' : 'bike_lane',
      distanceMeters: attrs.distanceMeters,
    })
    current = next
  }
}

function segmentsToRoute(segments: RouteSegment[]): Route {
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
    createdAt: new Date(),
  }
}

/** Route signature for deduplication — first coord of every segment joined. */
function signature(segments: RouteSegment[]): string {
  return segments.map(s => s.geometry.coordinates[0].join(',')).join('|')
}

export function runWalks(
  graph: BikeLaneGraph,
  startKey: string,
  minDist: number,
  maxDist: number,
  roundTrip = false,
): Route[] {
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
      routes.push(segmentsToRoute(segs))
    }
  }
  return routes
}

/**
 * Finds multiple route candidates from the given start point.
 * Start coordinates are taken from preferences.startLon / preferences.startLat.
 * First attempts with preferences.maxGapMeters; expands to EXPANDED_GAP_METERS
 * if fewer than MIN_ROUTES_BEFORE_EXPAND distinct routes are found.
 */
export function findRoutes(lanes: BikeLane[], preferences: RoutePreferences): Route[] {
  const { startLon, startLat, minDistanceMeters, maxDistanceMeters, roundTrip } = preferences

  let graph = buildGraph(lanes, preferences.maxGapMeters)
  let startKey = nearestNode(graph, startLon, startLat)
  if (!startKey) return []

  let routes = runWalks(graph, startKey, minDistanceMeters, maxDistanceMeters, roundTrip)

  if (routes.length < MIN_ROUTES_BEFORE_EXPAND && preferences.maxGapMeters < EXPANDED_GAP_METERS) {
    graph = buildGraph(lanes, EXPANDED_GAP_METERS)
    startKey = nearestNode(graph, startLon, startLat)!
    routes = runWalks(graph, startKey, minDistanceMeters, maxDistanceMeters, roundTrip)
  }

  return routes
}
