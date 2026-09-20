import { readFileSync } from 'node:fs'
import { XmlDocument, XsdValidator } from 'libxml2-wasm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Route, RouteSegment } from '~/domain/entities/route'
import { downloadGpx, routeToGpx } from './gpx'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('routeToGpx', () => {
  it('validates against the GPX 1.1 schema', () => {
    const schema = XmlDocument.fromString(
      readFileSync('app/infrastructure/export/gpx-1.1.xsd', 'utf8'),
    )
    const validator = XsdValidator.fromDoc(schema)
    const document = XmlDocument.fromString(routeToGpx(route()))

    try {
      expect(() => validator.validate(document)).not.toThrow()
    } finally {
      document.dispose()
      validator.dispose()
      schema.dispose()
    }
  })

  it('escapes route names and produces well-formed XML', () => {
    const document = parse(routeToGpx(route(), 'A & B <test> "quoted" \'route\''))

    expect(document.querySelector('parsererror')).toBeNull()
    expect(document.querySelector('metadata > name')?.textContent).toBe(
      'A & B <test> "quoted" \'route\'',
    )
    expect(document.querySelector('trk > name')?.textContent).toBe(
      'A & B <test> "quoted" \'route\'',
    )
  })

  it('de-duplicates coordinates shared by consecutive source segments', () => {
    const document = parse(
      routeToGpx(
        route([
          segment('bike_lane', [
            [21, 52],
            [21.1, 52.1],
          ]),
          segment('bike_lane', [
            [21.1, 52.1],
            [21.2, 52.2],
          ]),
        ]),
      ),
    )

    expect(document.querySelectorAll('trkpt')).toHaveLength(3)
  })

  it('computes bounds from every route coordinate', () => {
    const document = parse(
      routeToGpx(
        route([
          segment('bike_lane', [
            [21.3, 51.9],
            [20.8, 52.4],
          ]),
          segment('gap', [
            [20.8, 52.4],
            [21.1, 52.2],
          ]),
        ]),
      ),
    )

    const bounds = document.querySelector('bounds')
    expect(bounds?.getAttribute('minlat')).toBe('51.9')
    expect(bounds?.getAttribute('minlon')).toBe('20.8')
    expect(bounds?.getAttribute('maxlat')).toBe('52.4')
    expect(bounds?.getAttribute('maxlon')).toBe('21.3')
  })

  it('uses one track segment per contiguous lane or gap run', () => {
    const document = parse(
      routeToGpx(
        route([
          segment('bike_lane', [
            [21, 52],
            [21.1, 52.1],
          ]),
          segment('bike_lane', [
            [21.1, 52.1],
            [21.2, 52.2],
          ]),
          segment('gap', [
            [21.2, 52.2],
            [21.3, 52.3],
          ]),
          segment('bike_lane', [
            [21.3, 52.3],
            [21.4, 52.4],
          ]),
        ]),
      ),
    )

    const trackSegments = [...document.querySelectorAll('trkseg')]
    expect(trackSegments).toHaveLength(3)
    expect(trackSegments.map(trackSegmentType)).toEqual(['bike_lane', 'gap', 'bike_lane'])
  })

  it('includes route metadata', () => {
    const document = parse(routeToGpx(route()))

    expect(document.documentElement.getAttribute('creator')).toBe('CycleRoute')
    expect(document.documentElement.getAttribute('version')).toBe('1.1')
    expect(document.querySelector('metadata > desc')?.textContent).toContain('14.2 km')
    expect(document.querySelector('metadata > desc')?.textContent).toContain('75%')
    expect(document.querySelector('metadata > desc')?.textContent).toContain('1 road gap')
    expect(document.querySelector('metadata > time')?.textContent).toBe('2026-09-07T12:34:56.000Z')
    expect(document.querySelector('metadata > link')?.getAttribute('href')).toBe(
      'https://creeston.github.io/cycler/',
    )
  })

  it('produces valid XML for an empty route', () => {
    const document = parse(routeToGpx(route([])))

    expect(document.querySelector('parsererror')).toBeNull()
    expect(document.querySelector('bounds')).toBeNull()
    expect(document.querySelectorAll('trkseg')).toHaveLength(0)
  })
})

describe('downloadGpx', () => {
  it('downloads through an attached anchor and cleans up on the next tick', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gpx')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.isConnected).toBe(true)
      expect(this.download).toBe('cycleroute-14.2km-2026-09-07.gpx')
    })

    downloadGpx(route())

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:gpx')
  })
})

function parse(xml: string): XMLDocument {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function trackSegmentType(element: Element): string | null {
  return (
    [...element.children].find(child => child.localName === 'extensions')?.textContent?.trim() ??
    null
  )
}

function route(
  segments: RouteSegment[] = [
    segment('bike_lane', [
      [21, 52],
      [21.1, 52.1],
    ]),
    segment('gap', [
      [21.1, 52.1],
      [21.2, 52.2],
    ]),
  ],
): Route {
  return {
    id: 'route',
    segments,
    totalDistanceMeters: 14_200,
    bikeLaneDistanceMeters: 10_650,
    bikeLaneCoverage: 0.75,
    gapCount: 1,
    gapDistanceMeters: 3_550,
    barrierCrossingCount: 0,
    barriersChecked: true,
    requestedGapMeters: 200,
    appliedGapMeters: 200,
    createdAt: new Date('2026-09-07T12:34:56.000Z'),
  }
}

function segment(type: RouteSegment['type'], coordinates: number[][]): RouteSegment {
  return {
    type,
    distanceMeters: 100,
    geometry: { type: 'LineString', coordinates },
  }
}
