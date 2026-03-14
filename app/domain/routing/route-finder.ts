import type { BikeLane } from '../entities/bike-lane'
import type { Route, RoutePreferences, RouteSegment } from '../entities/route'
import { buildGraph, nearestNode } from './graph'
import type { BikeLaneGraph } from './graph'

const N_ATTEMPTS = 80
/** Expand gap tolerance to this if fewer than MIN_ROUTES are found at normal gap. */
const EXPANDED_GAP_METERS = 1_000
const MIN_ROUTES_BEFORE_EXPAND = 3

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
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
      geometry: attrs.geometry,
      type: attrs.isGap ? 'gap' : 'bike_lane',
      distanceMeters: attrs.distanceMeters,
    })

    visited.add(next)
    current = next

    if (total >= minDist) return segments
  }

  return null
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

function runWalks(
  graph: BikeLaneGraph,
  startKey: string,
  minDist: number,
  maxDist: number,
): Route[] {
  const seen = new Set<string>()
  const routes: Route[] = []
  for (let i = 0; i < N_ATTEMPTS; i++) {
    const segs = randomWalk(graph, startKey, minDist, maxDist)
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
 * First attempts with preferences.maxGapMeters; expands to EXPANDED_GAP_METERS
 * if fewer than MIN_ROUTES_BEFORE_EXPAND distinct routes are found.
 */
export function findRoutes(
  lanes: BikeLane[],
  startLon: number,
  startLat: number,
  preferences: RoutePreferences,
): Route[] {
  const { minDistanceMeters, maxDistanceMeters } = preferences

  let graph = buildGraph(lanes, preferences.maxGapMeters)
  let startKey = nearestNode(graph, startLon, startLat)
  if (!startKey) return []

  let routes = runWalks(graph, startKey, minDistanceMeters, maxDistanceMeters)

  if (routes.length < MIN_ROUTES_BEFORE_EXPAND && preferences.maxGapMeters < EXPANDED_GAP_METERS) {
    graph = buildGraph(lanes, EXPANDED_GAP_METERS)
    startKey = nearestNode(graph, startLon, startLat)!
    routes = runWalks(graph, startKey, minDistanceMeters, maxDistanceMeters)
  }

  return routes
}
