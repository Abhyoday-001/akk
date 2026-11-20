# Skylay — disruption simulator

Trigger weather or operational problems anywhere on Earth, watch delay spread through aircraft rotations and passenger connections, and test recovery decisions.

- **Two networks** (header dropdown): *India domestic* (18 airports, ~400 flights, times in IST) and *Worldwide* (68 airports, ~860 flights incl. long-haul widebodies, times in UTC).
- **Real map**: Natural Earth 1:50m coastlines, borders and country names (bundled in `js/world-topo.js`, works offline), Web-Mercator with world wrap, great-circle routes, a live day/night terminator, airliner sprites with shadows and contrails.
- **Light / dark theme** toggle (top right); your choice is remembered.

**Run:** double-click `index.html`, or `node serve.js` and open http://localhost:5173. No build step, no dependencies.
**Test the engine:** `node test/engine.test.js`

## How to play
1. Pick a scenario (or build a storm in the *Weather* tab). The clock starts two hours before the storm.
2. Press **Play** (space). Pause any time and open **Recovery** — decisions take effect *from the paused time*; the past never changes.
3. Open **Where to fix**: it traces every delayed flight back to the problem that started it (direct vs knock-on), lists the airports that are bottlenecked right now, and the flights *about to fall next* — each with the best fix, measured by re-simulating the whole day.
4. Compare **Your plan** (cyan) against **No action** (red) on the chart and KPI deltas. Success is measured in operational terms, not money — pick what to optimise: **passenger delay** (pax-hours), **aircraft delay** (aircraft-hours) or **people stranded**. The grade is the share of the weather damage recovered on that objective.
5. Not sure what to do? **Advisor** re-simulates every measure and ranks it on the chosen objective; **Auto-optimise** applies the best ones greedily. Rupee cost is shown only as "resources committed" for reference.

## What is modelled
- **Aircraft rotations** — 102 aircraft + 6 spares, ~400 flights; a late arrival delays that aircraft's next departure (35 min minimum turn).
- **Problems placed anywhere** — click the map to plant a thunderstorm, cyclone, dust storm, snowstorm, fog, volcanic ash, runway closure or ATC outage; drag to move. Airports inside the circle are closed or throttled by distance from its centre; storm-type cells also force flights crossing them to detour.
- **Runway capacity** per airport. Slots are allocated in time order.
- **Holding / diversion** — inbound aircraft hold up to 40 min, then divert to the nearest open airport and ferry on later.
- **Crew duty limits** (14 h) — late rotations get cancelled in the evening. Delays >4 h cancel the rotation.
- **Passengers** — 350 two-leg itineraries, 45 min minimum connection; missed connections and cancellations are re-booked on later flights with free seats, otherwise stranded overnight.
- **Domino generation** — G0 = hit directly by weather, G1, G2… = each later link in the same aircraft chain.

## Recovery measures
Ground-delay program · hold connections · fast turnarounds · surge operations · spare-aircraft swap · rotation cancel · crew-duty extension · auto-rebooking & care. Each shows a live what-if cost preview before you commit.

## Data
No organiser flight file was in the project, so `js/data.js` generates seeded synthetic networks. To use real data, replace `buildNetwork(kind)` so it returns `{meta, airports, airportMap, airlines, tails, flights, itins, dist, blockBetween}` in the same shape — the engine and UI do not change.

Map data: Natural Earth (public domain) via the `world-atlas` package (ISC licence).
