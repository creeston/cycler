import { cleanup, render, act } from '@testing-library/react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { useMapStore } from '~/application/stores/map-store'
import { useRoutingStore } from '~/application/stores/routing-store'
import type { BikeLane } from '~/domain/entities/bike-lane'
import { BikeLaneLayer } from './BikeLaneLayer'

const sourceMock = vi.hoisted(() => ({ data: null as FeatureCollection | null, renders: 0 }))

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({ children, data }: { children?: ReactNode; data: FeatureCollection }) => {
    sourceMock.data = data
    sourceMock.renders++
    return <div data-testid="source">{children}</div>
  },
  Layer: () => null,
}))

beforeEach(() => {
  sourceMock.data = null
  sourceMock.renders = 0
  useMapStore.setState({ bikeLanes: [], areas: [], bbox: null })
  useRoutingStore.setState({ currentRoute: null })
})

afterEach(cleanup)

describe('BikeLaneLayer', () => {
  it('draws only the lanes near the view', () => {
    useMapStore.setState({
      bikeLanes: [lane('near', 21.0), lane('far', 22.5)],
      bbox: { west: 20.9, south: 52.2, east: 21.1, north: 52.3 },
    })

    render(<BikeLaneLayer />)

    expect(featureIds()).toEqual(['near'])
  })

  it('keeps a lane just outside the view, within the margin', () => {
    // The view spans 0.2° of longitude, so the margin reaches 0.05° past its edge.
    useMapStore.setState({
      bikeLanes: [lane('just-outside', 21.13)],
      bbox: { west: 20.9, south: 52.2, east: 21.1, north: 52.3 },
    })

    render(<BikeLaneLayer />)

    expect(featureIds()).toEqual(['just-outside'])
  })

  it('draws everything when the map has not reported a box yet', () => {
    useMapStore.setState({ bikeLanes: [lane('a', 21.0), lane('b', 22.5)], bbox: null })

    render(<BikeLaneLayer />)

    expect(featureIds()).toEqual(['a', 'b'])
  })

  it('reuses the same feature collection across re-renders of the map', () => {
    useMapStore.setState({
      bikeLanes: [lane('near', 21.0)],
      bbox: { west: 20.9, south: 52.2, east: 21.1, north: 52.3 },
    })

    let rerenderParent = () => {}
    function Parent() {
      const [, setTick] = useState(0)
      rerenderParent = () => setTick(t => t + 1)
      return <BikeLaneLayer />
    }
    render(<Parent />)
    const first = sourceMock.data

    act(() => rerenderParent())
    act(() => rerenderParent())

    expect(sourceMock.renders).toBeGreaterThan(1)
    expect(sourceMock.data, 'a new identity would make MapLibre re-parse the source').toBe(first)
  })

  it('builds a new collection when the lanes change', () => {
    useMapStore.setState({
      bikeLanes: [lane('near', 21.0)],
      bbox: { west: 20.9, south: 52.2, east: 21.1, north: 52.3 },
    })
    render(<BikeLaneLayer />)
    const first = sourceMock.data

    act(() => useMapStore.setState({ bikeLanes: [lane('near', 21.0), lane('other', 21.05)] }))

    expect(sourceMock.data).not.toBe(first)
    expect(featureIds()).toEqual(['near', 'other'])
  })
})

function featureIds(): string[] {
  return (sourceMock.data?.features ?? []).map(f => (f.properties as { id: string }).id)
}

function lane(id: string, lon: number): BikeLane {
  return {
    id,
    osmId: id,
    geometry: {
      type: 'LineString',
      coordinates: [
        [lon, 52.25],
        [lon + 0.001, 52.25],
      ],
    },
    laneType: 'cycleway',
    tags: {},
  }
}
