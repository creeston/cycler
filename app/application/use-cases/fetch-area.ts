import { fetchOverpassGeoJSON } from '~/infrastructure/osm/overpass-client'
import { buildBarrierQuery, buildBikeLaneQuery } from '~/infrastructure/osm/queries'
import { isAreaStale, loadAllAreas, loadArea, saveArea } from '~/infrastructure/cache/area-cache'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { geojsonToBarriers } from '~/domain/mappers/osm-to-barriers'
import { bboxContains } from '~/domain/entities/area'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'
import type { BarrierData } from '~/domain/entities/barrier'

export type AreaLoadSource = 'cache' | 'network'

export interface AreaLoadResult {
  area: CachedArea
  source: AreaLoadSource
}

function bboxId(bbox: BoundingBox): string {
  return `${bbox.west.toFixed(3)},${bbox.south.toFixed(3)},${bbox.east.toFixed(3)},${bbox.north.toFixed(3)}`
}

/**
 * Loads the bike lanes and barriers for a box. Fresh cache entries win unless
 * the caller explicitly requests a refresh; missing or expired data is fetched
 * from Overpass and cached for later sessions.
 */
export async function fetchArea(bbox: BoundingBox, forceRefresh = false): Promise<AreaLoadResult> {
  const id = bboxId(bbox)

  if (!forceRefresh) {
    const cached = await findFreshCachedArea(id, bbox)
    if (cached) return { area: normalizeCachedArea(cached), source: 'cache' }
  }

  const geojson = await fetchOverpassGeoJSON(buildBikeLaneQuery(bbox))
  const bikeLanes = geojsonToBikeLanes(geojson)
  const barriers = await fetchBarriers(bbox)

  const area: CachedArea = { id, bbox, bikeLanes, barriers, fetchedAt: new Date() }
  await saveArea(area)

  return { area, source: 'network' }
}

async function findFreshCachedArea(
  id: string,
  requestedBbox: BoundingBox,
): Promise<CachedArea | undefined> {
  const exact = await loadArea(id)
  if (exact && !isAreaStale(exact)) return exact

  const containing = (await loadAllAreas())
    .filter(area => area.id !== exact?.id)
    .filter(area => !isAreaStale(area) && bboxContains(area.bbox, requestedBbox))
    .sort((a, b) => bboxArea(a.bbox) - bboxArea(b.bbox))

  return containing[0]
}

function bboxArea(bbox: BoundingBox): number {
  return (bbox.east - bbox.west) * (bbox.north - bbox.south)
}

function normalizeCachedArea(area: CachedArea): CachedArea {
  return { ...area, barriers: area.barriers ?? null }
}

async function fetchBarriers(bbox: BoundingBox): Promise<BarrierData | null> {
  try {
    return geojsonToBarriers(await fetchOverpassGeoJSON(buildBarrierQuery(bbox)))
  } catch (err) {
    console.warn('Barrier data is unavailable — routes here cannot be checked for crossings.', err)
    return null
  }
}
