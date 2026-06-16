# Claude Code — R26: county backfill + ownership-research portal-assist (de-dead-end the NBA's #1 work)

## Reframe (grounded live 2026-06-15 — the naive plan isn't viable; this one is)
The Today rail's top items ("Research recorded owner for 777 S Aviation Blvd", $122M;
"…350 Rhode Island St", $183M) and the agency-drift tasks ARE the data-gap cockpit's
highest-value work. The obvious idea — "scrape the county recorder to auto-fill the
owner" — does NOT work and should NOT be built:
- `GovernmentProject/src/county_scraper.py` only harvests county **portal URLs** from
  Netronline into `county_authorities` (4,483 rows: assessor/recorder/treasurer/GIS/tax
  **search-page links**). It has no per-property owner extraction.
- Those are non-uniform manual search portals (many JS/captcha-gated) — there is no
  free, uniform API to read an owner from 4,400 different county sites. (The only real
  automation is a paid bulk-parcel dataset — Regrid/ATTOM — which is a separate
  free-vs-paid decision for Scott, NOT this round.)
- Worse, you can't even ROUTE to a portal today: of **4,038 active gov properties
  missing `recorded_owner_id`, only 72 have `county` populated** (`gov.properties`).

So R26 builds the achievable, free, durable win that ACTUALLY helps the operator work
these tasks: **fill `county` (the missing routing key), then turn each "Research
recorded owner" task into a one-click county-portal lookup.** It does NOT claim to
auto-fill the owner — it removes the dead-end and the manual hunt for the right portal.

Grounded counts (gov DB `scknotsqkcheojiaewwh`, 2026-06-15):
- 4,038 active properties missing recorded owner; **3,761 already have lat/lng**
  (reverse-geocodable for free, no new geocoding), 258 lack coords but have a full
  address, only ~19 have neither.
- `county_authorities` 4,483 rows keyed `(county_name, state_code)` with
  `assessor_url` / `recorder_url` / `netronline_url` / etc.
- `gov.properties` already has `county` (mostly NULL) and `metro_area` columns.

---

## Unit 1 (GovernmentProject — the prerequisite + biggest data win) — backfill `county`
Reverse-geocode the lat/lng we already have into a county and PATCH `gov.properties.county`.

- **Source (free, no key):** the FCC Census Area API —
  `https://geo.fcc.gov/api/census/area?lat=<lat>&lon=<lon>&format=json` returns
  `results[0].county_name` + `county_fips` + `state_code`. One call per property,
  cheap, no rate cap of concern at ~1 req/sec. (This mirrors how
  `geocode_properties.py` already calls free Census endpoints — reuse its client /
  rate-limit / Supabase-write patterns; do NOT re-invent the geocode plumbing.)
- For the **258 with no coords but a full address**, fall through to the existing
  address geocoder (`geocode_properties.py` Census `onelineaddress`, which returns the
  county geography too) — fill BOTH lat/lng and county in that pass.
- **Write policy:** fill-blanks only — set `county` only where NULL; never clobber an
  existing county. Tag provenance the project's way (e.g. a `county_source` field or
  the standard `pending_updates`/source convention `'fcc_reverse_geocode'` /
  `'census_geocode'` — follow how `geocode_properties.py` records source). Also fill
  `metro_area` only if the project already has a county→CBSA map; otherwise leave metro
  to the existing FRPP/sync path (don't invent a mapping).
- **Shape it like the existing backfills:** a one-shot script
  (`python -m src.<name> --backfill --limit N`, resumable, idempotent, batched) AND, if
  trivial, a small ongoing tick so new gov properties get a county automatically. Bound
  each batch; log scanned/patched/missed; never fail the run on a single geocode miss.
- **Acceptance:** `gov.properties` active-missing-RO rows with `county` populated goes
  from ~72 toward ~3,800+; spot-check 5 against the address (e.g. 777 S Aviation Blvd →
  Los Angeles County, CA). No existing county overwritten. Brand/visual rules N/A
  (data-only). Respect the project's git workflow (feature branch, tests, merge note).

## Unit 2 (LCC — the payoff) — portal-link assist on the ownership-research surface
With `county` populated, turn the dead-end "Research recorded owner" task into a
one-click lookup. The research tasks live in LCC Opps (`research_tasks`,
`research_type` in the missing-recorded-owner family / `source_table='v_next_best_research'`);
the county→portal mapping needs `gov.properties.county` (Unit 1) joined to
`county_authorities`.
- Add a resolver that, for a recorded-owner research task on a gov property, looks up
  the property's `(county, state)` → `county_authorities` and returns the best portal
  URL (prefer `recorder_url`, then `assessor_url`, then `netronline_url`). Expose it on
  the task payload the Today "Top Data Gaps to Close" card and the property-detail
  ownership section render.
- **UI:** on a "Research recorded owner" card/row, render a **"Look up owner →"** link
  to that county portal (open in a new tab) + the county name, so the operator goes
  straight to the right recorder site instead of hunting for it. When no county/portal
  is resolvable yet, show the current behavior (no link) — never a broken/guessed link.
- This is the durable de-dead-end: the NBA's highest-value tasks become assisted, not
  manual hunts. (Owner still entered by the operator from the portal, or captured later
  via CoStar — we are not auto-writing the owner.)
- **House rules:** ≤12 `api/*.js` (resolver in an existing handler/_shared, no new
  api/*.js); `node --check`; suite green. Cross-DB read of `gov.properties.county` uses
  the existing gov anon-view / domainQuery path (don't loosen RLS — if a county field
  isn't exposed on a gov anon view yet, extend the existing
  `v_property_*_portfolio`-style view rather than reading a PII table).
- **Acceptance:** a recorded-owner task on a now-countied gov property shows a working
  "Look up owner → <County> Recorder" link; tasks without a resolved county show no link
  (no regression).

---

## Sequencing / batch
Unit 1 (GovernmentProject) ships first — it's the prerequisite and the standalone data
win (county/metro on 4,038 high-value records, useful for location-tier scoring too).
Unit 2 (LCC) lands on the next Railway redeploy and only lights up where Unit 1 has
filled county. Both are additive and safe to deploy in either order (Unit 2 simply shows
no link until county exists).

## Explicitly OUT of scope
Auto-scraping owners from county portals (not viable). Paid parcel datasets
(Regrid/ATTOM) — a separate free-vs-paid decision for Scott. dia owner gaps (dia owner
sourcing is CoStar/CMS-driven; this round is gov-specific).

## Bottom line
We can't free-auto-fill the recorded owner, but we CAN remove the dead-end: fill the
missing county (3,761 already have coords — free reverse-geocode) and hand the operator
a one-click county-recorder link on exactly the high-value tasks the Today rail now
leads with. That's the honest durable improvement to the data-gap cockpit.
