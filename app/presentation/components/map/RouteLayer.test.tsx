import { cleanup, render } from '@testing-library/react'
import type { FeatureCollection } from 'geojson'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoutingStore } from '~/application/stores/routing-store'
import type { Route } from '~/domain/entities/route'
import { RouteLayer } from './RouteLayer'

interface LayerProps {
  id: string
  filter?: unknown
  paint?: Record<string, unknown>
}

const mapMock = vi.hoisted(() => ({
  data: null as FeatureCollection | null,
  layers: [] as LayerProps[],
}))

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({ children, data }: { children?: ReactNode; data: FeatureCollection }) => {
    mapMock.data = data
    return <div data-testid="route-source">{children}</div>
  },
  Layer: (props: LayerProps) => {
    mapMock.layers.push(props)
    return null
  },
}))

beforeEach(() => {
  mapMock.data = null
  mapMock.layers = []
  useRoutingStore.setState({ currentRoute: route })
})

afterEach(cleanup)

describe('RouteLayer', () => {
  it('draws bike lanes solid and road gaps as high-contrast blue dashes', () => {
    render(<RouteLayer />)

    expect(mapMock.data?.features).toHaveLength(2)
    expect(mapMock.data?.features.map(feature => feature.properties?.type)).toEqual([
      'bike_lane',
      'gap',
    ])

    expect(layer('route-lane-fill').filter).toEqual(['==', ['get', 'type'], 'bike_lane'])
    expect(layer('route-gap-fill').filter).toEqual(['==', ['get', 'type'], 'gap'])
    expect(layer('route-gap-fill').paint).toMatchObject({
      'line-color': '#0072B2',
      'line-width': 6,
      'line-opacity': 1,
      'line-dasharray': [1.5, 1.25],
    })
    expect(mapMock.layers.map(item => item.id)).not.toContain('route-connector')
  })
})

function layer(id: string): LayerProps {
  const found = mapMock.layers.find(item => item.id === id)
  expect(found, `missing layer ${id}`).toBeDefined()
  return found!
}

const route: Route = {
  id: 'route-with-gap',
  segments: [
    {
      geometry: {
        type: 'LineString',
        coordinates: [
          [21, 52],
          [21.01, 52],
        ],
      },
      type: 'bike_lane',
      distanceMeters: 700,
    },
    {
      geometry: {
        type: 'LineString',
        coordinates: [
          [21.01, 52],
          [21.02, 52],
        ],
      },
      type: 'gap',
      distanceMeters: 300,
    },
  ],
  totalDistanceMeters: 1_000,
  bikeLaneDistanceMeters: 700,
  bikeLaneCoverage: 0.7,
  gapCount: 1,
  gapDistanceMeters: 300,
  barrierCrossingCount: 0,
  barriersChecked: true,
  requestedGapMeters: 300,
  appliedGapMeters: 300,
  createdAt: new Date(0),
}
