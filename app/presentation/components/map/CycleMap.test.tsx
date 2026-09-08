import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoutingStore } from '~/application/stores/routing-store'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import type { Route } from '~/domain/entities/route'
import { CycleMap } from './CycleMap'

const mapMock = vi.hoisted(() => ({ props: {} as Record<string, unknown> }))

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: { children?: ReactNode }) => {
    mapMock.props = props as Record<string, unknown>
    return <div data-testid="map">{props.children}</div>
  },
  NavigationControl: () => null,
  GeolocateControl: () => null,
  Marker: ({
    children,
    longitude,
    latitude,
  }: {
    children?: ReactNode
    longitude: number
    latitude: number
  }) => (
    <div data-latitude={latitude} data-longitude={longitude}>
      {children}
    </div>
  ),
}))

vi.mock('~/presentation/components/map/BikeLaneLayer', () => ({ BikeLaneLayer: () => null }))
vi.mock('~/presentation/components/map/RouteLayer', () => ({ RouteLayer: () => null }))

function mapHandler<Event>(name: string): (event: Event) => void {
  return mapMock.props[name] as (event: Event) => void
}

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

describe('CycleMap destination selection', () => {
  it('does not treat an ordinary map click as a destination', () => {
    render(<CycleMap />)

    act(() =>
      mapHandler<{ lngLat: { lng: number; lat: number } }>('onClick')({
        lngLat: { lng: 21.12, lat: 52.23 },
      }),
    )

    expect(useRoutingStore.getState().preferences.endLon).toBeUndefined()
    expect(useRoutingStore.getState().preferences.endLat).toBeUndefined()
  })

  it('sets a destination from a map click while destination-picking mode is active', () => {
    useRoutingStore.setState({ isChoosingDestination: true })
    render(<CycleMap />)

    act(() =>
      mapHandler<{ lngLat: { lng: number; lat: number } }>('onClick')({
        lngLat: { lng: 21.12, lat: 52.23 },
      }),
    )

    expect(useRoutingStore.getState().preferences).toMatchObject({
      endLon: 21.12,
      endLat: 52.23,
      roundTrip: false,
    })
    expect(useRoutingStore.getState().isChoosingDestination).toBe(false)
    const marker = screen.getByLabelText('Destination').parentElement
    expect(marker).toHaveAttribute('data-longitude', '21.12')
    expect(marker).toHaveAttribute('data-latitude', '52.23')
  })

  it('sets a destination after a 500 ms touch long-press', () => {
    render(<CycleMap />)

    act(() =>
      mapHandler<{ lngLat: { lng: number; lat: number } }>('onTouchStart')({
        lngLat: { lng: 21.2, lat: 52.3 },
      }),
    )
    act(() => vi.advanceTimersByTime(499))
    expect(useRoutingStore.getState().preferences.endLon).toBeUndefined()

    act(() => vi.advanceTimersByTime(1))
    expect(useRoutingStore.getState().preferences).toMatchObject({ endLon: 21.2, endLat: 52.3 })
  })

  it('cancels destination selection when a long-press becomes a drag', () => {
    render(<CycleMap />)

    act(() =>
      mapHandler<{ lngLat: { lng: number; lat: number } }>('onTouchStart')({
        lngLat: { lng: 21.2, lat: 52.3 },
      }),
    )
    act(() => mapHandler<undefined>('onTouchMove')(undefined))
    act(() => vi.advanceTimersByTime(500))

    expect(useRoutingStore.getState().preferences.endLon).toBeUndefined()
    expect(useRoutingStore.getState().preferences.endLat).toBeUndefined()
  })

  it('sets a destination from a desktop context menu', () => {
    const preventDefault = vi.fn()
    render(<CycleMap />)

    act(() =>
      mapHandler<{
        lngLat: { lng: number; lat: number }
        originalEvent: { preventDefault: () => void }
      }>('onContextMenu')({
        lngLat: { lng: 21.3, lat: 52.4 },
        originalEvent: { preventDefault },
      }),
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(useRoutingStore.getState().preferences).toMatchObject({ endLon: 21.3, endLat: 52.4 })
  })

  it('moves the destination marker to the snapped route endpoint', () => {
    const route: Route = {
      id: 'one-way',
      segments: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [21, 52],
              [21.15, 52.25],
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
    useRoutingStore.setState(state => ({
      currentRoute: route,
      preferences: { ...state.preferences, endLon: 21.2, endLat: 52.3 },
    }))

    render(<CycleMap />)

    const marker = screen.getByLabelText('Destination').parentElement
    expect(marker).toHaveAttribute('data-longitude', '21.15')
    expect(marker).toHaveAttribute('data-latitude', '52.25')
  })

  it('does not show a destination marker for a route without a selected destination', () => {
    const route: Route = {
      id: 'explore',
      segments: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [21, 52],
              [21.15, 52.25],
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
    useRoutingStore.setState({ currentRoute: route })

    render(<CycleMap />)

    expect(screen.queryByLabelText('Destination')).not.toBeInTheDocument()
  })
})
