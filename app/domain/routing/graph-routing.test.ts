import { describe, it, expect } from 'vitest'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { loadScenario } from './test-utils/graph-scenario'
import { runWalks, runOneWay } from './route-finder'
import { coordKey } from './algorithms'
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

function runScenario(sc: Scenario): Route[] {
  if (sc.endKey) {
    return runOneWay(sc.graph, sc.startKey, sc.endKey, sc.minDist, sc.maxDist)
  }
  return runWalks(sc.graph, sc.startKey, sc.minDist, sc.maxDist, sc.roundTrip)
}

function check(routes: Route[], ex: ScenarioExpect, keyToName: Map<string, string>) {
  if (ex.minRoutes !== undefined)
    expect(routes.length).toBeGreaterThanOrEqual(ex.minRoutes)

  if (ex.maxRoutes !== undefined)
    expect(routes.length).toBeLessThanOrEqual(ex.maxRoutes)

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
    check(runScenario(sc), sc.expect, sc.keyToName)
  })

  it('gap-bridging: finds exact route A,B,C,D,E,F traversing the gap edge', () => {
    const sc = loadScenario(scenario('gap-bridging.dot'))
    check(runScenario(sc), sc.expect, sc.keyToName)
  })

  it('dead-end: finds exact route A,B,C,E,F bypassing the dead-end branch', () => {
    const sc = loadScenario(scenario('dead-end.dot'))
    check(runScenario(sc), sc.expect, sc.keyToName)
  })

  it('branching: discovers both routes A,B,C,E and A,B,D,F through the fork', () => {
    const sc = loadScenario(scenario('branching.dot'))
    check(runScenario(sc), sc.expect, sc.keyToName)
  })

  it('isolated-lanes: returns no routes when all segments are too short', () => {
    const sc = loadScenario(scenario('isolated-lanes.dot'))
    check(runScenario(sc), sc.expect, sc.keyToName)
  })

  it('round-trip: finds a circular route returning to start without repeating edges', () => {
    const sc = loadScenario(scenario('round-trip.dot'))
    check(runScenario(sc), sc.expect, sc.keyToName)
  })

  it('one-way-chain: finds the single route A→E on a straight chain', () => {
    const sc = loadScenario(scenario('one-way-chain.dot'))
    check(runScenario(sc), sc.expect, sc.keyToName)
  })

  it('one-way-branching: finds shortest path A→E through a fork (either branch)', () => {
    const sc = loadScenario(scenario('one-way-branching.dot'))
    check(runScenario(sc), sc.expect, sc.keyToName)
  })
})
