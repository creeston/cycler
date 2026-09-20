import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { bboxesIntersect } from '~/domain/entities/area'
import { mergeBarrierData } from '~/domain/entities/barrier'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { BarrierData } from '~/domain/entities/barrier'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'

interface MapViewport {
  longitude: number
  latitude: number
  zoom: number
}

interface MapStore {
  viewport: MapViewport
  bbox: BoundingBox | null
  /**
   * The areas held in memory. Everything below is derived from them, so the
   * lanes the map draws and the lanes the router is given are always the same
   * set — see docs/architecture.md §3.1.
   */
  areas: CachedArea[]
  bikeLanes: BikeLane[]
  /** Barriers for the loaded lanes, or null when any loaded area lacks them. */
  barriers: BarrierData | null
  isLoading: boolean
  fetchError: string | null
  lastFetchedAt: Date | null
  setViewport: (viewport: MapViewport) => void
  setBbox: (bbox: BoundingBox) => void
  /** Adds areas, replacing any already held under the same id. */
  mergeAreas: (areas: CachedArea[]) => void
  /** Drops the areas that lie entirely outside the given box. */
  keepAreasIntersecting: (bbox: BoundingBox) => void
  clearAreas: () => void
  setLoading: (loading: boolean) => void
  setFetchError: (error: string | null) => void
}

interface DerivedAreaState {
  areas: CachedArea[]
  bikeLanes: BikeLane[]
  barriers: BarrierData | null
  lastFetchedAt: Date | null
}

/**
 * Flattens the held areas once per change rather than on every read.
 *
 * Barriers are all-or-nothing: one area without them makes the whole set
 * unchecked, because a gap in an unchecked area would otherwise be reported as
 * verified.
 */
function derive(areas: CachedArea[]): DerivedAreaState {
  const fetchTimes = areas.map(a => new Date(a.fetchedAt).getTime())
  return {
    areas,
    bikeLanes: areas.flatMap(a => a.bikeLanes),
    barriers:
      areas.length > 0 && areas.every(a => a.barriers)
        ? mergeBarrierData(areas.map(a => a.barriers!))
        : null,
    lastFetchedAt: fetchTimes.length > 0 ? new Date(Math.max(...fetchTimes)) : null,
  }
}

export const useMapStore = create<MapStore>()(
  persist(
    set => ({
      viewport: { longitude: 4.9, latitude: 52.37, zoom: 13 },
      bbox: null,
      areas: [],
      bikeLanes: [],
      barriers: null,
      isLoading: false,
      fetchError: null,
      lastFetchedAt: null,
      setViewport: viewport => set({ viewport }),
      setBbox: bbox => set({ bbox }),
      mergeAreas: incoming =>
        set(state => {
          const byId = new Map(state.areas.map(area => [area.id, area]))
          for (const area of incoming) byId.set(area.id, area)
          return derive([...byId.values()])
        }),
      keepAreasIntersecting: bbox =>
        set(state => {
          const kept = state.areas.filter(area => bboxesIntersect(area.bbox, bbox))
          return kept.length === state.areas.length ? state : derive(kept)
        }),
      clearAreas: () => set(derive([])),
      setLoading: isLoading => set({ isLoading }),
      setFetchError: fetchError => set({ fetchError }),
    }),
    {
      name: 'cycle-map-viewport',
      partialize: state => ({ viewport: state.viewport }),
    },
  ),
)
