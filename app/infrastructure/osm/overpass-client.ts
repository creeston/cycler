import osmtogeojson from 'osmtogeojson'
import type { FeatureCollection } from 'geojson'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export class OverpassError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'OverpassError'
  }
}

export async function fetchOverpassGeoJSON(query: string): Promise<FeatureCollection> {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })

  if (!response.ok) {
    throw new OverpassError(response.status, `Overpass API returned ${response.status}`)
  }

  const osmData = await response.json()
  return osmtogeojson(osmData) as FeatureCollection
}
