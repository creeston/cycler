import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import type { Route, RoutePreferences } from '~/domain/entities/route'

interface RoutingStore {
  currentRoute: Route | null
  preferences: RoutePreferences
  isChoosingDestination: boolean
  isCalculating: boolean
  routeError: string | null
  setRoute: (route: Route | null) => void
  setPreferences: (patch: Partial<RoutePreferences>) => void
  setChoosingDestination: (choosing: boolean) => void
  setCalculating: (calculating: boolean) => void
  setRouteError: (error: string | null) => void
}

export const useRoutingStore = create<RoutingStore>()(
  persist(
    set => ({
      currentRoute: null,
      preferences: DEFAULT_PREFERENCES,
      isChoosingDestination: false,
      isCalculating: false,
      routeError: null,
      setRoute: currentRoute => set({ currentRoute }),
      setPreferences: patch => set(state => ({ preferences: { ...state.preferences, ...patch } })),
      setChoosingDestination: isChoosingDestination => set({ isChoosingDestination }),
      setCalculating: isCalculating => set({ isCalculating }),
      setRouteError: routeError => set({ routeError }),
    }),
    {
      name: 'cycle-routing',
      partialize: state => ({ currentRoute: state.currentRoute, preferences: state.preferences }),
    },
  ),
)
