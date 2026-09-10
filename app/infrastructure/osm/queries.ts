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

/**
 * Builds an Overpass QL query for the things a rider cannot cross wherever
 * they like, plus the places where they can cross them after all.
 *
 * Deliberately not "all roads": this data answers whether a straight-line gap
 * is plausible, never how to ride it. On the Warsaw Bemowo test area it
 * returns about 1 800 elements against 310 bike lanes.
 */
export function buildBarrierQuery(bbox: BoundingBox): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `
[out:json][timeout:60][bbox:${b}];
(
  way["highway"~"^(motorway|trunk|primary|secondary)$"];
  way["railway"~"^(rail|light_rail|subway)$"];
  way["waterway"~"^(river|canal)$"];
  way["natural"="water"];
  way["bridge"]["bridge"!="no"];
  way["tunnel"]["tunnel"!="no"];
  node["highway"="crossing"];
  node["railway"="level_crossing"];
);
out geom;
`.trim()
}
