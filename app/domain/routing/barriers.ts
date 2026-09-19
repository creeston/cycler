import type { Position } from 'geojson'
import type { Barrier, BarrierData, BarrierKind, Crossing } from '../entities/barrier'
import { approxMeters } from './algorithms'

/**
 * A gap is exempt when a crossing lies this close to the point where it meets
 * the barrier. Wide enough to cover a crossing node mapped a few metres off
 * the kerb line, narrow enough that the next crossing down the road does not
 * excuse this one.
 */
export const CROSSING_TOLERANCE_METERS = 20

/**
 * How close a crossing must come to the barrier itself to be a way across it.
 * A crossing node is mapped as a node of the road it crosses, and a bridge way
 * meets the barrier it spans, so this only has to absorb rounding — without
 * it, a crossing on the side street 15 m away would excuse a gap over the
 * arterial next to it.
 */
const CROSSING_ON_BARRIER_METERS = 5

/**
 * Index cell size in degrees. At 52° N a cell is about 220 m tall, so a gap of
 * the default 200 m tolerance touches at most a handful of cells.
 */
const CELL_DEGREES = 0.002

interface Segment {
  ax: number
  ay: number
  bx: number
  by: number
}

interface BarrierSegment extends Segment {
  kind: BarrierKind
}

export interface BarrierIndex {
  barrierCells: Map<string, BarrierSegment[]>
  crossingCells: Map<string, Segment[]>
  barrierCount: number
  crossingCount: number
}

/**
 * Buckets barrier and crossing geometry into a uniform grid so a candidate gap
 * is only tested against the segments near it. Segments span cells, so this
 * stays separate from the point index in spatial-index.ts.
 */
export function buildBarrierIndex(data: BarrierData): BarrierIndex {
  const barrierCells = new Map<string, BarrierSegment[]>()
  const crossingCells = new Map<string, Segment[]>()

  for (const barrier of data.barriers) {
    for (const segment of barrierSegments(barrier)) {
      insertSegment(barrierCells, segment)
    }
  }

  for (const crossing of data.crossings) {
    for (const segment of crossingSegments(crossing)) {
      insertSegment(crossingCells, segment)
    }
  }

  return {
    barrierCells,
    crossingCells,
    barrierCount: data.barriers.length,
    crossingCount: data.crossings.length,
  }
}

/**
 * The kind of barrier a straight gap from (ax, ay) to (bx, by) crosses away
 * from any crossing, or null when the line is clear. Returns the first
 * unexcused intersection found, so a gap that crosses both a railway and a
 * road reports one of them.
 */
export function findBlockingBarrier(
  index: BarrierIndex,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): BarrierKind | null {
  const gap: Segment = { ax, ay, bx, by }

  for (const cellKey of cellsCovering(gap)) {
    const segments = index.barrierCells.get(cellKey)
    if (!segments) continue

    for (const segment of segments) {
      const hit = segmentIntersection(gap, segment)
      if (!hit) continue
      if (isCrossable(index, hit[0], hit[1], segment)) continue
      return segment.kind
    }
  }

  return null
}

/** Whether a crossing lets a rider over the barrier at (lon, lat). */
function isCrossable(
  index: BarrierIndex,
  lon: number,
  lat: number,
  barrier: BarrierSegment,
): boolean {
  // A box around the point rather than the point itself, so a crossing filed
  // in the neighbouring cell is still found.
  const reach = CROSSING_TOLERANCE_METERS / 111_000
  const reachBox: Segment = { ax: lon - reach, ay: lat - reach, bx: lon + reach, by: lat + reach }

  for (const cellKey of cellsCovering(reachBox)) {
    const segments = index.crossingCells.get(cellKey)
    if (!segments) continue

    for (const segment of segments) {
      if (pointToSegmentMeters(lon, lat, segment) > CROSSING_TOLERANCE_METERS) continue
      if (segmentToSegmentMeters(segment, barrier) > CROSSING_ON_BARRIER_METERS) continue
      return true
    }
  }

  return false
}

