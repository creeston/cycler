# CycleRoute

A mobile-first single-page application for building bicycle routes on real OpenStreetMap bike
lane data. The defining idea: routes that stay on dedicated cycling infrastructure, tolerating
only configurable gaps where lanes are absent.

Urban bike lanes are rarely continuous. A segregated path ends at an intersection, forces you
onto a car road for 30 metres, then resumes. Most routing apps treat all roads equally.
CycleRoute treats the presence and continuity of cycling infrastructure as a first-class routing
constraint.

Client-only: no backend, no accounts, no API keys. Map data is fetched from the Overpass API at
runtime and cached in the browser.

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Layers, module map, runtime flows, state and persistence, build pipeline |
| [docs/algorithms.md](docs/algorithms.md) | Coordinate snapping, distance functions, graph construction, gap bridging, the three routing strategies, complexity, modelling limits |
| [docs/features.md](docs/features.md) | Features, use cases, the interface, operating limits, scope boundaries |
| [docs/development.md](docs/development.md) | **Start here to contribute** — where new code goes, TS/React conventions, and the scenario-first workflow for routing algorithms |
| [backlog/](backlog/README.md) | Pending work — roadmap items, correctness, performance, test coverage |

> The backlog is worth reading before contributing. Round-trip and point-to-point routing are
> both fully implemented and tested in the domain layer, and neither is reachable from the UI.

---

## Quick start

Requires **Node.js 24** (see `.nvmrc`) and **npm 11+**.

```bash
npm ci                   # reproducible install from package-lock.json
npm run dev              # http://localhost:5173
```

Pan the map to a city, tap **Load Bike Lanes**, then **Suggest Route**.

---

## Commands

```bash
npm run dev              # dev server with HMR
npm run build            # production build to build/client
npm test                 # run the test suite once
npm run test:watch       # watch mode
npm run test:coverage    # coverage report
npm run typecheck        # react-router typegen && tsc
npm run lint             # eslint
npm run lint:fix         # eslint --fix
npm run format           # prettier --write
npm run check            # the full pre-commit gate (see below)
```

`npm run check` runs, in order: `format:check` → `lint` → `typecheck` → `test` → `build` →
`security:check`. Run it before every commit; it is the same sequence CI should run.

---

## Project layout

```
app/
├── domain/           # Pure TypeScript — entities, routing algorithms, mappers. No framework.
├── infrastructure/   # Overpass client, IndexedDB cache, GPX export
├── application/      # Use cases and Zustand stores
├── presentation/     # React components and hooks
└── integration/      # End-to-end domain tests against real OSM data
```

Dependencies point inward: `presentation → application → infrastructure → domain`. The domain
layer imports no framework, which is what makes the routing mathematics testable in isolation.
Details in [docs/architecture.md](docs/architecture.md).

---

## Testing

Tests live beside the code they cover (`*.test.ts`). Routing is verified with **declarative
fixtures** rather than hand-built graphs:

- `app/domain/routing/scenarios/geo-to-graph/` — a `.geojson` file plus an `.expected.dot`
  describing the graph it should produce.
- `app/domain/routing/scenarios/graph-to-path/` — a `.dot` file carrying both the graph and its
  assertions as graph attributes, each opening with an ASCII sketch of the network it encodes.
- `app/integration/` — a real Overpass export of Warsaw Bemowo driven through the full pipeline.

Adding a routing test usually means adding a fixture, not writing code. **Routing algorithms are
developed scenario-first**: every normal and edge case is expressed as an isolated `.dot` graph
with explicit expectations *before* the algorithm is written. The full DSL reference, the
edge-case checklist and the workflow are in
[docs/development.md §4](docs/development.md). What the fixtures currently prove is summarised in
[docs/algorithms.md §9](docs/algorithms.md).

Current state: **36 tests, all passing**, all at or below the domain layer. Coverage above that
line is [task 22](backlog/22-use-case-tests.md).

---

## Deployment

```bash
npm run deploy           # build and publish build/client to GitHub Pages
```

The app is served under the `/cycler/` base path. That value is set in **two** places and they
must stay in sync — `base` in `vite.config.ts` and `basename` in `react-router.config.ts`.

A Docker image is also committed (multi-stage `node:24-alpine` build → `nginx:stable-alpine`):

```bash
docker build -t cycleroute .
docker run -p 8080:80 cycleroute     # http://localhost:8080/cycler/
```

---

## Maintenance

### Dependencies

The repository-level `.npmrc` quarantines releases younger than three days, rejects unreviewed
install scripts, blocks git/file/URL dependency specifiers, pins exact versions, and treats
peer-dependency conflicts as errors. The committed lockfile provides the exact tree used by
`npm ci`.

When updating a dependency, review its source, maintainers, changelog, and the
`package.json` / `package-lock.json` diff before merging. Then:

```bash
npm run check                # includes npm audit for high/critical findings
npm run security:signatures  # verify signatures/provenance where the registry supports it
```

If a reviewed dependency genuinely needs an install script, approve that exact package and
version with `npm approve-scripts`; npm records the decision in the root `allowScripts` policy.
Do not bypass failures with `--force`, `--legacy-peer-deps`, or
`--dangerously-allow-all-scripts` without reviewing the resulting dependency and lockfile changes.

### External services

Both are free, unauthenticated and rate-limited. Treat them as donated infrastructure.

| Service | Used for | Constraint |
|---|---|---|
| [Overpass API](https://overpass-api.de) | Bike lane data | Volunteer-run; 429/504 are common under load. Requests are capped at a 50×50 km bbox. See [task 18](backlog/18-overpass-resilience.md). |
| [OpenFreeMap](https://openfreemap.org) | Positron base tiles | No key, no usage limit stated |

### Cached data

Fetched areas live in IndexedDB (`cycle-app`, store `areas`), keyed by bbox and expiring after
7 days. Map viewport and the current route live in `localStorage`. Clearing site data resets the
app completely; nothing is stored anywhere else.

---

## License

[MIT](LICENSE)
