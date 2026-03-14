import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import type { Route, RoutePreferences } from '~/domain/entities/route'

interface RoutingStore {
  currentRoute: Route | null
  preferences: RoutePreferences
  isCalculating: boolean
  routeError: string | null
  setRoute: (route: Route | null) => void
  setPreferences: (patch: Partial<RoutePreferences>) => void
  setCalculating: (calculating: boolean) => void
  setRouteError: (error: string | null) => void
}

export const useRoutingStore = create<RoutingStore>()(
  persist(
    set => ({
      currentRoute: null,
      preferences: DEFAULT_PREFERENCES,
      isCalculating: false,
      routeError: null,
      setRoute: currentRoute => set({ currentRoute }),
      setPreferences: patch => set(state => ({ preferences: { ...state.preferences, ...patch } })),
      setCalculating: isCalculating => set({ isCalculating }),
      setRouteError: routeError => set({ routeError }),
    }),
    {
      name: 'cycle-routing',
      partialize: state => ({ currentRoute: state.currentRoute }),
    },
  ),
)
