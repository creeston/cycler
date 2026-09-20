import { describe, it, expect } from 'vitest'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { loadScenario } from './test-utils/graph-scenario'
import { runExplore, runOneWay, runRoundTrip } from './route-finder'
import { astar, haversineTo } from './search'
import { approxMeters, coordKey } from './algorithms'
import { buildGraph } from './graph'
import type { BikeLane } from '../entities/bike-lane'
import type { Route } from '../entities/route'
import type { RouteSegment } from '../entities/route'
import type { Scenario, ScenarioExpect } from './test-utils/graph-scenario'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scenario = (name: string) => join(__dirname, 'scenarios', 'graph-to-path', name)

function routeNodeSequence(segments: RouteSegment[], keyToName: Map<string, string>): string[] {
  if (segments.length === 0) return []
  const nodes: string[] = []
  for (const seg of segments) {
    const c = seg.geometry.coordinates[0]
    nodes.push(keyToName.get(coordKey(c[0], c[1])) ?? '?')
  }
  const lastSeg = segments[segments.length - 1]
  const lc = lastSeg.geometry.coordinates[lastSeg.geometry.coordinates.length - 1]
  nodes.push(keyToName.get(coordKey(lc[0], lc[1])) ?? '?')
  return nodes
}

/** Round trips rotate their bearing fan by a seed; scenarios pin one so the runs are repeatable. */
const SCENARIO_SEED = 1

function runScenario(sc: Scenario): Route[] {
  if (sc.endKey) {
    return runOneWay(sc.graph, sc.startKey, sc.endKey, sc.minDist, sc.maxDist)
  }
  if (sc.roundTrip) {
    return runRoundTrip(sc.graph, sc.startKey, sc.minDist, sc.maxDist, SCENARIO_SEED)
  }
  return runExplore(sc.graph, sc.startKey, sc.minDist, sc.maxDist)
}

function check(routes: Route[], sc: Scenario) {
  const ex: ScenarioExpect = sc.expect
  const keyToName = sc.keyToName
  for (const route of routes) {
    for (let i = 0; i < route.segments.length - 1; i++) {
      const current = route.segments[i].geometry.coordinates
      const next = route.segments[i + 1].geometry.coordinates
      const end = current[current.length - 1]
      const start = next[0]
      expect(
        approxMeters(end[0], end[1], start[0], start[1]),
        `route geometry is discontinuous between segments ${i} and ${i + 1}`,
      ).toBeLessThanOrEqual(2)
    }
  }

  for (const route of routes) {
    expect(route.totalDistanceMeters, 'route shorter than minDist').toBeGreaterThanOrEqual(
      sc.minDist,
    )
    expect(route.totalDistanceMeters, 'route longer than maxDist').toBeLessThanOrEqual(sc.maxDist)
    expect(route.bikeLaneDistanceMeters + route.gapDistanceMeters).toBeCloseTo(
      route.totalDistanceMeters,
    )
  }

  if (ex.minRoutes !== undefined) expect(routes.length).toBeGreaterThanOrEqual(ex.minRoutes)

  if (ex.maxRoutes !== undefined) expect(routes.length).toBeLessThanOrEqual(ex.maxRoutes)

  if (ex.hasGap !== undefined && routes.length > 0)
    expect(routes.some(r => r.gapCount > 0)).toBe(ex.hasGap)

  if (ex.maxGaps !== undefined)
    routes.forEach(r => expect(r.gapCount).toBeLessThanOrEqual(ex.maxGaps!))

  if (ex.minCoverage !== undefined && routes.length > 0)
    routes.forEach(r => expect(r.bikeLaneCoverage).toBeGreaterThanOrEqual(ex.minCoverage!))

  if (ex.isRoundTrip && routes.length > 0) {
    const hasRoundTrip = routes.some(r => {
      if (r.segments.length === 0) return false
      const firstSeg = r.segments[0]
      const lastSeg = r.segments[r.segments.length - 1]
      const firstCoord = firstSeg.geometry.coordinates[0]
      const lastCoord = lastSeg.geometry.coordinates[lastSeg.geometry.coordinates.length - 1]
      return firstCoord[0] === lastCoord[0] && firstCoord[1] === lastCoord[1]
    })
    expect(hasRoundTrip, 'Expected at least one route to be a round trip').toBe(true)
  }

  if (ex.routes && ex.routes.length > 0) {
    const foundSequences = routes.map(r => routeNodeSequence(r.segments, keyToName).join(','))
    for (const expectedRoute of ex.routes) {
      const key = expectedRoute.join(',')
      expect(
        foundSequences.includes(key),
        `Expected route [${key}] but found: ${foundSequences.join(' | ') || '(none)'}`,
      ).toBe(true)
    }
  }

  if (ex.anyRoute && ex.anyRoute.length > 0) {
    const foundSequences = routes.map(r => routeNodeSequence(r.segments, keyToName).join(','))
    const keys = ex.anyRoute.map(r => r.join(','))
    expect(
      keys.some(k => foundSequences.includes(k)),
      `Expected at least one of [${keys.join(' | ')}] but found: ${foundSequences.join(' | ') || '(none)'}`,
    ).toBe(true)
  }
}

