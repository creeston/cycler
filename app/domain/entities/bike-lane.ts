import type { LineString } from 'geojson'

export type LaneType = 'cycleway' | 'lane' | 'track' | 'shared' | 'path'

export interface BikeLane {
  id: string
  osmId: string
  geometry: LineString
  laneType: LaneType
  name?: string
  surface?: string
  tags: Record<string, string>
}
