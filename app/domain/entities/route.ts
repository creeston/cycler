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
  /** Maximum allowed road gap between two lane segments (meters) */
  maxGapMeters: number
  minDistanceMeters: number
  maxDistanceMeters: number
  roundTrip: boolean
}

export const DEFAULT_PREFERENCES: RoutePreferences = {
  maxGapMeters: 200,
  minDistanceMeters: 10_000,
  maxDistanceMeters: 30_000,
  roundTrip: false,
}
