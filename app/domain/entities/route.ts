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

export interface RoutePreferences {
  startLon: number
  startLat: number
  /** Maximum allowed road gap between two lane segments (meters) */
  maxGapMeters: number
  minDistanceMeters: number
  maxDistanceMeters: number
  /**
   * When true, the algorithm finds a circular route that returns to the start
   * without repeating any edge (no traversing the same lane twice).
   */
  roundTrip: boolean
}

export const DEFAULT_PREFERENCES: RoutePreferences = {
  startLon: 0,
  startLat: 0,
  maxGapMeters: 200,
  minDistanceMeters: 10_000,
  maxDistanceMeters: 30_000,
  roundTrip: false,
}
