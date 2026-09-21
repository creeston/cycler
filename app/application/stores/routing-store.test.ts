import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  localStorage.clear()
  vi.resetModules()
})

it('revives a persisted route creation date during rehydration', async () => {
  localStorage.setItem(
    'cycle-routing',
    JSON.stringify({
      state: {
        currentRoute: {
          id: 'persisted-route',
          segments: [],
          totalDistanceMeters: 0,
          bikeLaneDistanceMeters: 0,
          bikeLaneCoverage: 0,
          gapCount: 0,
          gapDistanceMeters: 0,
          barrierCrossingCount: 0,
          barriersChecked: true,
          requestedGapMeters: 200,
          appliedGapMeters: 200,
          createdAt: '2026-09-20T08:30:00.000Z',
        },
      },
      version: 0,
    }),
  )

  const { useRoutingStore } = await import('./routing-store')
  const createdAt = useRoutingStore.getState().currentRoute?.createdAt

  expect(createdAt).toBeInstanceOf(Date)
  expect(createdAt?.getTime()).toBe(Date.parse('2026-09-20T08:30:00.000Z'))
})

it('drops the old 0,0 start sentinel so the device position is used instead', async () => {
  localStorage.setItem(
    'cycle-routing',
    JSON.stringify({
      state: { currentRoute: null, preferences: { startLon: 0, startLat: 0, maxGapMeters: 300 } },
      version: 0,
    }),
  )

  const { useRoutingStore } = await import('./routing-store')
  const { preferences } = useRoutingStore.getState()

  expect(preferences.startLon).toBeUndefined()
  expect(preferences.startLat).toBeUndefined()
  expect(preferences.maxGapMeters).toBe(300)
})

it('keeps a start point that was actually chosen when migrating', async () => {
  localStorage.setItem(
    'cycle-routing',
    JSON.stringify({
      state: { currentRoute: null, preferences: { startLon: 21.01, startLat: 52.23 } },
      version: 0,
    }),
  )

  const { useRoutingStore } = await import('./routing-store')

  expect(useRoutingStore.getState().preferences).toMatchObject({ startLon: 21.01, startLat: 52.23 })
})
