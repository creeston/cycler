/**
 * Builds a graph-node key from a coordinate pair, snapped to ~1 m grid.
 * Shared by graph.ts and tests.
 */
export function coordKey(lon: number, lat: number): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`
}
