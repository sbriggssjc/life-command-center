# Audit — geographic enrichment payoff (2026-06-20)

**Question (Scott):** the geocode investment (Census + Google Maps backfill, Round 76gn) was
justified to power nearby-owners, competitor analysis, and nearby-sales comps. Is that lat/lng
coverage actually feeding features, or is it sitting unused? A captured-but-not-fed-back check on
the spatial layer.

## Verdict: coverage SUCCEEDED (96.6% gov / 86.4% dia) — but the spatial layer is almost entirely UNUSED; the payoff features were never built

### The investment worked (coverage)
| domain | properties | geocoded | % |
|---|---|---|---|
| gov | 12,537 active | 12,111 | **96.6%** |
| dia | 12,279 | 10,603 | **86.4%** |
Both are well above the ~70% threshold the CLAUDE.md cited as the floor for haversine ranking to
be meaningful. The geocode-tick cron + Google Maps fallback did their job.

### But almost nothing consumes it
- **Only one real consumer: the lease-comps export** (`detail-lease-comps-fix.js`,
  haversine-ranked nearest comps). Built and working.
- **dia "competitor analysis" exists but uses COUNTY, not lat/lng** (`detail.js`: "Competitors:
  same-county clinics") — it predates and ignores the geocode investment. County is coarse:
  misses across-county-line neighbors and includes far-flung same-county facilities.
- **The three planned high-value features are NOT built** — still literally "(planned)" in both
  `CLAUDE.md` and `AGENTS.md`:
  - **Nearby owners** — same recorded/true owner within N miles → outreach cohort lists.
  - **Competitor analysis by distance** — nearest N dialysis facilities → tenant
    concentration / replacement risk.
  - **Nearby sales** — recently-closed `sales_transactions` within N miles → price/SF + cap
    comp anchor.
- **The property context packet (the MCP/agent layer) explicitly defers comps** —
  `operations.js:6112`: "comps — deferred placeholder (no cheap nearby-comps source on the hot
  path)"; it pushes `comps` into `fields_missing` rather than running a geospatial query. So
  agents/MCP get no nearby comps either.
- `lcc_listing_geographic_neighbors` exists (R5/R48) but only fires *inside* the listing-event
  consumer (on a sale) — not as a general "nearby" surface.

### Infrastructure
- **No PostGIS / earthdistance / cube extension and no spatial index** on
  `properties.latitude/longitude`. Distance today is brute-force haversine (JS in the lease-comps
  export). At ~12k geocoded rows/domain a single-subject nearby query is trivial in SQL, so
  building the features is cheap — either a shared haversine SQL function, or enable
  `cube`+`earthdistance` with a GiST index for indexed `<->` nearest-neighbor.

## The gap
A near-complete, high-quality spatial layer (96.6% / 86.4%) is sitting unused. The geocode spend
was justified *specifically* to power nearby-owners, nearby-sales, and geo-competitor — and those
were never built. Classic captured-but-not-fed-back: the data is there; the decision features that
would consume it aren't. All three are high BD value: nearby owners = outreach lists, nearby
sales = comp/price anchors, geo competitor = concentration/replacement risk.

## Fix doctrine → R50 (build the features on the existing coverage)
Additive read-features (no writes to curated data — lower risk than the scoring/grade work), gov+dia,
sharing one distance primitive:
1. **Distance primitive** — a shared haversine SQL function (or enable `cube`+`earthdistance` +
   GiST index) so all three features share one nearest-neighbor implementation.
2. **Nearby owners** — same owner within N miles of a subject → outreach cohort (ties to R47
   owner resolution).
3. **Nearby sales** — recent `sales_transactions` within N miles → price/SF + cap anchor; **fills
   the deferred `comps` placeholder in the property context packet** (so MCP/agents get it too).
4. **Geo competitor analysis** — nearest N facilities by distance; upgrade dia's county-based
   competitor view to lat/lng, and add a gov analogue (nearest competing leased assets) →
   concentration / replacement-risk signal.
5. Wire into the surfaces that already exist: property detail page, the context packet/MCP
   (fills `comps`), and optionally the queue/decision surfaces as a signal.

## Scope fork for Scott (asked before building)
- **A — all three at once** (they share the distance primitive; most efficient single build).
- **B — nearby sales first** (feeds the comps placeholder + cap anchors; highest analytical value).
- **C — nearby owners first** (outreach lists; ties directly to the R47 owner work + BD spine).

## Bottom line
The geocode investment delivered the coverage (96.6%/86.4%) but stopped before the payoff: the
only consumer is the lease-comps export, dia's competitor view still uses county, and nearby-owners
/ nearby-sales / geo-competitor — the exact features the spend was justified for — are unbuilt, with
the context packet explicitly deferring comps. R50 builds them on the existing coverage with one
shared distance primitive, wired into property detail + the MCP context packet, turning a dormant
spatial layer into live BD signal.
