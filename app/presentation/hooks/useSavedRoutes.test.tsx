import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  listSavedRoutes,
  removeSavedRoute,
  saveSavedRoute,
} from '~/application/use-cases/manage-saved-routes'
import type { SavedRoute } from '~/domain/entities/route'
import { useSavedRoutes } from './useSavedRoutes'

vi.mock('~/application/use-cases/manage-saved-routes', () => ({
  listSavedRoutes: vi.fn(),
  removeSavedRoute: vi.fn(),
  saveSavedRoute: vi.fn(),
}))

const mockedList = vi.mocked(listSavedRoutes)
const mockedRemove = vi.mocked(removeSavedRoute)
const mockedSave = vi.mocked(saveSavedRoute)

beforeEach(() => {
  vi.clearAllMocks()
  mockedList.mockResolvedValue([])
  mockedRemove.mockResolvedValue()
})

it('loads saved routes on mount so they return after a reload', async () => {
  const stored = route('stored', new Date('2026-09-07T08:30:00.000Z'))
  mockedList.mockResolvedValue([stored])

  const { result } = renderHook(() => useSavedRoutes())

  await waitFor(() => expect(result.current.isLoadingSavedRoutes).toBe(false))
  expect(result.current.savedRoutes).toEqual([stored])
})

it('adds saved routes newest-first and removes them from local state', async () => {
  const older = route('older', new Date('2026-09-06T08:30:00.000Z'))
  const newer = route('newer', new Date('2026-09-07T08:30:00.000Z'))
  mockedList.mockResolvedValue([older])
  mockedSave.mockResolvedValue(newer)
  const { result } = renderHook(() => useSavedRoutes())
  await waitFor(() => expect(result.current.isLoadingSavedRoutes).toBe(false))

  await act(() => result.current.save(newer, newer.name))
  expect(result.current.savedRoutes).toEqual([newer, older])

  await act(() => result.current.remove(newer.id))
  expect(result.current.savedRoutes).toEqual([older])
})

function route(id: string, savedAt: Date): SavedRoute {
  return {
    id,
    name: `${id} route`,
    savedAt,
    segments: [],
    totalDistanceMeters: 1_000,
    bikeLaneDistanceMeters: 1_000,
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
