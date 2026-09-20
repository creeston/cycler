import type { Position } from 'geojson'
import type { Route, RouteSegment, SegmentType } from '~/domain/entities/route'

const APP_NAME = 'CycleRoute'
const APP_URL = 'https://creeston.github.io/cycler/'
const EXTENSION_NAMESPACE = `${APP_URL}gpx/extensions/1`

interface SegmentRun {
  type: SegmentType
  coordinates: Position[]
}

export function routeToGpx(route: Route, name = 'Cycle Route'): string {
  const escapedName = escapeXml(name)
  const runs = contiguousRuns(route.segments)
  const bounds = routeBounds(route.segments)
  const metadataDescription = escapeXml(routeDescription(route))
  const segmentTypes = runs.map(run => segmentTypeLabel(run.type)).join(', ')
  const trackDescription = escapeXml(
    segmentTypes ? `Contiguous segment types: ${segmentTypes}.` : 'Route has no track segments.',
  )
  const boundsXml = bounds
    ? `
    <bounds minlat="${escapeXml(bounds.minLat)}" minlon="${escapeXml(bounds.minLon)}" maxlat="${escapeXml(bounds.maxLat)}" maxlon="${escapeXml(bounds.maxLon)}" />`
    : ''
  const trackSegments = runs.map(runToGpx).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${APP_NAME}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:cycleroute="${escapeXml(EXTENSION_NAMESPACE)}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 https://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapedName}</name>
    <desc>${metadataDescription}</desc>
    <link href="${escapeXml(APP_URL)}">
      <text>${APP_NAME}</text>
    </link>
    <time>${escapeXml(route.createdAt.toISOString())}</time>${boundsXml}
  </metadata>
  <trk>
    <name>${escapedName}</name>
    <desc>${trackDescription}</desc>${trackSegments ? `\n${trackSegments}` : ''}
  </trk>
</gpx>`
}

export function downloadGpx(
  route: Route,
  filename = routeFilename(route),
  name = 'Cycle Route',
): void {
  const blob = new Blob([routeToGpx(route, name)], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)

  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function escapeXml(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function contiguousRuns(segments: RouteSegment[]): SegmentRun[] {
  const runs: SegmentRun[] = []

  for (const segment of segments) {
    let run = runs[runs.length - 1]
    if (!run || run.type !== segment.type) {
      run = { type: segment.type, coordinates: [] }
      runs.push(run)
    }

    appendDistinct(run.coordinates, segment.geometry.coordinates)
  }

  return runs
}

function appendDistinct(target: Position[], coordinates: Position[]): void {
  for (const coordinate of coordinates) {
    const previous = target[target.length - 1]
    if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) {
      target.push(coordinate)
    }
  }
}

function runToGpx(run: SegmentRun): string {
  const trackPoints = run.coordinates
    .map(([lon, lat]) => `      <trkpt lat="${escapeXml(lat)}" lon="${escapeXml(lon)}"></trkpt>`)
    .join('\n')
  const pointBlock = trackPoints ? `${trackPoints}\n` : ''

  return `    <trkseg>
${pointBlock}      <extensions>
        <cycleroute:type>${escapeXml(run.type)}</cycleroute:type>
      </extensions>
    </trkseg>`
}

function routeBounds(segments: RouteSegment[]): {
  minLat: number
  minLon: number
  maxLat: number
  maxLon: number
} | null {
  let minLat = Infinity
  let minLon = Infinity
  let maxLat = -Infinity
  let maxLon = -Infinity

  for (const segment of segments) {
    for (const [lon, lat] of segment.geometry.coordinates) {
      minLat = Math.min(minLat, lat)
      minLon = Math.min(minLon, lon)
      maxLat = Math.max(maxLat, lat)
      maxLon = Math.max(maxLon, lon)
    }
  }

  return Number.isFinite(minLat) ? { minLat, minLon, maxLat, maxLon } : null
}

function routeDescription(route: Route): string {
  const distance = formatKilometers(route.totalDistanceMeters)
  const coverage = Math.round(route.bikeLaneCoverage * 100)
  const gapLabel = route.gapCount === 1 ? 'road gap' : 'road gaps'
  return `${distance} route with ${coverage}% bike-lane coverage and ${route.gapCount} ${gapLabel}.`
}

function segmentTypeLabel(type: SegmentType): string {
  return type === 'bike_lane' ? 'bike lane' : 'road gap'
}

function formatKilometers(distanceMeters: number): string {
  const kilometers = (distanceMeters / 1_000).toFixed(1).replace(/\.0$/, '')
  return `${kilometers} km`
}

function routeFilename(route: Route): string {
  const distance = (route.totalDistanceMeters / 1_000).toFixed(1)
  const date = route.createdAt.toISOString().slice(0, 10)
  return `cycleroute-${distance}km-${date}.gpx`
}
