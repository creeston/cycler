import { fetchOverpassGeoJSON } from '~/infrastructure/osm/overpass-client'
import { buildBarrierQuery, buildBikeLaneQuery } from '~/infrastructure/osm/queries'
import { saveArea, loadArea } from '~/infrastructure/cache/area-cache'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import { geojsonToBarriers } from '~/domain/mappers/osm-to-barriers'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'
import type { BarrierData } from '~/domain/entities/barrier'

function bboxId(bbox: BoundingBox): string {
  return `${bbox.west.toFixed(3)},${bbox.south.toFixed(3)},${bbox.east.toFixed(3)},${bbox.north.toFixed(3)}`
}

/**
 * Fetches the bike lanes for a box and, in a second query, the barriers that
 * decide which gaps between them are plausible.
 *
 * The barrier query is allowed to fail on its own: lanes are the product, and
 * a route without barrier data is still a route — it is reported as unchecked
 * rather than withheld.
 *
 * Returns the whole `CachedArea`, id and box included, so the caller can hold
 * it alongside the other loaded areas and know which part of the map it covers.
 */
export async function fetchArea(bbox: BoundingBox, forceRefresh = false): Promise<CachedArea> {
  const id = bboxId(bbox)

  if (!forceRefresh) {
    const cached = await loadArea(id)
    if (cached) return { ...cached, barriers: cached.barriers ?? null }
  }

  const geojson = await fetchOverpassGeoJSON(buildBikeLaneQuery(bbox))
  const bikeLanes = geojsonToBikeLanes(geojson)
  const barriers = await fetchBarriers(bbox)

  const area: CachedArea = { id, bbox, bikeLanes, barriers, fetchedAt: new Date() }
  await saveArea(area)

  return area
}

async function fetchBarriers(bbox: BoundingBox): Promise<BarrierData | null> {
  try {
    return geojsonToBarriers(await fetchOverpassGeoJSON(buildBarrierQuery(bbox)))
  } catch (err) {
    console.warn('Barrier data is unavailable — routes here cannot be checked for crossings.', err)
    return null
  }
}
