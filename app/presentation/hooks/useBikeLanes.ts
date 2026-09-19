import { useCallback, useEffect, useRef } from 'react'
import { fetchArea } from '~/application/use-cases/fetch-area'
import { clearRouteCache } from '~/application/use-cases/build-route'
import { listAreaBounds, loadArea } from '~/infrastructure/cache/area-cache'
import { useMapStore } from '~/application/stores/map-store'
import { bboxesIntersect, expandBbox } from '~/domain/entities/area'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'

const STALE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_AREA_KM = 50

/**
 * How far beyond the visible map cached areas are kept loaded, as a multiple of
 * the view's own span. One screen of context in each direction means the router
 * can still reach past the edge of what is on screen, and a short pan does not
 * evict what it is about to need again.
 */
const LOAD_MARGIN = 1

function isStale(area: CachedArea): boolean {
  return Date.now() - new Date(area.fetchedAt).getTime() >= STALE_MS
}

function bboxDimensionsKm(bbox: BoundingBox) {
  const R = 6_371
  const avgLat = (((bbox.south + bbox.north) / 2) * Math.PI) / 180
  const heightKm = (bbox.north - bbox.south) * (Math.PI / 180) * R
  const widthKm = (bbox.east - bbox.west) * (Math.PI / 180) * R * Math.cos(avgLat)
  return { widthKm, heightKm }
}

export function useBikeLanes() {
  const bbox = useMapStore(s => s.bbox)
  const isLoading = useMapStore(s => s.isLoading)
  const bikeLanes = useMapStore(s => s.bikeLanes)
  const lastFetchedAt = useMapStore(s => s.lastFetchedAt)
  const loadedIds = useMapStore(s => s.areas)
  const setLoading = useMapStore(s => s.setLoading)
  const mergeAreas = useMapStore(s => s.mergeAreas)
  const keepAreasIntersecting = useMapStore(s => s.keepAreasIntersecting)
  const setFetchError = useMapStore(s => s.setFetchError)

  // Areas already looked at for this view, so a pan does not re-read the same
  // ones from IndexedDB on every move.
  const heldIds = useRef(new Set<string>())
  heldIds.current = new Set(loadedIds.map(area => area.id))

  // Restore the cached areas near the map, and only those. Everything else
  // stays in IndexedDB until the rider moves there.
  useEffect(() => {
    if (!bbox) return
    const view = expandBbox(bbox, LOAD_MARGIN)
    let cancelled = false

    listAreaBounds().then(async bounds => {
      const wanted = bounds.filter(entry => bboxesIntersect(entry.bbox, view))
      const missing = wanted.filter(entry => !heldIds.current.has(entry.id))
      const loaded = await Promise.all(missing.map(entry => loadArea(entry.id)))
      if (cancelled) return

      const fresh = loaded
        .filter((area): area is CachedArea => area !== undefined && !isStale(area))
        .map(area => ({ ...area, barriers: area.barriers ?? null }))

      if (fresh.length > 0) mergeAreas(fresh)
      keepAreasIntersecting(view)
    })

    return () => {
      cancelled = true
    }
  }, [bbox, mergeAreas, keepAreasIntersecting])

  const fetch = useCallback(async () => {
    if (!bbox || isLoading) return
    const { widthKm, heightKm } = bboxDimensionsKm(bbox)
    if (widthKm > MAX_AREA_KM || heightKm > MAX_AREA_KM) {
      setFetchError(
        `Zoom in closer — current area is ${Math.round(widthKm)}×${Math.round(heightKm)} km. Maximum is ${MAX_AREA_KM}×${MAX_AREA_KM} km.`,
      )
      return
    }
    setLoading(true)
    setFetchError(null)
    try {
      mergeAreas([await fetchArea(bbox, true)])
      clearRouteCache()
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch bike lanes')
    } finally {
      setLoading(false)
    }
  }, [bbox, isLoading, setLoading, mergeAreas, setFetchError])

  const isAreaTooLarge = bbox
    ? (() => {
        const { widthKm, heightKm } = bboxDimensionsKm(bbox)
        return widthKm > MAX_AREA_KM || heightKm > MAX_AREA_KM
      })()
    : false

  return { fetch, bikeLanes, isLoading, lastFetchedAt, isAreaTooLarge }
}
