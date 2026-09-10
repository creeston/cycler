import type { LineString, MultiPolygon, Point, Polygon } from 'geojson'

/** What a rider cannot cross at an arbitrary point. */
export type BarrierKind = 'major_road' | 'railway' | 'water'

export interface Barrier {
  osmId: string
  kind: BarrierKind
  geometry: LineString | Polygon | MultiPolygon
}

/**
 * Where a barrier can be crossed after all: a marked crossing, a level
 * crossing, or a way that bridges over or tunnels under.
 */
export type CrossingKind = 'crossing' | 'level_crossing' | 'bridge' | 'tunnel'

export interface Crossing {
  osmId: string
  kind: CrossingKind
  geometry: Point | LineString
}

export interface BarrierData {
  barriers: Barrier[]
  crossings: Crossing[]
}

export const EMPTY_BARRIER_DATA: BarrierData = { barriers: [], crossings: [] }

export function mergeBarrierData(parts: BarrierData[]): BarrierData {
  return {
    barriers: parts.flatMap(p => p.barriers),
    crossings: parts.flatMap(p => p.crossings),
  }
}
