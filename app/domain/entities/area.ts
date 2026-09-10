import type { BikeLane } from './bike-lane'
import type { BarrierData } from './barrier'

export interface BoundingBox {
  west: number
  south: number
  east: number
  north: number
}

export interface CachedArea {
  id: string
  bbox: BoundingBox
  bikeLanes: BikeLane[]
  /**
   * Barriers for the same box, or null when that fetch failed. Areas cached
   * before barrier checking existed also read as null, so a route built from
   * them is reported as unverified rather than silently trusted.
   */
  barriers?: BarrierData | null
  fetchedAt: Date
}