function barrierSegments(barrier: Barrier): BarrierSegment[] {
  const segments: BarrierSegment[] = []

  for (const line of geometryLines(barrier.geometry)) {
    for (let i = 0; i < line.length - 1; i++) {
      segments.push({
        ax: line[i][0],
        ay: line[i][1],
        bx: line[i + 1][0],
        by: line[i + 1][1],
        kind: barrier.kind,
      })
    }
  }

  return segments
}

function crossingSegments(crossing: Crossing): Segment[] {
  if (crossing.geometry.type === 'Point') {
    const [x, y] = crossing.geometry.coordinates
    return [{ ax: x, ay: y, bx: x, by: y }]
  }

  const line = crossing.geometry.coordinates
  const segments: Segment[] = []
  for (let i = 0; i < line.length - 1; i++) {
    segments.push({ ax: line[i][0], ay: line[i][1], bx: line[i + 1][0], by: line[i + 1][1] })
  }
  return segments
}

function geometryLines(geometry: Barrier['geometry']): Position[][] {
  if (geometry.type === 'LineString') return [geometry.coordinates]
  if (geometry.type === 'Polygon') return geometry.coordinates
  return geometry.coordinates.flat()
}

function insertSegment<T extends Segment>(cells: Map<string, T[]>, segment: T): void {
  for (const cellKey of cellsCovering(segment)) {
    const bucket = cells.get(cellKey)
    if (bucket) bucket.push(segment)
    else cells.set(cellKey, [segment])
  }
}

/** Keys of every grid cell the segment's bounding box touches. */
function cellsCovering(segment: Segment): string[] {
  const minX = Math.floor(Math.min(segment.ax, segment.bx) / CELL_DEGREES)
  const maxX = Math.floor(Math.max(segment.ax, segment.bx) / CELL_DEGREES)
  const minY = Math.floor(Math.min(segment.ay, segment.by) / CELL_DEGREES)
  const maxY = Math.floor(Math.max(segment.ay, segment.by) / CELL_DEGREES)

  const keys: string[] = []
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) keys.push(`${x},${y}`)
  }
  return keys
}

/**
 * Where two segments cross, in degrees, or null when they do not.
 *
 * Degrees rather than metres: the two segments are metres apart, so the
 * longitude compression that the equirectangular projection corrects for is
 * identical on both and cancels out of the ratios below.
 */
function segmentIntersection(first: Segment, second: Segment): [number, number] | null {
  const r = { x: first.bx - first.ax, y: first.by - first.ay }
  const s = { x: second.bx - second.ax, y: second.by - second.ay }
  const denominator = r.x * s.y - r.y * s.x
  if (denominator === 0) return null

  const dx = second.ax - first.ax
  const dy = second.ay - first.ay
  const t = (dx * s.y - dy * s.x) / denominator
  const u = (dx * r.y - dy * r.x) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return null

  return [first.ax + t * r.x, first.ay + t * r.y]
}

/** Distance between two segments: zero when they cross, else the closest pair of ends. */
function segmentToSegmentMeters(first: Segment, second: Segment): number {
  if (segmentIntersection(first, second)) return 0
  return Math.min(
    pointToSegmentMeters(first.ax, first.ay, second),
    pointToSegmentMeters(first.bx, first.by, second),
    pointToSegmentMeters(second.ax, second.ay, first),
    pointToSegmentMeters(second.bx, second.by, first),
  )
}

/**
 * Distance from a point to a segment. The projection runs in a local metric
 * frame — longitude scaled by cos(latitude) — because a degree of longitude is
 * shorter than a degree of latitude, and projecting in raw degrees would put
 * the closest point in the wrong place.
 */
function pointToSegmentMeters(lon: number, lat: number, segment: Segment): number {
  const scale = Math.cos((lat * Math.PI) / 180)
  const dx = (segment.bx - segment.ax) * scale
  const dy = segment.by - segment.ay
  const lengthSq = dx * dx + dy * dy

  if (lengthSq === 0) return approxMeters(lon, lat, segment.ax, segment.ay)

  const t = ((lon - segment.ax) * scale * dx + (lat - segment.ay) * dy) / lengthSq
  const clamped = Math.max(0, Math.min(1, t))
  const closestLon = segment.ax + clamped * (segment.bx - segment.ax)
  const closestLat = segment.ay + clamped * (segment.by - segment.ay)
  return approxMeters(lon, lat, closestLon, closestLat)
}
