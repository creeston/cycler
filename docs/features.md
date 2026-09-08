# Features & use cases

What CycleRoute does today, from the outside in — the screens, the flows, and the honest
boundary between what ships and what only exists in the domain layer.

Companion documents: [Architecture](architecture.md) · [Algorithms](algorithms.md) ·
[Development guidelines](development.md) · [Backlog](../backlog/README.md)

---

## 1. The problem

Urban cycling infrastructure is discontinuous. A protected path ends at an intersection, dumps
you onto a car road for 30 metres, then resumes on the other side. General-purpose routers treat
every road as equivalent and optimise for time; dedicated cycling routers optimise for
"bikeability" as a single blended score.

CycleRoute takes a narrower position: **the presence and continuity of cycling infrastructure is
the routing constraint, not a tiebreaker.** You declare how much on-road riding you will accept
between two lane segments, and the router works within that budget.

> **State of the premise.** The data model expresses this correctly — every route segment is
> typed `bike_lane` or `gap`, and every route reports its coverage ratio and gap count. The graph
> does not. Measured on the Warsaw fixture at the default tolerance, 88 % of routing edges are
> synthetic straight lines between lane endpoints, nothing checks what those lines cross, and
> gap edges are priced at plain length — so `bikeLaneCoverage` treats unverified terrain as
> ordinary connective tissue. Closing the loop takes three tasks in order:
> [`27`](../backlog/27-gap-over-generation.md) prunes the ~98 % of gap edges that carry no
> connectivity, [`28`](../backlog/28-barrier-veto.md) vetoes those crossing arterials, railways
> or water, and [`01`](../backlog/01-gap-penalty-and-tolerance.md) prices what survives. Until
> then the coverage figure is a lane-maximisation score, not a safety claim.

---

## 2. Target user

One persona, deliberately:

> A city cyclist with a phone, standing somewhere in their own city, who wants a 10–30 km ride
> on bike paths this afternoon and will load it into Komoot or a Garmin before setting off.

Everything follows from that: mobile-first layout, no account, no server, geolocation as the
default start point, GPX as the exit route, and a bottom sheet you can work one-handed.

---

## 3. Feature status

| Feature | Status | Where it lives |
|---|---|---|
| Fetch bike lanes for the visible map area | **Shipped** | `fetchBikeLanes`, `useBikeLanes` |
| Render the lane network as an orange overlay | **Shipped** | `BikeLaneLayer` |
| Offline reuse of previously fetched areas | **Shipped** (partial — see §6.6) | `area-cache`, IndexedDB |
| Suggest an exploratory route from your location | **Shipped** | `exploreStrategy` |
| Cycle through alternative routes | **Shipped** | route batch cache in `buildRoute` |
| Route metrics: distance, bike-lane coverage | **Shipped** | `BottomSheet` |
| Route metric: gap count | Computed, **not displayed** | [`25`](../backlog/25-gap-count-metric-ui.md) |
| GPX export | **Shipped** (minimal) | `downloadGpx` · [`20`](../backlog/20-gpx-hardening.md) |
| Geolocation marker and fly-to | **Shipped** | `CycleMap` |
| Viewport restored between sessions | **Shipped** | `map-store` persist |
| Round-trip (loop) routing | **Shipped** | `roundTripStrategy`, `BottomSheet` |
| Point-to-point routing to a destination | **Domain only — unreachable** | `oneWayStrategy` · [`06`](../backlog/06-destination-picker.md) |
| Gap tolerance control | **Shipped** — persisted 0–500 m slider | `BottomSheet` |
| Distance range control | **Not started** — fixed at 10–30 km | [`05`](../backlog/05-route-preferences-ui.md) |
| Surface preference | **Not started** — `surface` parsed, never used | [`05`](../backlog/05-route-preferences-ui.md) |
| Address search (geocoding) | **Not started** | [`07`](../backlog/07-nominatim-geocoder.md) |
| Saved routes | **Not started** — one route persisted, no list | [`08`](../backlog/08-saved-routes.md) |
| Turn-by-turn navigation | **Out of scope** | — |
| Elevation profile | **Out of scope** | — |

Point-to-point routing remains implemented and covered by passing domain tests, but cannot be
triggered from the running app because no UI exposes a destination.

---

## 4. The interface

A single screen: a full-bleed map with MapLibre's zoom and locate controls top-right, and a
bottom sheet that collapses to a 56 px strip. The sheet holds the app title and lane count, the
action buttons, the route metrics panel, and an error banner when something fails.

