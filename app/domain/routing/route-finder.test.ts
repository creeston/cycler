import { describe, expect, it } from 'vitest'
import type { Position } from 'geojson'
import type { RouteSegment } from '../entities/route'
import { routeSignature } from './route-finder'

const nodeCoordinates: Record<string, Position> = {
  A: [1, 1],
  B: [1.001, 1],
  C: [1.002, 1],
  D: [1.003, 1],
  E: [1.004, 1],
}

function segments(nodeNames: string[]): RouteSegment[] {
  return nodeNames.slice(0, -1).map((name, index) => ({
    geometry: {
      type: 'LineString',
      coordinates: [nodeCoordinates[name], nodeCoordinates[nodeNames[index + 1]]],
    },
    type: 'bike_lane',
    distanceMeters: 100,
  }))
}

describe('routeSignature', () => {
  it('distinguishes routes that differ only at the terminal node', () => {
    expect(routeSignature(segments(['A', 'B', 'C', 'D']))).not.toBe(
      routeSignature(segments(['A', 'B', 'C', 'E'])),
    )
  })

  it('identifies opposite traversals of the same loop', () => {
    expect(routeSignature(segments(['A', 'B', 'C', 'D', 'A']))).toBe(
      routeSignature(segments(['A', 'D', 'C', 'B', 'A'])),
    )
  })

  it('identifies the same loop entered at a different node', () => {
    expect(routeSignature(segments(['A', 'B', 'C', 'A']))).toBe(
      routeSignature(segments(['B', 'C', 'A', 'B'])),
    )
  })

  it('identifies opposite traversals of the same open route', () => {
    expect(routeSignature(segments(['A', 'B', 'C']))).toBe(
      routeSignature(segments(['C', 'B', 'A'])),
    )
  })

  it('uses snapped node keys instead of raw coordinate strings', () => {
    const original = segments(['A', 'B', 'C'])
    const drifted = segments(['A', 'B', 'C'])
    drifted[0].geometry.coordinates[0] = [1.000004, 0.999996]

    expect(routeSignature(drifted)).toBe(routeSignature(original))
  })
})
