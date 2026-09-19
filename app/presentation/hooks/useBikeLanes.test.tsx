import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapStore } from '~/application/stores/map-store'
import { listAreaBounds, loadArea } from '~/infrastructure/cache/area-cache'
import { fetchArea } from '~/application/use-cases/fetch-area'
import type { BoundingBox, CachedArea } from '~/domain/entities/area'
import type { BikeLane } from '~/domain/entities/bike-lane'
import { useBikeLanes } from './useBikeLanes'

vi.mock('~/infrastructure/cache/area-cache', () => ({
  listAreaBounds: vi.fn(),
  loadArea: vi.fn(),
}))
vi.mock('~/application/use-cases/fetch-area', () => ({ fetchArea: vi.fn() }))

const mockedList = vi.mocked(listAreaBounds)
const mockedLoad = vi.mocked(loadArea)
const mockedFetch = vi.mocked(fetchArea)

const WARSAW: BoundingBox = { west: 20.9, south: 52.2, east: 21.1, north: 52.3 }
const BERLIN: BoundingBox = { west: 13.3, south: 52.4, east: 13.5, north: 52.6 }

function Probe() {
  useBikeLanes()
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  useMapStore.setState({
    areas: [],
    bikeLanes: [],
    barriers: null,
    bbox: null,
    lastFetchedAt: null,
  })
})

afterEach(cleanup)

describe('useBikeLanes area loading', () => {
  it('restores only the cached areas near the map', async () => {
    mockedList.mockResolvedValue([
      { id: 'warsaw', bbox: WARSAW },
      { id: 'berlin', bbox: BERLIN },
    ])
    mockedLoad.mockImplementation(async id =>
      id === 'warsaw' ? area('warsaw', WARSAW) : undefined,
    )
    useMapStore.setState({ bbox: WARSAW })

    await act(async () => {
      render(<Probe />)
    })

    expect(mockedLoad).toHaveBeenCalledTimes(1)
    expect(mockedLoad).toHaveBeenCalledWith('warsaw')
    expect(useMapStore.getState().areas.map(a => a.id)).toEqual(['warsaw'])
  })

  it('leaves a stale area in the database instead of loading it into the map', async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    mockedList.mockResolvedValue([{ id: 'warsaw', bbox: WARSAW }])
    mockedLoad.mockResolvedValue({ ...area('warsaw', WARSAW), fetchedAt: old })
    useMapStore.setState({ bbox: WARSAW })

    await act(async () => {
      render(<Probe />)
    })

    expect(useMapStore.getState().areas).toEqual([])
  })

  it('drops an area once the map has moved away from it', async () => {
    mockedList.mockResolvedValue([])
    useMapStore.setState({ bbox: WARSAW })
    useMapStore.getState().mergeAreas([area('warsaw', WARSAW)])

    await act(async () => {
      render(<Probe />)
    })
    expect(useMapStore.getState().areas.map(a => a.id)).toEqual(['warsaw'])

    await act(async () => {
      useMapStore.setState({ bbox: BERLIN })
    })

    expect(useMapStore.getState().areas).toEqual([])
    expect(useMapStore.getState().bikeLanes).toEqual([])
  })

  it('does not re-read an area it already holds', async () => {
    mockedList.mockResolvedValue([{ id: 'warsaw', bbox: WARSAW }])
    mockedLoad.mockResolvedValue(area('warsaw', WARSAW))
    useMapStore.setState({ bbox: WARSAW })

    await act(async () => {
      render(<Probe />)
    })
    await act(async () => {
      useMapStore.setState({ bbox: { ...WARSAW, north: 52.31 } })
    })

    expect(mockedLoad).toHaveBeenCalledTimes(1)
  })

  it('adds a fetched area to what is already held', async () => {
    mockedList.mockResolvedValue([])
    mockedFetch.mockResolvedValue(area('fetched', WARSAW))
    useMapStore.setState({ bbox: WARSAW })

    let hook: ReturnType<typeof useBikeLanes> | undefined
    function Capture() {
      hook = useBikeLanes()
      return null
    }
    await act(async () => {
      render(<Capture />)
    })
    await act(async () => {
      await hook!.fetch()
    })

    expect(useMapStore.getState().areas.map(a => a.id)).toEqual(['fetched'])
    expect(useMapStore.getState().bikeLanes).toHaveLength(1)
    expect(useMapStore.getState().lastFetchedAt).toBeInstanceOf(Date)
  })
})

function area(id: string, bbox: BoundingBox): CachedArea {
  return { id, bbox, bikeLanes: [lane(id, bbox)], barriers: null, fetchedAt: new Date() }
}

function lane(id: string, bbox: BoundingBox): BikeLane {
  return {
    id,
    osmId: id,
    geometry: {
      type: 'LineString',
      coordinates: [
        [bbox.west, bbox.south],
        [bbox.east, bbox.north],
      ],
    },
    laneType: 'cycleway',
    tags: {},
  }
}
