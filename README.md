# CycleRoute

A mobile-first single-page application for building bicycle routes based on real OpenStreetMap bike lane data. The defining feature: routes that stay on dedicated cycling infrastructure, tolerating only configurable gaps where lanes are absent.

---

## Premise

Urban bike lanes are rarely continuous. A segregated path often ends at an intersection, forces the cyclist onto a car road for 30 metres, then resumes. Most routing apps treat all roads equally. CycleRoute treats the presence and continuity of cycling infrastructure as a first-class routing constraint: you set the maximum gap you'll tolerate, and the app builds a route that respects it.

---

## Features

- **Bike-lane-first routing** — routes maximise time on dedicated cycling infrastructure (cycleways, tracks, designated paths). A gap tolerance slider controls how much on-road riding is acceptable between two lane segments.
- **OSM data on demand** — pan to any city, fetch its bike lane network from the live OpenStreetMap Overpass API with one tap.
- **Offline caching** — fetched areas are stored in IndexedDB and reused across sessions. Data expires after 7 days; manual refresh is available.
- **Route metrics** — total distance, bike-lane coverage percentage, gap count.
- **GPX export** — download the route for any GPS device or app (Komoot, Garmin, etc.).
- **Minimalistic map** — grey/white vector base map (OpenFreeMap Positron), orange lane overlay (#FC4C02), brighter orange route line.

---

## Architecture

The project follows a **simplified Clean Architecture** suited to a front-end-only SPA. Three explicit layers prevent business logic from leaking into React components and keep the routing algorithms fully testable in isolation.

```
app/
├── domain/              # Pure TypeScript — zero framework dependencies
│   ├── entities/        # BikeLane, Route, RoutePreferences, CachedArea
│   ├── routing/         # Graph building, routing algorithms (Dijkstra/A*)
│   └── mappers/         # GeoJSON <-> domain entity converters
│
├── infrastructure/      # Side effects & external systems
│   ├── osm/             # Overpass API client, QL query builders
│   ├── cache/           # IndexedDB via `idb`
│   └── export/          # GPX serialiser
│
├── application/         # Orchestration
│   ├── use-cases/       # FetchBikeLanes, BuildRoute
│   └── stores/          # Zustand stores (MapStore, RoutingStore)
│
└── presentation/        # React — reads stores, dispatches use-cases
    ├── components/
    │   ├── map/         # MapLibre GL layers (bike lanes, route)
    │   ├── layout/      # BottomSheet (mobile panel)
    │   └── ui/          # Primitive components (Button, etc.)
    └── hooks/           # useBikeLanes, useRoute — bridge stores to components
```

**Why not full onion/hexagonal?** The domain is rich enough to warrant isolation (graph algorithms, lane type resolution, gap stitching) but the app has no backend. A strict port/adapter structure would add indirection with no payoff.

---

## Technology Decisions

| Challenge | Package | Rationale |
|---|---|---|
| OSM data | Overpass API + `osmtogeojson` | CORS-friendly, no key required, best coverage |
| Map rendering | `maplibre-gl` + `react-map-gl` | GPU-accelerated, open-source Mapbox GL fork, handles large GeoJSON overlays |
| Map tiles | OpenFreeMap Positron | Free, no API key, clean minimalistic style |
| Geospatial ops | `@turf/turf` | Canonical JS geospatial toolkit (distance, length, bbox) |
| Graph / routing | `graphology` + `graphology-shortest-path` | Typed graph library; Dijkstra/bidirectional A* built-in |
| State management | `zustand` | Minimal boilerplate, slice-friendly, no context nesting |
| Persistence | `idb` (IndexedDB) | Fully client-side, stores large GeoJSON blobs offline |
| UI | Tailwind CSS v4 + Radix primitives | No runtime overhead, full component ownership |
| Icons | `lucide-react` | Lightweight, consistent, tree-shakeable |
| Testing | `vitest` | Native Vite integration, same API as Jest |

---

## Routing Algorithm

### Current (dummy)
A random walk through available bike lane segments until the target distance is reached. Used to validate the full data pipeline end-to-end.

### Planned
1. **Graph construction** — nodes are lane endpoints snapped to a ~1 m coordinate grid; edges are lane segments weighted by length. Two nodes within `maxGapMeters` of each other are bridged by a synthetic gap edge.
2. **A\* routing** — bidirectional A\* with Haversine heuristic finds the shortest path from a random start to an endpoint at approximately the target distance.
3. **Gap tolerance** — gap edges carry a heavy penalty proportional to gap length. Setting `maxGapMeters = 0` excludes them entirely.

---

## Testing Strategy

Tests live next to the code they test (`*.test.ts`). Goal: confidence in domain logic, not coverage metrics.

- **Domain layer** — unit tests for OSM tag resolution, routing helpers (adjacency building, algorithm contract). Pure functions, no mocking.
- **Use cases** — integration tests with in-memory fakes for the Overpass client and IndexedDB. (Planned)
- **Presentation** — no component tests initially; behaviour is covered by domain tests. Add when the UI stabilises.

```bash
npm test                 # run once
npm run test:watch       # watch mode
npm run test:coverage    # with coverage report
```

---

## Development

```bash
npm install
npm run dev              # http://localhost:5173
npm run typecheck
npm run lint
npm run format
npm test
```

## Deployment

```
npm run deploy           # build and deploy to GitHub Pages
```

---

## Roadmap

- [ ] Real A\* routing with gap-stitching
- [ ] Gap tolerance slider in the UI
- [ ] Round-trip route generation
- [ ] Route preferences (distance range, surface type)
- [ ] Geocoder address search (Nominatim)
- [ ] Saved routes list (local)
