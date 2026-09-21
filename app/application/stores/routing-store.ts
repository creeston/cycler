import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import type { Route, RoutePreferences } from '~/domain/entities/route'
import type { StartSource } from '~/application/use-cases/build-route'

interface RoutingStore {
  currentRoute: Route | null
  /** Where currentRoute's start point came from; null for a restored or loaded route. */
  routeStartSource: StartSource | null
  preferences: RoutePreferences
  isChoosingStart: boolean
  isChoosingDestination: boolean
  isCalculating: boolean
  /** Share of the running computation done, 0–1, or null when unknown. */
  calculationProgress: number | null
  routeError: string | null
  setRoute: (route: Route | null, startSource?: StartSource) => void
  setPreferences: (patch: Partial<RoutePreferences>) => void
  setChoosingStart: (choosing: boolean) => void
  setChoosingDestination: (choosing: boolean) => void
  setCalculating: (calculating: boolean) => void
  setCalculationProgress: (progress: number | null) => void
  setRouteError: (error: string | null) => void
}

interface PersistedSlice {
  currentRoute: Route | null
  routeStartSource: StartSource | null
  preferences: RoutePreferences
}

/**
 * Version 0 stored the start as `0,0` to mean "not chosen". That is now an
 * unset field, so a stored `0,0` is dropped rather than routed from Null Island.
 */
function migrate(persisted: unknown, version: number): PersistedSlice {
  const slice = persisted as PersistedSlice
  if (version >= 1 || !slice.preferences) return slice
  const { startLon, startLat, ...rest } = slice.preferences
  const isSentinel = startLon === 0 && startLat === 0
  return { ...slice, preferences: isSentinel ? rest : slice.preferences }
}

export const useRoutingStore = create<RoutingStore>()(
  persist(
    set => ({
      currentRoute: null,
      routeStartSource: null,
      preferences: DEFAULT_PREFERENCES,
      isChoosingStart: false,
      isChoosingDestination: false,
      isCalculating: false,
      calculationProgress: null,
      routeError: null,
      setRoute: (currentRoute, startSource) =>
        set({ currentRoute, routeStartSource: currentRoute ? (startSource ?? null) : null }),
      setPreferences: patch => set(state => ({ preferences: { ...state.preferences, ...patch } })),
      setChoosingStart: isChoosingStart => set({ isChoosingStart }),
      setChoosingDestination: isChoosingDestination => set({ isChoosingDestination }),
      setCalculating: isCalculating => set({ isCalculating }),
      setCalculationProgress: calculationProgress => set({ calculationProgress }),
      setRouteError: routeError => set({ routeError }),
    }),
    {
      name: 'cycle-routing',
      version: 1,
      migrate,
      // Persisted slices are JSON. Any non-JSON primitive added here needs an
      // equivalent replacer/reviver so the rehydrated state still matches its type.
      storage: createJSONStorage(() => localStorage, {
        reviver: (key, value) =>
          key === 'createdAt' && typeof value === 'string' ? new Date(value) : value,
      }),
      partialize: state => ({
        currentRoute: state.currentRoute,
        routeStartSource: state.routeStartSource,
        preferences: state.preferences,
      }),
    },
  ),
)
