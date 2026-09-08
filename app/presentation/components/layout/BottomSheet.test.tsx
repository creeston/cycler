import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoutingStore } from '~/application/stores/routing-store'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import type { Route, RoutePreferences } from '~/domain/entities/route'
import { BottomSheet } from './BottomSheet'

vi.mock('~/presentation/hooks/useBikeLanes', () => ({
  useBikeLanes: () => ({
    fetch: vi.fn(),
    isLoading: false,
    lastFetchedAt: null,
    isAreaTooLarge: false,
  }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useRoutingStore.setState({
    currentRoute: null,
    preferences: { ...DEFAULT_PREFERENCES },
    routeError: null,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('BottomSheet preferences', () => {
  it('debounces and persists gap tolerance changes', () => {
    render(<BottomSheet />)
    fireEvent.click(screen.getByText('Preferences'))

    const slider = screen.getByRole('slider', { name: 'Gap tolerance' })
    fireEvent.change(slider, { target: { value: '300' } })

    expect(screen.getByText('300 m')).toBeInTheDocument()
    expect(useRoutingStore.getState().preferences.maxGapMeters).toBe(200)

    act(() => vi.advanceTimersByTime(200))

    expect(useRoutingStore.getState().preferences.maxGapMeters).toBe(300)
    const persisted = JSON.parse(localStorage.getItem('cycle-routing') ?? '{}') as {
      state?: { preferences?: RoutePreferences }
    }
    expect(persisted.state?.preferences?.maxGapMeters).toBe(300)
  })

  it('selects and persists Loop mode', () => {
    render(<BottomSheet />)
    fireEvent.click(screen.getByText('Preferences'))

    expect(screen.getByRole('radio', { name: 'Explore' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Loop' }))

    expect(useRoutingStore.getState().preferences.roundTrip).toBe(true)
    expect(screen.getByRole('radio', { name: 'Loop' })).toHaveAttribute('aria-checked', 'true')
    const persisted = JSON.parse(localStorage.getItem('cycle-routing') ?? '{}') as {
      state?: { preferences?: RoutePreferences }
    }
    expect(persisted.state?.preferences?.roundTrip).toBe(true)
  })

  it('labels a closed route as a Loop in the metrics', () => {
    const loop: Route = {
      id: 'loop',
      segments: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [21, 52],
              [21.1, 52.1],
              [21, 52],
            ],
          },
          type: 'bike_lane',
          distanceMeters: 1_000,
        },
      ],
      totalDistanceMeters: 1_000,
      bikeLaneDistanceMeters: 1_000,
      bikeLaneCoverage: 1,
      gapCount: 0,
      createdAt: new Date(0),
    }
    useRoutingStore.setState({ currentRoute: loop })

    render(<BottomSheet />)

    expect(screen.getByText('Route type')).toBeInTheDocument()
    expect(screen.getByText('Loop', { selector: 'span' })).toBeInTheDocument()
  })
})
