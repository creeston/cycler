import { useCallback, useEffect } from 'react'
import { fetchBikeLanes } from '~/application/use-cases/fetch-bike-lanes'
import { clearRouteCache } from '~/application/use-cases/build-route'
import { loadAllAreas } from '~/infrastructure/cache/area-cache'
import { useMapStore } from '~/application/stores/map-store'

const STALE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_AREA_KM = 50

import type { BoundingBox } from '~/domain/entities/area'

function bboxDimensionsKm(bbox: BoundingBox) {
  const R = 6_371
  const avgLat = (((bbox.south + bbox.north) / 2) * Math.PI) / 180
  const heightKm = (bbox.north - bbox.south) * (Math.PI / 180) * R
  const widthKm = (bbox.east - bbox.west) * (Math.PI / 180) * R * Math.cos(avgLat)
  return { widthKm, heightKm }
}

export function useBikeLanes() {
  const { bbox, isLoading, bikeLanes, lastFetchedAt, setLoading, setBikeLanes, setFetchError } =
    useMapStore()

  // On mount: restore all non-stale bike lanes from IndexedDB without hitting Overpass
  useEffect(() => {
    loadAllAreas().then(areas => {
      const now = Date.now()
      const lanes = areas
        .filter(a => now - new Date(a.fetchedAt).getTime() < STALE_MS)
        .flatMap(a => a.bikeLanes)
      if (lanes.length > 0) setBikeLanes(lanes)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetch = useCallback(
    async () => {
      if (!bbox || isLoading) return
      const { widthKm, heightKm } = bboxDimensionsKm(bbox)
      if (widthKm > MAX_AREA_KM || heightKm > MAX_AREA_KM) {
        setFetchError(`Zoom in closer — current area is ${Math.round(widthKm)}×${Math.round(heightKm)} km. Maximum is ${MAX_AREA_KM}×${MAX_AREA_KM} km.`)
        return
      }
      setLoading(true)
      setFetchError(null)
      try {
        const lanes = await fetchBikeLanes(bbox, true)
        setBikeLanes(lanes)
        clearRouteCache()
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'Failed to fetch bike lanes')
      } finally {
        setLoading(false)
      }
    },
    [bbox, isLoading, setLoading, setBikeLanes, setFetchError],
  )

  const isAreaTooLarge = bbox ? (() => {
    const { widthKm, heightKm } = bboxDimensionsKm(bbox)
    return widthKm > MAX_AREA_KM || heightKm > MAX_AREA_KM
  })() : false

  return { fetch, bikeLanes, isLoading, lastFetchedAt, isAreaTooLarge }
}