Controls, in full — this is the entire interactive surface of the application:

| Control | Enabled when | Effect |
|---|---|---|
| Drag handle | always | Collapses the sheet to a 56 px strip |
| **Load Bike Lanes** | not loading, bbox ≤ 50×50 km | Queries Overpass for the visible area |
| **Suggest Route** | lanes loaded, no current route | Builds and displays a route |
| **New Route** | a route exists | Serves the next candidate from the batch |
| **Export GPX** | a route exists | Downloads `route.gpx` |
| **✕** | a route exists | Clears the route |
| Explore / Loop | always | Selects exploratory or closed-loop routing |
| Gap tolerance | always | Sets the persisted maximum gap from 0–500 m |
| Zoom in / out | always | MapLibre `NavigationControl` |
| Locate | always | MapLibre `GeolocateControl`, `maxZoom: 15` |
| Pan / pinch | always | Updates viewport and bbox; rotation and pitch are disabled |

Design language: OpenFreeMap Positron as a deliberately desaturated base so the network reads at
a glance; lanes in `#f86324` with a white casing at 85 % opacity, dropping to 30 % once a route
is drawn; the active route in `#FF5400` at full opacity with a heavier casing. Gap connectors are
rendered with `line-opacity: 0` — the layer exists, styled and filtered, waiting for a toggle
([`25`](../backlog/25-gap-count-metric-ui.md)).

---

## 5. Primary journey

```mermaid
journey
    title First ride, from cold start to GPX
    section Arrive
      Open the app: 4: Cyclist
      Grant location, map flies to me: 4: Cyclist
    section Get data
      Pan or zoom to frame the ride area: 3: Cyclist
      Tap Load Bike Lanes: 5: Cyclist
      Wait for Overpass: 2: Cyclist
      See the orange network: 5: Cyclist
    section Get a route
      Tap Suggest Route: 5: Cyclist
      Wait for the graph to build: 2: Cyclist
      Read distance and coverage: 4: Cyclist
      Tap New Route until one appeals: 3: Cyclist
    section Ride
      Export GPX: 5: Cyclist
      Import into Komoot or Garmin: 4: Cyclist
```

The two low-scoring steps are both waits, and both are the same underlying cost: a network
round-trip to Overpass with no progress indication beyond a spinner, and a synchronous `O(N²)`
graph build that blocks the main thread ([`16`](../backlog/16-spatial-index.md),
[`17`](../backlog/17-web-worker.md), [`18`](../backlog/18-overpass-resilience.md)).

---

## 6. Use cases

### UC-1 — Load bike lanes for the visible area

**Actor** Cyclist · **Trigger** Tap *Load Bike Lanes*
**Precondition** The map has emitted a bbox (on load or on move)

1. The bbox is measured; if either edge exceeds 50 km the request is refused with
   `Zoom in closer — current area is W×H km. Maximum is 50×50 km.`
2. An Overpass QL query is built for the bbox, selecting `highway=cycleway`,
   `cycleway=lane|track|shared_lane|opposite_lane|opposite_track`, `cycleway:left/right=lane|track`,
   and `bicycle=designated` on `path`/`track`/`footway`.
3. The response is converted to GeoJSON, then to `BikeLane[]`. LineString features only; every
   other geometry is discarded.
4. The area is written to IndexedDB under a bbox id rounded to 3 decimals.
5. The store is updated, the overlay redraws, the route batch cache is cleared.

**Result** `N lanes loaded` appears in the sheet header; the network is on the map.
**Failure** Any network or HTTP error surfaces in the red banner. There is no retry, no
alternative mirror, and no way to cancel an in-flight request
([`18`](../backlog/18-overpass-resilience.md)).

---

### UC-2 — Suggest a route

**Actor** Cyclist · **Trigger** Tap *Suggest Route*
**Precondition** At least one bike lane is loaded

1. A spinner is shown; the hook yields to the browser so it actually paints.
2. The start point is resolved from `navigator.geolocation` with a 3 s timeout, falling back to
   the map viewport centre. A denied permission is treated as a fallback, not an error.
3. `buildRoute` looks for a cached batch keyed on every routing preference, with start coordinates
   rounded to three decimal places.
4. On a miss, `findRoutes` builds the graph, runs the selected Explore or Loop strategy from every
   lane endpoint within 200 m of the start, deduplicates, and — if too few routes emerged —
   rebuilds at a 1 000 m gap tolerance and retries.
