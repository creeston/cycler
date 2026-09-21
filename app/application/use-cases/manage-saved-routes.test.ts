import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Route, SavedRoute } from '~/domain/entities/route'
import {
  deleteRoute,
  loadAllRoutes,
  loadRoute,
  saveRoute,
} from '~/infrastructure/cache/route-store'
import {
  MAX_SAVED_ROUTES,
  SavedRouteLimitError,
  SavedRouteStorageError,
  defaultSavedRouteName,
  listSavedRoutes,
  removeSavedRoute,
  saveSavedRoute,
} from './manage-saved-routes'

vi.mock('~/infrastructure/cache/route-store', () => ({
  deleteRoute: vi.fn(),
  loadAllRoutes: vi.fn(),
  loadRoute: vi.fn(),
  saveRoute: vi.fn(),
}))

const mockedDeleteRoute = vi.mocked(deleteRoute)
const mockedLoadAllRoutes = vi.mocked(loadAllRoutes)
const mockedLoadRoute = vi.mocked(loadRoute)
const mockedSaveRoute = vi.mocked(saveRoute)

beforeEach(() => {
  vi.clearAllMocks()
  mockedLoadAllRoutes.mockResolvedValue([])
  mockedLoadRoute.mockResolvedValue(undefined)
  mockedSaveRoute.mockResolvedValue(true)
  mockedDeleteRoute.mockResolvedValue(true)
})

describe('saved route management', () => {
  it('builds a concise default name from distance, shape, and save date', () => {
    expect(defaultSavedRouteName(route(true), new Date(2026, 8, 7))).toBe('14.2 km loop — 7 Sep')
    expect(defaultSavedRouteName(route(false), new Date(2026, 8, 7))).toBe('14.2 km route — 7 Sep')
  })

  it('saves a named route and trims the supplied name', async () => {
    const source = route(true)
    const savedAt = new Date('2026-09-07T08:30:00.000Z')

    const saved = await saveSavedRoute(source, '  Riverside loop  ', savedAt)

    expect(saved).toEqual({ ...source, name: 'Riverside loop', savedAt })
    expect(mockedSaveRoute).toHaveBeenCalledWith(saved)
  })

  it('refuses a new route at the cap without deleting an older one', async () => {
    mockedLoadAllRoutes.mockResolvedValue(
      Array.from({ length: MAX_SAVED_ROUTES }, (_, index) => savedRoute(`saved-${index}`)),
    )

    await expect(saveSavedRoute(route(false))).rejects.toBeInstanceOf(SavedRouteLimitError)
    expect(mockedSaveRoute).not.toHaveBeenCalled()
    expect(mockedDeleteRoute).not.toHaveBeenCalled()
  })

  it('allows an existing saved route to be renamed at the cap', async () => {
    const source = route(false)
    mockedLoadRoute.mockResolvedValue(savedRoute(source.id))

    await expect(saveSavedRoute(source, 'Renamed')).resolves.toMatchObject({ name: 'Renamed' })
    expect(mockedLoadAllRoutes).not.toHaveBeenCalled()
    expect(mockedSaveRoute).toHaveBeenCalledOnce()
  })

  it('reports storage failures instead of claiming the route was saved or deleted', async () => {
    mockedSaveRoute.mockResolvedValue(false)
    await expect(saveSavedRoute(route(false))).rejects.toBeInstanceOf(SavedRouteStorageError)

    mockedDeleteRoute.mockResolvedValue(false)
    await expect(removeSavedRoute('route')).rejects.toBeInstanceOf(SavedRouteStorageError)
  })

  it('lists and deletes through the route store', async () => {
    const routes = [savedRoute('one')]
    mockedLoadAllRoutes.mockResolvedValue(routes)

    await expect(listSavedRoutes()).resolves.toBe(routes)
    await expect(removeSavedRoute('one')).resolves.toBeUndefined()
    expect(mockedDeleteRoute).toHaveBeenCalledWith('one')
  })
})

function route(loop: boolean): Route {
  const coordinates = loop
    ? [
        [21, 52],
        [21.1, 52.1],
        [21, 52],
      ]
    : [
        [21, 52],
        [21.1, 52.1],
      ]
  return {
    id: 'route',
    segments: [
      {
        geometry: { type: 'LineString', coordinates },
        type: 'bike_lane',
        distanceMeters: 14_200,
      },
    ],
    totalDistanceMeters: 14_200,
    bikeLaneDistanceMeters: 14_200,
    bikeLaneCoverage: 1,
    gapCount: 0,
    gapDistanceMeters: 0,
    barrierCrossingCount: 0,
    barriersChecked: true,
    requestedGapMeters: 200,
    appliedGapMeters: 200,
    createdAt: new Date('2026-09-01T07:00:00.000Z'),
  }
}

function savedRoute(id: string): SavedRoute {
  return {
    ...route(false),
    id,
    name: `${id} name`,
    savedAt: new Date('2026-09-07T08:30:00.000Z'),
  }
}
