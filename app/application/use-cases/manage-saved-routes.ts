import { isRoundTrip } from '~/domain/entities/route'
import type { Route, SavedRoute } from '~/domain/entities/route'
import {
  deleteRoute,
  loadAllRoutes,
  loadRoute,
  saveRoute,
} from '~/infrastructure/cache/route-store'

export const MAX_SAVED_ROUTES = 50

export class SavedRouteLimitError extends Error {
  constructor() {
    super(`You can save up to ${MAX_SAVED_ROUTES} routes. Delete one before saving another.`)
    this.name = 'SavedRouteLimitError'
  }
}

export class SavedRouteStorageError extends Error {
  constructor(action: 'save' | 'delete') {
    super(
      action === 'save'
        ? 'This route could not be saved. Check that site storage is available and try again.'
        : 'This route could not be deleted. Check that site storage is available and try again.',
    )
    this.name = 'SavedRouteStorageError'
  }
}

export function defaultSavedRouteName(route: Route, savedAt = new Date()): string {
  const distance = `${(route.totalDistanceMeters / 1_000).toFixed(1)} km`
  const kind = isRoundTrip(route) ? 'loop' : 'route'
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${distance} ${kind} — ${savedAt.getDate()} ${months[savedAt.getMonth()]}`
}

export async function saveSavedRoute(
  route: Route,
  name?: string,
  savedAt = new Date(),
): Promise<SavedRoute> {
  const existing = await loadRoute(route.id)
  if (!existing && (await loadAllRoutes()).length >= MAX_SAVED_ROUTES) {
    throw new SavedRouteLimitError()
  }

  const trimmedName = name?.trim()
  const saved: SavedRoute = {
    ...route,
    name: trimmedName || defaultSavedRouteName(route, savedAt),
    savedAt,
  }
  if (!(await saveRoute(saved))) throw new SavedRouteStorageError('save')
  return saved
}

export function listSavedRoutes(): Promise<SavedRoute[]> {
  return loadAllRoutes()
}

export async function removeSavedRoute(id: string): Promise<void> {
  if (!(await deleteRoute(id))) throw new SavedRouteStorageError('delete')
}
