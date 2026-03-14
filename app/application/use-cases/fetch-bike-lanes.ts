import { fetchOverpassGeoJSON } from '~/infrastructure/osm/overpass-client'
import { buildBikeLaneQuery } from '~/infrastructure/osm/queries'
import { saveArea, loadArea } from '~/infrastructure/cache/area-cache'
import { geojsonToBikeLanes } from '~/domain/mappers/osm-to-domain'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'
import type { BikeLane } from '~/domain/entities/bike-lane'

function bboxId(bbox: BoundingBox): string {
  return `${bbox.west.toFixed(3)},${bbox.south.toFixed(3)},${bbox.east.toFixed(3)},${bbox.north.toFixed(3)}`
}

export async function fetchBikeLanes(
  bbox: BoundingBox,
  forceRefresh = false,
): Promise<BikeLane[]> {
  const id = bboxId(bbox)

  if (!forceRefresh) {
    const cached = await loadArea(id)
    if (cached) return cached.bikeLanes
  }

  const query = buildBikeLaneQuery(bbox)
  const geojson = await fetchOverpassGeoJSON(query)
  const bikeLanes = geojsonToBikeLanes(geojson)

  const area: CachedArea = { id, bbox, bikeLanes, fetchedAt: new Date() }
  await saveArea(area)

  return bikeLanes
}
