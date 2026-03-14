import type { BoundingBox } from '~/domain/entities/area'

/**
 * Builds an Overpass QL query that fetches all recognised bicycle
 * infrastructure within the given bounding box.
 */
export function buildBikeLaneQuery(bbox: BoundingBox): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `
[out:json][timeout:30][bbox:${b}];
(
  way["highway"="cycleway"];
  way["cycleway"~"^(lane|track|shared_lane|opposite_lane|opposite_track)$"];
  way["cycleway:left"~"^(lane|track)$"];
  way["cycleway:right"~"^(lane|track)$"];
  way["bicycle"="designated"]["highway"~"^(path|track|footway)$"];
);
out geom;
`.trim()
}
