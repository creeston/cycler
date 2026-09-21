import { useCallback, useEffect, useState } from 'react'
import {
  listSavedRoutes,
  removeSavedRoute,
  saveSavedRoute,
} from '~/application/use-cases/manage-saved-routes'
import type { Route, SavedRoute } from '~/domain/entities/route'

interface SavedRoutesState {
  savedRoutes: SavedRoute[]
  isLoadingSavedRoutes: boolean
  savedRoutesError: string | null
  save: (route: Route, name?: string) => Promise<SavedRoute | null>
  remove: (id: string) => Promise<boolean>
}

export function useSavedRoutes(): SavedRoutesState {
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([])
  const [isLoadingSavedRoutes, setIsLoadingSavedRoutes] = useState(true)
  const [savedRoutesError, setSavedRoutesError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void listSavedRoutes()
      .then(routes => {
        if (active) setSavedRoutes(routes)
      })
      .catch(error => {
        if (active) setSavedRoutesError(errorMessage(error))
      })
      .finally(() => {
        if (active) setIsLoadingSavedRoutes(false)
      })
    return () => {
      active = false
    }
  }, [])

  const save = useCallback(async (route: Route, name?: string): Promise<SavedRoute | null> => {
    setSavedRoutesError(null)
    try {
      const saved = await saveSavedRoute(route, name)
      setSavedRoutes(routes =>
        [saved, ...routes.filter(route => route.id !== saved.id)].sort(
          (a, b) => b.savedAt.getTime() - a.savedAt.getTime(),
        ),
      )
      return saved
    } catch (error) {
      setSavedRoutesError(errorMessage(error))
      return null
    }
  }, [])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    setSavedRoutesError(null)
    try {
      await removeSavedRoute(id)
      setSavedRoutes(routes => routes.filter(route => route.id !== id))
      return true
    } catch (error) {
      setSavedRoutesError(errorMessage(error))
      return false
    }
  }, [])

  return { savedRoutes, isLoadingSavedRoutes, savedRoutesError, save, remove }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Saved routes could not be updated.'
}
