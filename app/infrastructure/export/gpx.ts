import type { Route } from '~/domain/entities/route'

export function routeToGpx(route: Route, name = 'Cycle Route'): string {
  const trkpts = route.segments.flatMap(seg =>
    seg.geometry.coordinates.map(
      ([lon, lat]) => `    <trkpt lat="${lat}" lon="${lon}"></trkpt>`,
    ),
  )

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CycleApp" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts.join('\n')}
    </trkseg>
  </trk>
</gpx>`
}

export function downloadGpx(route: Route, filename = 'route.gpx'): void {
  const blob = new Blob([routeToGpx(route)], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