5. The batch is shuffled and cached; the first route is returned.

**Result** The route draws in bright orange; distance and coverage appear.
**Failure** Explore mode shows the generic no-route message. Loop mode suggests a shorter
distance, a larger gap tolerance, or switching back to Explore.

**Current constraints** No destination mode, and distance remains fixed at 10–30 km. Gap tolerance
and Explore/Loop mode are user-selectable and persisted.

---

### UC-3 — Cycle through alternatives

**Actor** Cyclist · **Trigger** Tap *New Route*

The cached batch is advanced by one, wrapping at the end. No recomputation, so the response is
instant. All routes in a batch share every routing preference; because the batch is
shuffled once at creation, the order is stable within a session.

**Known wrinkle** Mirrored loops count as two distinct entries, so a round-trip batch can present
the same ride twice in opposite directions ([`12`](../backlog/12-route-dedup-signature.md)).

---

### UC-4 — Export GPX

**Actor** Cyclist · **Trigger** Tap *Export GPX*

Every coordinate of every segment — gaps included — is flattened into one `<trkseg>` and
downloaded as `route.gpx`. The file is a GPX 1.1 track: no waypoints, no elevation, no
timestamps, no per-segment metadata, and no distinction between lane and gap. It imports cleanly
into Komoot, Garmin Connect, Strava and OsmAnd.

**Known wrinkle** The track name is interpolated into XML unescaped
([`20`](../backlog/20-gpx-hardening.md)).

---

### UC-5 — Clear the route

**Actor** Cyclist · **Trigger** Tap *✕*

The route is dropped from the store, the route layer unmounts, the lane overlay returns to full
opacity and *Suggest Route* reappears. The cached batch survives, so the next suggestion is
still instant.

---

### UC-6 — Return visit

**Actor** Returning cyclist · **Trigger** Open the app

1. The viewport is rehydrated from `localStorage` — the map opens where it was left.
2. `loadAllAreas()` reads every cached area from IndexedDB, drops entries older than 7 days, and
   flattens the survivors into the store. **All** areas are merged, so a user who has fetched
   three cities carries all three lane networks.
3. The last route is rehydrated from `localStorage` and redrawn.
4. If location permission was already granted, the map flies to the current position.

The app is fully usable offline in a previously fetched area — the only network dependency left
is the base map tiles.

**Known wrinkles** *Load Bike Lanes* always passes `forceRefresh = true`, so the cache is never
consulted on the fetch path and expired areas are filtered but never deleted
([`19`](../backlog/19-cache-bypassed-on-fetch.md)). The rehydrated route's `createdAt` comes back
as a string ([`15`](../backlog/15-persisted-route-rehydration.md)).

---

### UC-7 — Locate me

**Actor** Cyclist · **Trigger** App load, or tap the MapLibre locate button

On load the app checks the Permissions API and only requests a position if permission was
*already* granted — no unprompted permission dialog on first visit. A granted position flies the
map to zoom 14 and drops a pulsing blue marker. The explicit locate button requests permission
in the normal way.

---

## 7. Operating limits

| Limit | Value | Where enforced |
|---|---|---|
| Largest fetchable area | 50 × 50 km | `useBikeLanes` |
| Overpass query timeout | 30 s | `queries.ts` (`[timeout:30]`) |
| Geolocation timeout | 3 s, 60 s max age | `useRoute` |
| Cache lifetime | 7 days | `area-cache.ts`, `useBikeLanes.ts` |
| Route length | 10–30 km | `DEFAULT_PREFERENCES` |
| Gap tolerance | 200 m, silently widened to 1 000 m | `DEFAULT_PREFERENCES`, `route-finder.ts` |
| Start search radius | 200 m | `DEFAULT_PREFERENCES` |
| Walks per start candidate | 80 | `route-finder.ts` |
| Storage | IndexedDB quota (browser-dependent, typically ≥ 50 MB) | — |

No API keys, no accounts, no telemetry, no cookies. Everything the app knows lives in the
browser it runs in.

---

## 8. Deliberately out of scope

- Turn-by-turn navigation and voice guidance — GPX export hands off to purpose-built apps.
- Elevation, gradient and climb metrics.
- Multi-user features: sharing, comments, social feeds.
- Server-side anything: no accounts, no sync, no rendering.
- Editing OSM data. CycleRoute reads the map; it does not improve it.
