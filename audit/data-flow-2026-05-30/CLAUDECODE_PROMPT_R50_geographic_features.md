# Claude Code — R50: build the geographic features on the existing geocode coverage (nearby owners + nearby sales + geo competitor)

## Why (audit live 2026-06-20 — see AUDIT_geographic_enrichment_payoff_2026-06-20.md)
The geocode investment (Round 76gn) delivered the COVERAGE — gov 96.6% (12,111/12,537), dia 86.4%
(10,603/12,279) lat/lng — but the payoff features it was justified for were never built. Today:
- Only consumer of lat/lng is the **lease-comps export** (`detail-lease-comps-fix.js`, JS haversine).
- dia **competitor analysis uses COUNTY, not lat/lng** (`detail.js` "Competitors: same-county clinics").
- **Nearby owners / nearby sales / geo competitor are still "(planned)"** in CLAUDE.md + AGENTS.md.
- The **property context packet defers comps** (`operations.js:6112` → `fields_missing`).
- No PostGIS/earthdistance/cube extension, no spatial index — distance is brute-force haversine
  (fine at ~12k rows/domain for single-subject queries).

**Scope (Scott, 2026-06-20): all three at once**, sharing one distance primitive.

## House rules
Additive READ features — **no writes to curated data** (lower risk than the scoring work).
gov + dia parity (build both; dia's competitor view is an upgrade from county→geo). Value-ranked
where applicable. Reuse the existing geocode coverage + the lease-comps haversine approach — don't
re-geocode. Heavy scan stays in the DB (SQL functions on the domain DBs), LCC calls via the
existing `domainQuery` RPC pattern. ≤12 `api/*.js` (LCC); `node --check` / `py_compile`; suites
green; DB applied live after a dry-run, idempotent. Branch/PRs per each repo's conventions
(gov + dia domain SQL; LCC for the API/UI/context-packet wiring).

## Unit 0 — shared distance primitive (both domains)
One nearest-neighbor implementation reused by all three features. Recommended: a haversine SQL
function on each domain DB, e.g. `<dom>_nearby_properties(subject_property_id, radius_miles,
limit_n)` returning `(property_id, distance_miles, lat, lng)` for geocoded properties within
radius, ordered by distance. (Optional optimization: enable `cube`+`earthdistance` + a GiST index
for indexed `<->` — only if a single-subject scan proves too slow, which at ~12k rows it won't.)
Skip the subject itself; require both subject and candidate geocoded; return empty (not error)
when the subject has no lat/lng.

## Unit 1 — nearby owners (outreach cohort)
`<dom>_nearby_same_owner(subject_property_id, radius_miles, limit_n)` — other properties within
radius whose owner matches the subject's owner (use the **resolved owner** where available — tie
to R47/R6 owner resolution; fall back to recorded/true owner name match). Returns the owner's
other nearby holdings (property_id, address, distance, rent/value if available) → an outreach
cohort. Surface on the property detail page + expose for the BD spine.

## Unit 2 — nearby sales (comp/price anchor) — also fills the context-packet comps gap
`<dom>_nearby_sales(subject_property_id, radius_miles, months_back, limit_n)` — recent
`sales_transactions` within radius + time window, returning sale_date, price, price_psf, cap_rate
(prefer the derived `cap_rate_history` value per the cap-rate framework), distance. Value: price/SF
+ cap anchors near the subject. **Wire this into `operations.js` to fill the deferred `comps`
placeholder** (replace the `fields_missing.push('comps')` with the nearby-sales result) so the
property context packet AND the MCP/agent layer get nearby comps. Keep it cheap (bounded radius +
limit) since the packet is on a warmish path — if needed, cap to a small N.

## Unit 3 — geo competitor analysis
`<dom>_nearby_competitors(subject_property_id, radius_miles, limit_n)` — nearest N facilities by
distance:
- **dia:** nearest dialysis facilities (medicare_clinics / properties) → upgrade the existing
  county-based competitor view in `detail.js` to lat/lng distance (keep county as a fallback when
  the subject isn't geocoded). Surfaces tenant concentration / replacement risk.
- **gov:** nearest competing gov-leased assets (e.g. same/related agency, or all gov-leased
  nearby) → concentration / replacement-risk signal.
Surface on property detail (both domains).

## Wiring + verify (report back)
- The 3 SQL functions live on gov + dia; spot-check each on a real geocoded subject (e.g. a
  high-value gov property + a dia clinic) — confirm sensible distances + non-empty results.
- Property context packet now returns `comps` (nearby sales) instead of `fields_missing` — show a
  before/after on one property.
- Property detail page renders nearby owners + nearby sales + geo competitors; dia competitor view
  switched from county to distance (with county fallback).
- Coverage caveat: report how many subjects can't produce results because they (or their radius)
  lack geocoded neighbors — the ~3.4% gov / 13.6% dia ungeocoded tail.
- No writes to curated data; suites green; ≤12 api/*.js.

## Bottom line
The spatial layer is built and ~90%+ covered but dormant. R50 turns it into live BD signal:
nearby-owner outreach cohorts, nearby-sales comp anchors (filling the MCP context-packet comps
gap), and distance-based competitor/concentration analysis — all on one shared haversine primitive,
additive and read-only, wired into the property detail page and the agent context layer.
