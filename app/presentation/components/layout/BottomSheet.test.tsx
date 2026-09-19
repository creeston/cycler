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
    isChoosingDestination: false,
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
      gapDistanceMeters: 0,
      barrierCrossingCount: 0,
      barriersChecked: true,
      requestedGapMeters: 200,
      appliedGapMeters: 200,
      createdAt: new Date(0),
    }
    useRoutingStore.setState({ currentRoute: loop })

    render(<BottomSheet />)

    expect(screen.getByText('Route type')).toBeInTheDocument()
    expect(screen.getByText('Loop', { selector: 'span' })).toBeInTheDocument()
  })

  it('shows the road-gap count, total distance, and longest gap', () => {
    const route = routeWithCrossings(0, true)
    useRoutingStore.setState({
      currentRoute: {
        ...route,
        segments: [
          segment('bike_lane', 640, 21),
          segment('gap', 100, 21.01),
          segment('gap', 200, 21.02),
          segment('gap', 340, 21.03),
        ],
        totalDistanceMeters: 1_280,
        bikeLaneDistanceMeters: 640,
        bikeLaneCoverage: 0.5,
        gapCount: 3,
        gapDistanceMeters: 640,
      },
    })

    render(<BottomSheet />)

    expect(screen.getByText('3 road gaps · 640 m')).toBeInTheDocument()
    expect(screen.getByText('Longest gap')).toBeInTheDocument()
    expect(screen.getByText('340 m')).toBeInTheDocument()
  })

  it('reports no road gaps without showing a longest-gap row', () => {
    useRoutingStore.setState({ currentRoute: routeWithCrossings(0, true) })

    render(<BottomSheet />)

    expect(screen.getByText('0 road gaps · 0 m')).toBeInTheDocument()
    expect(screen.queryByText('Longest gap')).not.toBeInTheDocument()
  })

  it('reports a route with no unmarked crossings', () => {
    useRoutingStore.setState({ currentRoute: routeWithCrossings(0, true) })

    render(<BottomSheet />)

    expect(screen.getByText('Major crossings')).toBeInTheDocument()
    expect(screen.getByText('none')).toBeInTheDocument()
    expect(screen.queryByText(/no crossing is mapped/)).not.toBeInTheDocument()
  })

  it('warns when a route crosses a barrier where no crossing is mapped', () => {
    useRoutingStore.setState({ currentRoute: routeWithCrossings(2, true) })

    render(<BottomSheet />)

    expect(screen.getByText('2 unmarked')).toBeInTheDocument()
    expect(screen.getByText(/no crossing is mapped/)).toBeInTheDocument()
  })

  it('says so when barrier data was unavailable', () => {
    useRoutingStore.setState({ currentRoute: routeWithCrossings(0, false) })

    render(<BottomSheet />)

    expect(screen.getByText('not checked')).toBeInTheDocument()
    expect(screen.getByText(/Barrier data was unavailable/)).toBeInTheDocument()
  })

  it('says when the gap tolerance had to be widened to find the route', () => {
    const route = routeWithCrossings(0, true)
    useRoutingStore.setState({
      currentRoute: { ...route, requestedGapMeters: 100, appliedGapMeters: 1_000 },
    })

    render(<BottomSheet />)

    expect(screen.getByText(/No route fit your 100 m gap tolerance/)).toBeInTheDocument()
    expect(screen.getByText(/widened to 1 km/)).toBeInTheDocument()
  })

  it('says nothing about tolerance when the request was met', () => {
    useRoutingStore.setState({ currentRoute: routeWithCrossings(0, true) })

    render(<BottomSheet />)

    expect(screen.queryByText(/gap tolerance/)).not.toBeInTheDocument()
  })

  it('enters destination-picking mode and clears destination coordinates when leaving it', () => {
    render(<BottomSheet />)
    fireEvent.click(screen.getByText('Preferences'))
    fireEvent.click(screen.getByRole('radio', { name: 'To destination' }))

    expect(useRoutingStore.getState().isChoosingDestination).toBe(true)
    expect(useRoutingStore.getState().preferences.roundTrip).toBe(false)
    expect(screen.getByText('Tap the map to choose a destination')).toBeInTheDocument()

    act(() => {
      useRoutingStore.setState(state => ({
        isChoosingDestination: false,
        preferences: { ...state.preferences, endLon: 21.1, endLat: 52.1 },
      }))
    })
    fireEvent.click(screen.getByText('Clear destination'))

    expect(useRoutingStore.getState().preferences.endLon).toBeUndefined()
    expect(useRoutingStore.getState().preferences.endLat).toBeUndefined()
    expect(screen.getByRole('radio', { name: 'Explore' })).toHaveAttribute('aria-checked', 'true')
  })
})

function routeWithCrossings(barrierCrossingCount: number, barriersChecked: boolean): Route {
  return {
    id: 'route',
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
        distanceMeters: 1_000,
      },
    ],
    totalDistanceMeters: 1_000,
    bikeLaneDistanceMeters: 1_000,
    bikeLaneCoverage: 1,
    gapCount: 0,
    gapDistanceMeters: 0,
    barrierCrossingCount,
    barriersChecked,
    requestedGapMeters: 200,
    appliedGapMeters: 200,
    createdAt: new Date(0),
  }
}

function segment(type: 'bike_lane' | 'gap', distanceMeters: number, lon: number) {
  return {
    geometry: {
      type: 'LineString' as const,
      coordinates: [
        [lon, 52],
        [lon + 0.01, 52],
      ],
    },
    type,
    distanceMeters,
  }
}
