import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CachedArea } from '~/domain/entities/area'

interface CycleDB extends DBSchema {
  areas: {
    key: string
    value: CachedArea
    indexes: { 'by-fetched-at': Date }
  }
}

let _db: IDBPDatabase<CycleDB> | null = null

export async function getDb(): Promise<IDBPDatabase<CycleDB>> {
  if (_db) return _db
  _db = await openDB<CycleDB>('cycle-app', 1, {
    upgrade(db) {
      const store = db.createObjectStore('areas', { keyPath: 'id' })
      store.createIndex('by-fetched-at', 'fetchedAt')
    },
  })
  return _db
}
