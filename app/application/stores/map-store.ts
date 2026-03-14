import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BikeLane } from '~/domain/entities/bike-lane'
import type { BoundingBox } from '~/domain/entities/area'

interface MapViewport {
  longitude: number
  latitude: number
  zoom: number
}

interface MapStore {
  viewport: MapViewport
  bbox: BoundingBox | null
  bikeLanes: BikeLane[]
  isLoading: boolean
  fetchError: string | null
  lastFetchedAt: Date | null
  setViewport: (viewport: MapViewport) => void
  setBbox: (bbox: BoundingBox) => void
  setBikeLanes: (lanes: BikeLane[]) => void
  setLoading: (loading: boolean) => void
  setFetchError: (error: string | null) => void
}

export const useMapStore = create<MapStore>()(
  persist(
    set => ({
      viewport: { longitude: 4.9, latitude: 52.37, zoom: 13 },
      bbox: null,
      bikeLanes: [],
      isLoading: false,
      fetchError: null,
      lastFetchedAt: null,
      setViewport: viewport => set({ viewport }),
      setBbox: bbox => set({ bbox }),
      setBikeLanes: bikeLanes => set({ bikeLanes, lastFetchedAt: new Date() }),
      setLoading: isLoading => set({ isLoading }),
      setFetchError: fetchError => set({ fetchError }),
    }),
    {
      name: 'cycle-map-viewport',
      partialize: state => ({ viewport: state.viewport }),
    },
  ),
)
