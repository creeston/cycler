import { METERS_PER_DEGREE, approxMeters } from './algorithms'

/**
 * A uniform grid over a fixed set of points, for radius and nearest queries
 * in approxMeters terms. Cells are `cellMeters` tall and at least `cellMeters`
 * wide at every latitude the points span, so two points within `cellMeters`
 * of each other are never more than one cell apart.
 *
 * Cell width is sized from the point farthest from the equator: a degree of
 * longitude is shortest there, so a cell that is wide enough there is wide
 * enough everywhere in the set. That is what keeps the index correct at any
 * latitude, where the old rectangular prefilter gave up at ~70.6°
 * (docs/algorithms.md §3.4).
 */
export interface PointIndex {
  readonly lons: readonly number[]
  readonly lats: readonly number[]
  readonly cellMeters: number
  /** Cell height in degrees of latitude. */
  readonly cellLatDeg: number
  /** Cell width in degrees of longitude. */
  readonly cellLonDeg: number
  /** cos of the largest |latitude| in the set: the smallest longitude scale a pair can have. */
  readonly cosLimit: number
  readonly originLon: number
  readonly originLat: number
  readonly cols: number
  readonly rows: number
  /** Cell key (col * rows + row) to the indices of the points in that cell. Empty cells are absent. */
  readonly cells: ReadonlyMap<number, readonly number[]>
}

/**
 * Widens each cell by this much beyond its nominal size, so a pair whose
 * distance rounds to exactly the radius still lands in adjacent cells.
 */
const CELL_MARGIN = 1e-6

/** Stops the longitude scale collapsing to zero at the poles. */
const MIN_COS = 1e-12

export function buildPointIndex(
  lons: readonly number[],
  lats: readonly number[],
  cellMeters: number,
): PointIndex {
  if (cellMeters <= 0) throw new Error(`cellMeters must be positive, got ${cellMeters}`)

  let minLon = Infinity,
    maxLon = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity,
    maxAbsLat = 0
  for (let i = 0; i < lons.length; i++) {
    minLon = Math.min(minLon, lons[i])
    maxLon = Math.max(maxLon, lons[i])
    minLat = Math.min(minLat, lats[i])
    maxLat = Math.max(maxLat, lats[i])
    maxAbsLat = Math.max(maxAbsLat, Math.abs(lats[i]))
  }

  const cosLimit = Math.max(Math.cos((maxAbsLat * Math.PI) / 180), MIN_COS)
  const cellLatDeg = (cellMeters / METERS_PER_DEGREE) * (1 + CELL_MARGIN)
  const cellLonDeg = cellLatDeg / cosLimit
  const cols = lons.length === 0 ? 0 : Math.floor((maxLon - minLon) / cellLonDeg) + 1
  const rows = lons.length === 0 ? 0 : Math.floor((maxLat - minLat) / cellLatDeg) + 1

  const cells = new Map<number, number[]>()
  for (let i = 0; i < lons.length; i++) {
    const col = Math.floor((lons[i] - minLon) / cellLonDeg)
    const row = Math.floor((lats[i] - minLat) / cellLatDeg)
    const key = col * rows + row
    const cell = cells.get(key)
    if (cell) cell.push(i)
    else cells.set(key, [i])
  }

  return {
    lons,
    lats,
    cellMeters,
    cellLatDeg,
    cellLonDeg,
    cosLimit,
    originLon: minLon,
    originLat: minLat,
    cols,
    rows,
    cells,
  }
}

/**
 * Calls visit once for every unordered pair of points within maxMeters of
 * each other, with i < j. Each cell is compared with itself and with the cells
 * ahead of it within reach, so no pair is seen twice.
 */
export function forEachPairWithin(
  index: PointIndex,
  maxMeters: number,
  visit: (i: number, j: number, distanceMeters: number) => void,
): void {
  const { lons, lats, rows, cells } = index
  const reach = Math.ceil(maxMeters / index.cellMeters)

  for (const [key, cell] of cells) {
    const col = Math.floor(key / rows)
    const row = key - col * rows

    for (let a = 0; a < cell.length; a++) {
      for (let b = a + 1; b < cell.length; b++) {
        visitIfWithin(lons, lats, cell[a], cell[b], maxMeters, visit)
      }
    }

    for (let dc = 0; dc <= reach; dc++) {
      for (let dr = dc === 0 ? 1 : -reach; dr <= reach; dr++) {
        const other = cellAt(index, col + dc, row + dr)
        if (!other) continue
        for (const i of cell) {
          for (const j of other) visitIfWithin(lons, lats, i, j, maxMeters, visit)
        }
      }
    }
  }
}

