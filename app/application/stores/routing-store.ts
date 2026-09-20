import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import type { Route, RoutePreferences } from '~/domain/entities/route'

interface RoutingStore {
  currentRoute: Route | null
  preferences: RoutePreferences
  isChoosingDestination: boolean
  isCalculating: boolean
  /** Share of the running computation done, 0–1, or null when unknown. */
  calculationProgress: number | null
  routeError: string | null
  setRoute: (route: Route | null) => void
  setPreferences: (patch: Partial<RoutePreferences>) => void
  setChoosingDestination: (choosing: boolean) => void
  setCalculating: (calculating: boolean) => void
  setCalculationProgress: (progress: number | null) => void
  setRouteError: (error: string | null) => void
}

export const useRoutingStore = create<RoutingStore>()(
  persist(
    set => ({
      currentRoute: null,
      preferences: DEFAULT_PREFERENCES,
      isChoosingDestination: false,
      isCalculating: false,
      calculationProgress: null,
      routeError: null,
      setRoute: currentRoute => set({ currentRoute }),
      setPreferences: patch => set(state => ({ preferences: { ...state.preferences, ...patch } })),
      setChoosingDestination: isChoosingDestination => set({ isChoosingDestination }),
      setCalculating: isCalculating => set({ isCalculating }),
      setCalculationProgress: calculationProgress => set({ calculationProgress }),
      setRouteError: routeError => set({ routeError }),
    }),
    {
      name: 'cycle-routing',
      partialize: state => ({ currentRoute: state.currentRoute, preferences: state.preferences }),
    },
  ),
)
