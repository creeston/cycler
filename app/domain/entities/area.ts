import type { Position } from 'geojson'
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

/** True when the two boxes share any area. Touching edges count. */
export function bboxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south
}

/**
 * Grows a box by a fraction of its own span on every side. A margin of 0.25
 * turns one screen into one and a half in each direction.
 */
export function expandBbox(bbox: BoundingBox, margin: number): BoundingBox {
  const lonPadding = (bbox.east - bbox.west) * margin
  const latPadding = (bbox.north - bbox.south) * margin
  return {
    west: bbox.west - lonPadding,
    east: bbox.east + lonPadding,
    south: bbox.south - latPadding,
    north: bbox.north + latPadding,
  }
}

/** True when any vertex of the line lies inside the box. */
export function lineIntersectsBbox(coordinates: Position[], bbox: BoundingBox): boolean {
  for (const [lon, lat] of coordinates) {
    if (lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north) return true
  }
  return false
}

/**
 * The box a cached area covers, read back from its id.
 *
 * Area ids are built by fetch-area as `west,south,east,north` rounded to three
 * decimals, which lets the cache be listed by key alone — no area has to be
 * deserialised to find out whether it is anywhere near the map.
 */
export function bboxFromAreaId(id: string): BoundingBox | null {
  const parts = id.split(',').map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null
  const [west, south, east, north] = parts
  return { west, south, east, north }
}
