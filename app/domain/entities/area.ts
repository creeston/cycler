import type { BikeLane } from './bike-lane'

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
  fetchedAt: Date
}
