import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CachedArea } from '~/domain/entities/area'
import type { SavedRoute } from '~/domain/entities/route'

interface CycleDB extends DBSchema {
  areas: {
    key: string
    value: CachedArea
    indexes: { 'by-fetched-at': Date }
  }
  routes: {
    key: string
    value: SavedRoute
    indexes: { 'by-saved-at': Date }
  }
}

let _db: Promise<IDBPDatabase<CycleDB> | null> | null = null

/**
 * Opens the cache database, or resolves null when this browser will not give
 * it to us. A private window, blocked site data or a disabled storage API make
 * `indexedDB.open()` reject — Firefox with "The user denied permission to
 * access the database." The cache is an optimisation, so callers continue
 * without it rather than failing.
 *
 * The result is remembered for the session: a browser that refused once is not
 * asked again until the page reloads.
 */
export function tryGetDb(): Promise<IDBPDatabase<CycleDB> | null> {
  if (!_db) _db = openCycleDb()
  return _db
}

async function openCycleDb(): Promise<IDBPDatabase<CycleDB> | null> {
  if (typeof indexedDB === 'undefined') return null

  try {
    return await openDB<CycleDB>('cycle-app', 2, {
      upgrade(db, oldVersion) {
        switch (oldVersion) {
          case 0: {
            if (!db.objectStoreNames.contains('areas')) {
              const store = db.createObjectStore('areas', { keyPath: 'id' })
              store.createIndex('by-fetched-at', 'fetchedAt')
            }
            if (!db.objectStoreNames.contains('routes')) {
              const store = db.createObjectStore('routes', { keyPath: 'id' })
              store.createIndex('by-saved-at', 'savedAt')
            }
            break
          }
          case 1: {
            if (!db.objectStoreNames.contains('routes')) {
              const store = db.createObjectStore('routes', { keyPath: 'id' })
              store.createIndex('by-saved-at', 'savedAt')
            }
            break
          }
        }
      },
    })
  } catch (err) {
    console.warn('Local storage is unavailable — map areas and saved routes will not persist.', err)
    return null
  }
}