describe('graph routing scenarios', () => {
  it('simple-chain: finds the exact route A,B,C,D,E on a straight connected chain', () => {
    const sc = loadScenario(scenario('simple-chain.dot'))
    check(runScenario(sc), sc)
  })

  it('gap-bridging: finds exact route A,B,C,D,E,F traversing the gap edge', () => {
    const sc = loadScenario(scenario('gap-bridging.dot'))
    check(runScenario(sc), sc)
  })

  it('gap-metrics: counts gap segments and sums their distance', () => {
    const sc = loadScenario(scenario('gap-metrics.dot'))
    const routes = runScenario(sc)
    check(routes, sc)

    expect(routes[0]).toMatchObject({ gapCount: 3, gapDistanceMeters: 640 })
  })

  it('dead-end: finds exact route A,B,C,E,F bypassing the dead-end branch', () => {
    const sc = loadScenario(scenario('dead-end.dot'))
    check(runScenario(sc), sc)
  })

  it('branching: discovers both routes A,B,C,E and A,B,D,F through the fork', () => {
    const sc = loadScenario(scenario('branching.dot'))
    check(runScenario(sc), sc)
  })

  it('terminal-fan-out: keeps routes that differ only at their terminal node', () => {
    const sc = loadScenario(scenario('terminal-fan-out.dot'))
    check(runScenario(sc), sc)
  })

  it('isolated-lanes: returns no routes when all segments are too short', () => {
    const sc = loadScenario(scenario('isolated-lanes.dot'))
    check(runScenario(sc), sc)
  })

  it('round-trip: finds a circular route returning to start without repeating edges', () => {
    const sc = loadScenario(scenario('round-trip.dot'))
    check(runScenario(sc), sc)
  })

  it('one-way-chain: finds the single route A→E on a straight chain', () => {
    const sc = loadScenario(scenario('one-way-chain.dot'))
    check(runScenario(sc), sc)
  })

  it('one-way-branching: finds shortest path A→E through a fork (either branch)', () => {
    const sc = loadScenario(scenario('one-way-branching.dot'))
    check(runScenario(sc), sc)
  })

  it('gap-penalty-detour: takes the longer all-lane route once gaps are priced', () => {
    const sc = loadScenario(scenario('gap-penalty-detour.dot'))
    check(runScenario(sc), sc)
  })

  it('barrier-detour: routes the long way round rather than across an arterial', () => {
    const sc = loadScenario(scenario('barrier-detour.dot'))
    check(runScenario(sc), sc)
  })

  it('barrier-last-resort: the flagged gap is never taken while a clean one exists', () => {
    const sc = loadScenario(scenario('barrier-last-resort.dot'))
    check(runScenario(sc), sc)
  })

  it('overshoot: explore never returns a route longer than maxDist', () => {
    const sc = loadScenario(scenario('overshoot.dot'))
    check(runScenario(sc), sc)
  })

  it('round-trip-spurs: closes the loop although every node offers a dead end', () => {
    const sc = loadScenario(scenario('round-trip-spurs.dot'))
    check(runScenario(sc), sc)
  })

  it('round-trip-lollipop: returns no loop when the only way home repeats an edge', () => {
    const sc = loadScenario(scenario('round-trip-lollipop.dot'))
    check(runScenario(sc), sc)
  })

  it('grid-heuristic: finds the straight row across the grid', () => {
    const sc = loadScenario(scenario('grid-heuristic.dot'))
    check(runScenario(sc), sc)
  })

  it('grid-heuristic: A* expands strictly fewer nodes than Dijkstra for the same path', () => {
    const sc = loadScenario(scenario('grid-heuristic.dot'))
    const guided = astar(sc.graph, sc.startKey, sc.endKey!, {
      heuristic: haversineTo(sc.graph, sc.endKey!),
    })
    const dijkstra = astar(sc.graph, sc.startKey, sc.endKey!)

    expect(guided.path).toEqual(dijkstra.path)
    expect(guided.expanded).toBeLessThan(dijkstra.expanded)
  })
})

describe('segment orientation', () => {
  it('uses snapped node identity when raw endpoints differ inside one grid cell', () => {
    const sharedFirst: [number, number] = [21, 52.000004]
    const sharedLast: [number, number] = [21, 52]
    const west: [number, number] = [20.999, 52]
    const east: [number, number] = [21.001, 52]
    const lanes: BikeLane[] = [
      {
        id: 'west',
        osmId: 'way/west',
        laneType: 'cycleway',
        tags: {},
        geometry: { type: 'LineString', coordinates: [sharedFirst, west] },
      },
      {
        id: 'east',
        osmId: 'way/east',
        laneType: 'cycleway',
        tags: {},
        geometry: { type: 'LineString', coordinates: [east, sharedLast] },
      },
    ]
    const graph = buildGraph(lanes, 0)
    const sharedKey = coordKey(sharedFirst[0], sharedFirst[1])
    const departures = [coordKey(east[0], east[1]), sharedKey]
    const [route] = runOneWay(graph, departures[0], coordKey(west[0], west[1]), 0, 1_000)

    expect(route?.segments).toHaveLength(2)
    route.segments.forEach((segment, index) => {
      const start = segment.geometry.coordinates[0]
      const node = graph.getNodeAttributes(departures[index])
      expect(approxMeters(start[0], start[1], node.lon, node.lat)).toBeLessThanOrEqual(2)
    })
  })
})
