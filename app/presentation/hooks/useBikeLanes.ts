import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchArea } from '~/application/use-cases/fetch-area'
import type { AreaLoadSource } from '~/application/use-cases/fetch-area'
import { clearRouteCache } from '~/application/use-cases/build-route'
import { clearCachedData } from '~/application/use-cases/clear-cached-data'
import {
  getLaneCacheStats,
  initializeLaneCache,
  loadCachedLanes,
} from '~/application/use-cases/load-cached-lanes'
import { useMapStore } from '~/application/stores/map-store'
import { expandBbox } from '~/domain/entities/area'
import type { BoundingBox } from '~/domain/entities/area'

const MAX_AREA_KM = 50

/**
 * How far beyond the visible map cached areas are kept loaded, as a multiple of
 * the view's own span. One screen of context in each direction means the router
 * can still reach past the edge of what is on screen, and a short pan does not
 * evict what it is about to need again.
 */
const LOAD_MARGIN = 1

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
  const [cacheReady, setCacheReady] = useState(false)
  const [storedAreaCount, setStoredAreaCount] = useState(0)
  const [newestStoredAt, setNewestStoredAt] = useState<Date | null>(null)
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [lastLoadSource, setLastLoadSource] = useState<AreaLoadSource | null>(null)
  const cacheGeneration = useRef(0)
  const requestController = useRef<AbortController | null>(null)
  const requestId = useRef(0)

  const refreshCacheStats = useCallback(async () => {
    const stats = await getLaneCacheStats()
    setStoredAreaCount(stats.count)
    setNewestStoredAt(stats.newestFetchedAt)
  }, [])

  // Areas already looked at for this view, so a pan does not re-read the same
  // ones from IndexedDB on every move.
  const heldIds = useRef(new Set<string>())
  heldIds.current = new Set(loadedIds.map(area => area.id))

  // Expiry removes data from storage, not only from what the map happens to load.
  useEffect(() => {
    let cancelled = false

    async function prepareCache(): Promise<void> {
      const stats = await initializeLaneCache()
      if (cancelled) return
      setStoredAreaCount(stats.count)
      setNewestStoredAt(stats.newestFetchedAt)
      setCacheReady(true)
    }

    void prepareCache()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () => () => {
      requestId.current += 1
      requestController.current?.abort()
    },
    [],
  )

  // Restore the cached areas near the map, and only those. Everything else
  // stays in IndexedDB until the rider moves there.
  useEffect(() => {
    if (!bbox || !cacheReady) return
    const view = expandBbox(bbox, LOAD_MARGIN)
    const generation = cacheGeneration.current
    let cancelled = false

    loadCachedLanes(view, heldIds.current).then(loaded => {
      if (cancelled || generation !== cacheGeneration.current) return

      if (loaded.length > 0) {
        mergeAreas(loaded)
        setLastLoadSource('cache')
      }
      keepAreasIntersecting(view)
    })

    return () => {
      cancelled = true
    }
  }, [bbox, cacheReady, mergeAreas, keepAreasIntersecting])

  const fetch = useCallback(
    async (forceRefresh = false) => {
      if (!bbox) return
      requestController.current?.abort()
      const currentRequestId = ++requestId.current
      const { widthKm, heightKm } = bboxDimensionsKm(bbox)
      if (widthKm > MAX_AREA_KM || heightKm > MAX_AREA_KM) {
        requestController.current = null
        setLoading(false)
        setFetchError(
          `Zoom in closer — current area is ${Math.round(widthKm)}×${Math.round(heightKm)} km. Maximum is ${MAX_AREA_KM}×${MAX_AREA_KM} km.`,
        )
        return
      }
      const controller = new AbortController()
      requestController.current = controller
      setLoading(true)
      setFetchError(null)
      try {
        const result = await fetchArea(bbox, forceRefresh, {
          signal: controller.signal,
          onRetry: message => {
            if (requestId.current === currentRequestId) setFetchError(message)
          },
        })
        if (requestId.current !== currentRequestId) return
        mergeAreas([result.area])
        setLastLoadSource(result.source)
        setFetchError(null)
        clearRouteCache()
        await refreshCacheStats()
      } catch (err) {
        if (requestId.current === currentRequestId && !isAbortError(err)) {
          setFetchError(err instanceof Error ? err.message : 'Failed to fetch bike lanes')
        }
      } finally {
        if (requestId.current === currentRequestId) {
          requestController.current = null
          setLoading(false)
        }
      }
    },
    [bbox, setLoading, mergeAreas, setFetchError, refreshCacheStats],
  )

  const cancelFetch = useCallback(() => {
    requestId.current += 1
    requestController.current?.abort()
    requestController.current = null
    setLoading(false)
    setFetchError(null)
  }, [setFetchError, setLoading])

  const clearStoredAreas = useCallback(async () => {
    setIsClearingCache(true)
    cacheGeneration.current += 1
    try {
      await clearCachedData()
      await refreshCacheStats()
    } finally {
      setIsClearingCache(false)
    }
  }, [refreshCacheStats])

  const isAreaTooLarge = bbox
    ? (() => {
        const { widthKm, heightKm } = bboxDimensionsKm(bbox)
        return widthKm > MAX_AREA_KM || heightKm > MAX_AREA_KM
      })()
    : false

  return {
    fetch,
    cancelFetch,
    bikeLanes,
    isLoading,
    lastFetchedAt,
    isAreaTooLarge,
    cacheReady,
    storedAreaCount,
    newestStoredAt,
    lastLoadSource,
    isClearingCache,
    clearStoredAreas,
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}
