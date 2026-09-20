import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import { clearCachedAreas } from '~/infrastructure/cache/area-cache'
import { clearRouteCache } from './build-route'

/** Removes persisted map data and everything in memory that was derived from it. */
export async function clearCachedData(): Promise<void> {
  await clearCachedAreas()
  useMapStore.getState().clearAreas()
  useRoutingStore.getState().setRoute(null)
  clearRouteCache()
}
