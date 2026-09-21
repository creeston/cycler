import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { deleteRoute, loadAllRoutes, loadRoute, saveRoute } from './route-store'
import { routeToGpx } from '~/infrastructure/export/gpx'
import type { SavedRoute } from '~/domain/entities/route'

beforeEach(async () => {
  for (const route of await loadAllRoutes()) await deleteRoute(route.id)
})

describe('saved route store', () => {
  it('saves and loads the complete route with native dates and geometry intact', async () => {
    const saved = route('morning-loop', new Date('2026-09-07T08:30:00.000Z'))

    await expect(saveRoute(saved)).resolves.toBe(true)

    const restored = await loadRoute(saved.id)
    expect(restored).toEqual(saved)
    expect(restored?.createdAt).toBeInstanceOf(Date)
    expect(restored?.savedAt).toBeInstanceOf(Date)
    expect(restored?.segments).toEqual(saved.segments)
    if (!restored) throw new Error('Expected the saved route to be restored')
    expect(routeToGpx(restored, restored.name)).toBe(routeToGpx(saved, saved.name))
  })

  it('lists routes newest first through the saved-at index', async () => {
    const oldest = route('oldest', new Date('2026-09-05T08:30:00.000Z'))
    const newest = route('newest', new Date('2026-09-07T08:30:00.000Z'))
    const middle = route('middle', new Date('2026-09-06T08:30:00.000Z'))
    await saveRoute(oldest)
    await saveRoute(newest)
    await saveRoute(middle)

    const routes = await loadAllRoutes()

    expect(routes.map(saved => saved.id)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('deletes a saved route permanently', async () => {
    const saved = route('delete-me', new Date('2026-09-07T08:30:00.000Z'))
    await saveRoute(saved)

    await expect(deleteRoute(saved.id)).resolves.toBe(true)
    await expect(loadRoute(saved.id)).resolves.toBeUndefined()
    await expect(loadAllRoutes()).resolves.toEqual([])
  })
})

function route(id: string, savedAt: Date): SavedRoute {
  return {
    id,
    name: `${id} name`,
    savedAt,
    segments: [
      {
        geometry: {
          type: 'LineString',
          coordinates: [
            [21, 52],
            [21.1, 52.1],
          ],
        },
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
