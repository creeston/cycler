import { describe, it, expect } from 'vitest'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { loadScenario } from './test-utils/graph-scenario'
import { runWalks } from './route-finder'
import type { Route } from '../entities/route'
import type { ScenarioExpect } from './test-utils/graph-scenario'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scenario = (name: string) => join(__dirname, 'scenarios', 'graph-to-path', name)

function check(routes: Route[], ex: ScenarioExpect) {
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
}

describe('graph routing scenarios', () => {
  it('simple-chain: finds routes on a straight connected chain', () => {
    const sc = loadScenario(scenario('simple-chain.dot'))
    check(runWalks(sc.graph, sc.startKey, sc.minDist, sc.maxDist), sc.expect)
  })

  it('gap-bridging: traverses a gap edge when it is the only way forward', () => {
    const sc = loadScenario(scenario('gap-bridging.dot'))
    check(runWalks(sc.graph, sc.startKey, sc.minDist, sc.maxDist), sc.expect)
  })

  it('dead-end: retries until the valid long path is found', () => {
    const sc = loadScenario(scenario('dead-end.dot'))
    check(runWalks(sc.graph, sc.startKey, sc.minDist, sc.maxDist), sc.expect)
  })

  it('branching: discovers routes through both forks', () => {
    const sc = loadScenario(scenario('branching.dot'))
    check(runWalks(sc.graph, sc.startKey, sc.minDist, sc.maxDist), sc.expect)
  })

  it('isolated-lanes: returns no routes when all segments are too short', () => {
    const sc = loadScenario(scenario('isolated-lanes.dot'))
    check(runWalks(sc.graph, sc.startKey, sc.minDist, sc.maxDist), sc.expect)
  })
})