/** Indices of the points within maxMeters of (lon, lat), in ascending order. */
export function pointsWithin(
  index: PointIndex,
  lon: number,
  lat: number,
  maxMeters: number,
): number[] {
  const { lons, lats } = index
  const found: number[] = []
  const col = Math.floor((lon - index.originLon) / index.cellLonDeg)
  const row = Math.floor((lat - index.originLat) / index.cellLatDeg)
  const reachCols = Math.ceil(lonReachDeg(index, lat, maxMeters) / index.cellLonDeg)
  const reachRows = Math.ceil(maxMeters / METERS_PER_DEGREE / index.cellLatDeg)

  for (let c = col - reachCols; c <= col + reachCols; c++) {
    for (let r = row - reachRows; r <= row + reachRows; r++) {
      const cell = cellAt(index, c, r)
      if (!cell) continue
      for (const i of cell) {
        if (approxMeters(lon, lat, lons[i], lats[i]) <= maxMeters) found.push(i)
      }
    }
  }

  return found.sort((a, b) => a - b)
}

/**
 * The index of the point closest to (lon, lat), or null for an empty index.
 * Ties go to the lower index. Scans square rings of cells outwards from the
 * query and stops once every unscanned cell is farther away than the best
 * point found.
 */
export function nearestPoint(
  index: PointIndex,
  lon: number,
  lat: number,
): { index: number; distanceMeters: number } | null {
  if (index.lons.length === 0) return null

  const col = Math.floor((lon - index.originLon) / index.cellLonDeg)
  const row = Math.floor((lat - index.originLat) / index.cellLatDeg)
  const lastRing = Math.max(col, index.cols - 1 - col, row, index.rows - 1 - row)
  // The shortest distance across one cell: its width where longitude is most
  // compressed, at the query or at the set's most poleward point.
  const cosAtQuery = Math.cos((Math.max(Math.abs(lat), latLimit(index)) * Math.PI) / 180)
  const minCellMeters = (index.cellLatDeg * METERS_PER_DEGREE * cosAtQuery) / index.cosLimit

  let best = -1
  let bestDistance = Infinity
  for (let ring = 0; ring <= lastRing; ring++) {
    if (bestDistance <= (ring - 1) * minCellMeters) break
    for (const cell of ringCells(index, col, row, ring)) {
      for (const i of cell) {
        const d = approxMeters(lon, lat, index.lons[i], index.lats[i])
        if (d < bestDistance || (d === bestDistance && i < best)) {
          bestDistance = d
          best = i
        }
      }
    }
  }

  return { index: best, distanceMeters: bestDistance }
}

function visitIfWithin(
  lons: readonly number[],
  lats: readonly number[],
  i: number,
  j: number,
  maxMeters: number,
  visit: (i: number, j: number, distanceMeters: number) => void,
): void {
  const d = approxMeters(lons[i], lats[i], lons[j], lats[j])
  if (d > maxMeters) return
  if (i < j) visit(i, j, d)
  else visit(j, i, d)
}

function cellAt(index: PointIndex, col: number, row: number): readonly number[] | undefined {
  if (col < 0 || col >= index.cols || row < 0 || row >= index.rows) return undefined
  return index.cells.get(col * index.rows + row)
}

/** The largest |latitude| any point in the set has. */
function latLimit(index: PointIndex): number {
  return (Math.acos(index.cosLimit) * 180) / Math.PI
}

/**
 * How far in degrees of longitude a point within maxMeters of a query at
 * `lat` can be. Uses the smallest longitude scale a pair can have, which is
 * at the query or at the set's most poleward point, whichever is farther out.
 */
function lonReachDeg(index: PointIndex, lat: number, maxMeters: number): number {
  const cos = Math.max(Math.min(index.cosLimit, Math.cos((Math.abs(lat) * Math.PI) / 180)), MIN_COS)
  return maxMeters / METERS_PER_DEGREE / cos
}

/** The non-empty cells at Chebyshev distance `ring` from (col, row), clipped to the grid. */
function* ringCells(
  index: PointIndex,
  col: number,
  row: number,
  ring: number,
): Generator<readonly number[]> {
  if (ring === 0) {
    const cell = cellAt(index, col, row)
    if (cell) yield cell
    return
  }
  const top = row - ring
  const bottom = row + ring
  const left = col - ring
  const right = col + ring
  const c0 = Math.max(left, 0)
  const c1 = Math.min(right, index.cols - 1)

  for (let c = c0; c <= c1; c++) {
    const above = cellAt(index, c, top)
    if (above) yield above
    const below = cellAt(index, c, bottom)
    if (below) yield below
  }
  for (let r = Math.max(top + 1, 0); r <= Math.min(bottom - 1, index.rows - 1); r++) {
    const before = cellAt(index, left, r)
    if (before) yield before
    const after = cellAt(index, right, r)
    if (after) yield after
  }
}
