import { haversineMeters } from './algorithms'
import type { BikeLaneGraph } from './graph'

/** Binary min-heap of node keys ordered by a numeric priority. */
class MinHeap {
  private readonly keys: string[] = []
  private readonly priorities: number[] = []

  get size(): number {
    return this.keys.length
  }

  push(key: string, priority: number): void {
    this.keys.push(key)
    this.priorities.push(priority)
    let i = this.keys.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.priorities[parent] <= this.priorities[i]) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): string | undefined {
    if (this.keys.length === 0) return undefined
    const top = this.keys[0]
    const lastKey = this.keys.pop()!
    const lastPriority = this.priorities.pop()!
    if (this.keys.length > 0) {
      this.keys[0] = lastKey
      this.priorities[0] = lastPriority
      this.siftDown(0)
    }
    return top
  }

  private siftDown(start: number): void {
    let i = start
    const n = this.keys.length
    while (true) {
      const left = 2 * i + 1
      const right = left + 1
      let smallest = i
      if (left < n && this.priorities[left] < this.priorities[smallest]) smallest = left
      if (right < n && this.priorities[right] < this.priorities[smallest]) smallest = right
      if (smallest === i) return
      this.swap(i, smallest)
      i = smallest
    }
  }

  private swap(a: number, b: number): void {
    ;[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]
    ;[this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]]
  }
}

export interface SearchOptions {
  /**
   * A lower bound on the cost still to pay from a node to the goal. Omitted,
   * the search is Dijkstra. It must never overestimate, or the path found may
   * not be the cheapest.
   */
  heuristic?: (nodeKey: string) => number
  /** Multiplies an edge's cost, so a caller can make some edges dearer for one search. */
  edgeCostFactor?: (edgeKey: string) => number
}

export interface SearchResult {
  /** Node keys from start to goal, or null when the goal is unreachable. */
  path: string[] | null
  /** Nodes settled before the goal was reached — how much of the graph the search had to look at. */
  expanded: number
}

/**
 * The heuristic the app uses: the great-circle distance to the goal. Every
 * edge costs at least its length and every length is at least the straight
 * line between its ends, so this never overestimates. It is the *lane*
 * multiplier of 1 that makes it safe; scaling it by the gap penalty would
 * guide the search harder but could skip a cheaper all-lane path.
 */
export function haversineTo(graph: BikeLaneGraph, goalKey: string): (nodeKey: string) => number {
  const goal = graph.getNodeAttributes(goalKey)
  return nodeKey => {
    const node = graph.getNodeAttributes(nodeKey)
    return haversineMeters(node.lon, node.lat, goal.lon, goal.lat)
  }
}

/**
 * A* over costMeters from startKey to goalKey. With the default zero
 * heuristic it is Dijkstra, which is what the expansion count is compared
 * against. The heuristic is consistent for haversineTo, so a node is final
 * the first time it is popped and never reopened.
 */
export function astar(
  graph: BikeLaneGraph,
  startKey: string,
  goalKey: string,
  options: SearchOptions = {},
): SearchResult {
  const heuristic = options.heuristic ?? (() => 0)
  const factor = options.edgeCostFactor ?? (() => 1)
  const cost = new Map<string, number>([[startKey, 0]])
  const parent = new Map<string, string>()
  const settled = new Set<string>()
  const open = new MinHeap()
  open.push(startKey, heuristic(startKey))
  let expanded = 0

  while (open.size > 0) {
    const current = open.pop()!
    if (settled.has(current)) continue
    if (current === goalKey) return { path: unwind(parent, startKey, goalKey), expanded }
    settled.add(current)
    expanded++

    const currentCost = cost.get(current)!
    graph.forEachEdge(current, (edgeKey, attrs, source, target) => {
      const next = source === current ? target : source
      if (settled.has(next)) return
      const nextCost = currentCost + attrs.costMeters * factor(edgeKey)
      const known = cost.get(next)
      if (known !== undefined && known <= nextCost) return
      cost.set(next, nextCost)
      parent.set(next, current)
      open.push(next, nextCost + heuristic(next))
    })
  }

  return { path: null, expanded }
}

function unwind(parent: Map<string, string>, startKey: string, goalKey: string): string[] {
  const path = [goalKey]
  let current = goalKey
  while (current !== startKey) {
    current = parent.get(current)!
    path.push(current)
  }
  return path.reverse()
}

export interface TreeNode {
  parent: string | null
  costMeters: number
  distanceMeters: number
  /** Flagged gaps on the path from the root to this node. */
  barrierCrossings: number
}

/**
 * Cheapest paths from startKey to every node reachable within
 * maxDistanceMeters of real length, as a parent map. Dijkstra over
 * costMeters; an edge is not relaxed when it would carry the path past the
 * distance bound, so a node is reached by the cheapest path among those that
 * stay within the bound at every step.
 */
export function shortestPathTree(
  graph: BikeLaneGraph,
  startKey: string,
  maxDistanceMeters: number,
): Map<string, TreeNode> {
  const tree = new Map<string, TreeNode>([
    [startKey, { parent: null, costMeters: 0, distanceMeters: 0, barrierCrossings: 0 }],
  ])
  const settled = new Set<string>()
  const open = new MinHeap()
  open.push(startKey, 0)

  while (open.size > 0) {
    const current = open.pop()!
    if (settled.has(current)) continue
    settled.add(current)
    const node = tree.get(current)!

    graph.forEachEdge(current, (_edgeKey, attrs, source, target) => {
      const next = source === current ? target : source
      if (settled.has(next)) return
      const distanceMeters = node.distanceMeters + attrs.distanceMeters
      if (distanceMeters > maxDistanceMeters) return
      const costMeters = node.costMeters + attrs.costMeters
      const known = tree.get(next)
      if (known && known.costMeters <= costMeters) return
      tree.set(next, {
        parent: current,
        costMeters,
        distanceMeters,
        barrierCrossings: node.barrierCrossings + (attrs.barrier ? 1 : 0),
      })
      open.push(next, costMeters)
    })
  }

  return tree
}

/** Node keys from the tree's root to nodeKey. */
export function treePath(tree: Map<string, TreeNode>, nodeKey: string): string[] {
  const path = [nodeKey]
  let current = tree.get(nodeKey)
  while (current?.parent != null) {
    path.push(current.parent)
    current = tree.get(current.parent)
  }
  return path.reverse()
}
