# LCC App Audit — Remaining Issues (March 2026)

Issues identified during a full app audit. Status updated March 31, 2026.

---

## Issue 1: Government Pipeline — PostgREST 1,000-Row Cap — RESOLVED

**Status:** Fixed in commit `e15eaff` (March 31, 2026)

**What was fixed:** `prospect_leads` already used `govQueryAll()` with auto-pagination. Fixed `available_listings` query in gov.js which had a hardcoded `limit: 1000` — now uses offset pagination loop matching the sales_comps pattern.

---

## Issue 2: Government Leases — Missing Address/City Data — OPEN

**Problem:** Many rows in the Leases "Expiring Soon" table show dashes for address and city. The properties table may have this data but it's not being joined, or these records genuinely lack addresses.

**Required Fix:**
1. Check how many `prospect_leads` or `gsa_leases` records have NULL address/city
2. If the data exists in `properties`, create a view that JOINs them
3. If the data is missing, flag these for enrichment

---

## Issue 3: Government Players — Entity Deduplication (Data Level) — OPEN

**What was fixed (frontend):** Added `normalizeEntity()` function that strips LLC/LP/Inc suffixes and merges known entity families (Boyd Watterson variants, Easterly variants, Tanenbaum/Gardner-Tannenbaum, NGP, RMR).

**What still needs fixing:** The underlying data has inconsistent entity names. A proper solution would be:
1. Create an `entity_aliases` table mapping variant names to canonical names
2. Normalize entity names during ingestion
3. Add a deduplication script that identifies likely duplicates by Levenshtein distance or prefix matching

---

## Issue 4: Operator Name Casing Inconsistency (Dialysis) — RESOLVED (frontend)

**Status:** Fixed in commit `e15eaff` (March 31, 2026)

**What was fixed:** Added `normalizeOperatorName()` in app.js that maps variant operator names to canonical forms: "DaVita", "Fresenius Medical Care", "US Renal Care", "Dialysis Clinic Inc", "American Renal Associates". Applied in 5 display locations (search results, detail headers, detail panels, CMS data, property link queue).

**Still recommended:** Fix the underlying `medicare_clinics.owner_name` values in Dialysis Supabase for consistency at the data level.

---

## Issue 5: Government Overview — "Unknown" Agency Dominance — RESOLVED

**Status:** Fixed in commit `e15eaff` (March 31, 2026)

**What was fixed:** "Unknown" agencies are now filtered out of the top 12 count and top 10 rent agency breakdown charts in gov.js. A footnote card is displayed below the charts showing the count, percentage, and rent amount attributed to Unknown agencies. Same filtering applied to the Lease Exposure by Agency table.

**Still recommended:** Investigate why 42% of properties have NULL/empty agency values and enrich from `tenant_agency` or `gsa_lease` data.

---

## Issue 6: Marketing — 98.5% Deals Overdue — RESOLVED

**Status:** Fixed in commit `e15eaff` (March 31, 2026)

**What was fixed:** Added three features to the Marketing tab in app.js:
1. "Archive Stale (6mo+)" button that bulk-archives deals overdue by 180+ days to localStorage
2. Visual "Stale — Xmo overdue" badges on deals overdue by 180+ days (dimmed opacity)
3. "Show Archived" toggle to reveal/hide archived deals

---

## Issue 7: Today Page — 1,050 Flagged Emails — OPEN

**Problem:** The flagged email count shows 1,050, which seems very high. This may be pulling all emails rather than just flagged ones.

**Suggested Fix:**
1. Verify the Outlook/Power Automate integration filter — is it filtering for `flag.flagStatus eq 'flagged'`?
2. If the count is accurate, add pagination or a "load more" mechanism instead of showing all 1,050

---

## Issue 8: Government Agency Label Truncation — RESOLVED (already existed)

**Status:** Verified March 31, 2026 — tooltips already implemented.

The `inlineBar()` function in gov.js already includes `title="${esc(item.label)}"` attributes on bar chart labels, providing full agency names on hover.

---

## Issue 9: Activity renderBizSubset — No Pagination — RESOLVED (already existed)

**Status:** Verified March 31, 2026 — pagination already implemented.

The `renderBizSubset()` function in app.js already includes: pagination state tracking (`_bizSubsetPage`), proper page calculation using `PAGE_SIZE`, a "showing X of Y" indicator, and Prev/Next pagination controls.

---

## Issue 10: Prospects Search — Contact Card Click Does Nothing — RESOLVED (already existed)

**Status:** Verified March 31, 2026 — handler already implemented.

Government Contact results already have `_source: 'gov-contact'` set properly, with a full detail handler in `showDetail()`, tab configuration, and `renderGovContactDetailBody()` renderer.

---

## Issue 11: Prospects Search — `or=` Filter May Not Work With All Column Names — RESOLVED (already mitigated)

**Status:** Verified March 31, 2026 — safeQuery wrapper already exists.

The `execProspectsSearch()` function includes a `safeQuery()` async helper that wraps all database queries in try/catch, returning `{ data: [] }` on failure. All 6 query types (gov leads, ownership, contacts, listings, dia clinics, NPI) use this wrapper.

---

## Additional Fixes (March 31, 2026)

### My Work / Metrics Zeros vs Dashboard Mismatch — RESOLVED

**Problem:** Dashboard My Work widget showed items (e.g., "Noah Dalay") but the My Work page and Metrics showed 0 across the board.

**What was fixed (ops.js):** `renderMyWork()` now checks `canonicalMyWork` first (matching the Dashboard's data source) before falling back to the queue API. `renderMetricsPage()` now falls back to `canonicalCounts` when the queue API returns empty.

### Government Tab Stale DOM on First Switch — RESOLVED

**Problem:** Switching from Dialysis to Government briefly showed Dialysis content before Government data loaded.

**What was fixed (app.js):** Added immediate clearing of the `bizPageInner` content container at the start of the sub-tab click handler. Shows a loading spinner while the new content loads.

### Supabase RLS on research_queue_outcomes — RESOLVED

**Problem:** Console error: `HTTP 403 {"error":"Read access denied for table: research_queue_outcomes"}`

**What was fixed:** Created the `research_queue_outcomes` table in Government Supabase with proper RLS policies for anon read, insert, and update access. Added performance indexes.

### Available Listings 1000-Row Cap — RESOLVED

**Problem:** `available_listings` query in gov.js used hardcoded `limit: 1000` without pagination.

**What was fixed (gov.js):** Updated to use offset pagination loop (same pattern as sales_comps), fetching all results beyond the 1000-row PostgREST cap.

---

## Remaining Open Issues

- **Issue 2:** Government Leases — Missing Address/City Data (data enrichment needed)
- **Issue 3:** Government Players — Entity Deduplication (data-level fix needed)
- **Issue 7:** Today Page — 1,050 Flagged Emails (Power Automate filter verification needed)
- **Issue 4 (data level):** Operator name normalization in Dialysis Supabase `medicare_clinics.owner_name`
- **Issue 5 (data level):** Investigate 42% "Unknown" agency properties for enrichment opportunity

---

## Supabase Connections

- **Government:** Project ID `scknotsqkcheojiaewwh`
- **Dialysis:** Project ID `zqzrriwuavgrquhisnoa`
- API proxies: `/api/gov-query.js` and `/api/dia-query.js`
