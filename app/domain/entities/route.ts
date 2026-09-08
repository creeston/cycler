import type { LineString } from 'geojson'

export type SegmentType = 'bike_lane' | 'gap'

export interface RouteSegment {
  geometry: LineString
  type: SegmentType
  distanceMeters: number
}

export interface Route {
  id: string
  segments: RouteSegment[]
  totalDistanceMeters: number
  bikeLaneDistanceMeters: number
  /** 0–1 ratio of bike-lane distance to total */
  bikeLaneCoverage: number
  gapCount: number
  createdAt: Date
}

export function isRoundTrip(route: Route): boolean {
  if (route.segments.length === 0) return false

  const first = route.segments[0].geometry.coordinates[0]
  const lastSegment = route.segments[route.segments.length - 1]
  const last = lastSegment.geometry.coordinates[lastSegment.geometry.coordinates.length - 1]
  return Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9
}

export interface RoutePreferences {
  startLon: number
  startLat: number
  /** When set together with endLat, triggers one-way routing from start to end. */
  endLon?: number
  endLat?: number
  /** Maximum allowed road gap between two lane segments (meters) */
  maxGapMeters: number
  /**
   * All bike lane endpoints within this radius of the start coordinate are
   * used as route candidates, increasing route diversity when the user is near
   * multiple lane entrances. Falls back to the nearest node when none are found.
   */
  startProximityMeters: number
  minDistanceMeters: number
  maxDistanceMeters: number
  /**
   * When true, the algorithm finds a circular route that returns to the start
   * without repeating any edge (no traversing the same lane twice).
   * Ignored when endLon/endLat are set.
   */
  roundTrip: boolean
}

export const DEFAULT_PREFERENCES: RoutePreferences = {
  startLon: 0,
  startLat: 0,
  maxGapMeters: 200,
  startProximityMeters: 200,
  minDistanceMeters: 10_000,
  maxDistanceMeters: 30_000,
  roundTrip: false,
}
