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
