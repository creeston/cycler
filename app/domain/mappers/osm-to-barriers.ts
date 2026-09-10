import type { FeatureCollection, Geometry } from 'geojson'
import type { Barrier, BarrierData, BarrierKind, Crossing, CrossingKind } from '../entities/barrier'

const MAJOR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary'])
const RAILWAYS = new Set(['rail', 'light_rail', 'subway'])
const WATERWAYS = new Set(['river', 'canal'])

/**
 * Splits an Overpass export into barriers and the places they can be crossed.
 *
 * A feature that is both a barrier and grade separated — a motorway on a
 * viaduct, a canal in a culvert — blocks nothing at ground level, so it is
 * dropped rather than recorded as either. Anything else carrying `bridge` or
 * `tunnel` is a crossing: it is how a road or path gets over or under a
 * barrier.
 */
export function geojsonToBarriers(fc: FeatureCollection): BarrierData {
  const barriers: Barrier[] = []
  const crossings: Crossing[] = []

  for (const feature of fc.features) {
    if (!feature.geometry) continue
    const tags = (feature.properties ?? {}) as Record<string, string>
    const osmId = String(tags['@id'] ?? tags['id'] ?? '')

    const kind = barrierKind(tags)
    if (kind) {
      if (!isGradeSeparated(tags) && isBarrierGeometry(feature.geometry)) {
        barriers.push({ osmId, kind, geometry: feature.geometry })
      }
      continue
    }

    const crossing = crossingKind(tags)
    if (crossing && isCrossingGeometry(feature.geometry)) {
      crossings.push({ osmId, kind: crossing, geometry: feature.geometry })
    }
  }

  return { barriers, crossings }
}

/**
 * The level a lane sits on. Two lanes on different levels pass over or under
 * each other, whatever the map distance between their endpoints says.
 */
export function osmLevel(tags: Record<string, string>): number {
  const layer = Number.parseInt(tags['layer'] ?? '', 10)
  if (Number.isFinite(layer)) return layer
  if (isTagged(tags['bridge'])) return 1
  if (isTagged(tags['tunnel'])) return -1
  return 0
}

function barrierKind(tags: Record<string, string>): BarrierKind | null {
  if (MAJOR_ROADS.has(tags['highway'])) return 'major_road'
  if (RAILWAYS.has(tags['railway'])) return 'railway'
  if (WATERWAYS.has(tags['waterway']) || tags['natural'] === 'water') return 'water'
  return null
}

function crossingKind(tags: Record<string, string>): CrossingKind | null {
  if (tags['highway'] === 'crossing') return 'crossing'
  if (tags['railway'] === 'level_crossing') return 'level_crossing'
  if (isTagged(tags['bridge'])) return 'bridge'
  if (isTagged(tags['tunnel'])) return 'tunnel'
  return null
}

function isGradeSeparated(tags: Record<string, string>): boolean {
  return isTagged(tags['bridge']) || isTagged(tags['tunnel'])
}

/** OSM writes these as `yes`, `viaduct`, `culvert` and so on; only `no` means absent. */
function isTagged(value: string | undefined): boolean {
  return value !== undefined && value !== 'no'
}

function isBarrierGeometry(geometry: Geometry): geometry is Barrier['geometry'] {
  return (
    geometry.type === 'LineString' ||
    geometry.type === 'Polygon' ||
    geometry.type === 'MultiPolygon'
  )
}

function isCrossingGeometry(geometry: Geometry): geometry is Crossing['geometry'] {
  return geometry.type === 'Point' || geometry.type === 'LineString'
}
