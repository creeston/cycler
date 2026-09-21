import { tryGetDb } from './db'
import type { SavedRoute } from '~/domain/entities/route'

/** Returns false when the route could not be stored. */
export async function saveRoute(route: SavedRoute): Promise<boolean> {
  const db = await tryGetDb()
  if (!db) return false

  try {
    await db.put('routes', route)
    return true
  } catch (err) {
    console.warn(`Could not save route ${route.id}.`, err)
    return false
  }
}

export async function loadRoute(id: string): Promise<SavedRoute | undefined> {
  const db = await tryGetDb()
  if (!db) return undefined

  try {
    const route = await db.get('routes', id)
    return route ? reviveSavedRoute(route) : undefined
  } catch (err) {
    console.warn(`Could not read saved route ${id}.`, err)
    return undefined
  }
}

/** Returns all saved routes, newest first. */
export async function loadAllRoutes(): Promise<SavedRoute[]> {
  const db = await tryGetDb()
  if (!db) return []

  try {
    const routes: SavedRoute[] = []
    let cursor = await db
      .transaction('routes', 'readonly')
      .store.index('by-saved-at')
      .openCursor(null, 'prev')
    while (cursor) {
      routes.push(reviveSavedRoute(cursor.value))
      cursor = await cursor.continue()
    }
    return routes
  } catch (err) {
    console.warn('Could not list saved routes.', err)
    return []
  }
}

/** Returns false when the route could not be deleted. */
export async function deleteRoute(id: string): Promise<boolean> {
  const db = await tryGetDb()
  if (!db) return false

  try {
    await db.delete('routes', id)
    return true
  } catch (err) {
    console.warn(`Could not delete saved route ${id}.`, err)
    return false
  }
}

function reviveSavedRoute(route: SavedRoute): SavedRoute {
  return {
    ...route,
    createdAt: new Date(route.createdAt),
    savedAt: new Date(route.savedAt),
  }
}
