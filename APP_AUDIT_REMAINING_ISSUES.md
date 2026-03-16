# LCC App Audit — Remaining Issues (March 2026)

Issues identified during a full app audit that require backend/data fixes beyond what the frontend can address.

---

## Issue 1: Government Pipeline — PostgREST 1,000-Row Cap

**What was fixed (frontend):** Added "+" suffix to counts and "showing first 1,000" note when the data hits the cap. Deduplicated pipeline rows by `lead_id`.

**What still needs fixing:** The `prospect_leads` query in `gov.js` line 134 is `limit: 1000`. The actual pipeline likely has more than 1,000 leads. Options:
- Use a server-side `COUNT(*)` query via an RPC function or a view with counts
- Implement paginated loading (like `ownership_history` already does)
- Increase the limit if PostgREST allows (needs Supabase config)

**Project:** Government Supabase (`scknotsqkcheojiaewwh`)

---

## Issue 2: Government Leases — Missing Address/City Data

**Problem:** Many rows in the Leases "Expiring Soon" table show dashes for address and city. The properties table may have this data but it's not being joined, or these records genuinely lack addresses.

**Required Fix:**
1. Check how many `prospect_leads` or `gsa_leases` records have NULL address/city
2. If the data exists in `properties`, create a view that JOINs them
3. If the data is missing, flag these for enrichment

---

## Issue 3: Government Players — Entity Deduplication (Data Level)

**What was fixed (frontend):** Added `normalizeEntity()` function that strips LLC/LP/Inc suffixes and merges known entity families (Boyd Watterson variants, Easterly variants, Tanenbaum/Gardner-Tannenbaum, NGP, RMR).

**What still needs fixing:** The underlying data has inconsistent entity names. A proper solution would be:
1. Create an `entity_aliases` table mapping variant names to canonical names
2. Normalize entity names during ingestion
3. Add a deduplication script that identifies likely duplicates by Levenshtein distance or prefix matching

---

## Issue 4: Operator Name Casing Inconsistency (Dialysis)

**Problem:** Cross-project "Prospects" search for "DaVita" shows some clinics with "Op: Davita" (lowercase v) and others with "Op: DaVita" (proper case). The `operator_name` field in `v_clinic_inventory_latest_diff` derives from `owner_name` which has inconsistent casing.

**Required Fix:**
1. Add a CASE expression or lookup table in the view to normalize operator names to proper case
2. Or fix the underlying `medicare_clinics.owner_name` values to use consistent casing
3. Known canonical names: "DaVita", "Fresenius Medical Care", "US Renal Care", "Dialysis Clinic Inc"

**Project:** Dialysis Supabase (`zqzrriwuavgrquhisnoa`)

---

## Issue 5: Government Overview — "Unknown" Agency Dominance

**Problem:** 6,879 properties (42%) and $3.4B in rent are tagged as "Unknown" agency. This dilutes the agency breakdown charts.

**Required Fix:**
1. Investigate why so many properties have NULL or empty `agency` values
2. Many of these may be inferrable from the `tenant_agency` or `gsa_lease` data
3. Consider filtering "Unknown" out of the top charts and showing it as a separate note
4. Or create an enrichment script that maps properties to agencies based on lease data

---

## Issue 6: Marketing — 98.5% Deals Overdue

**Problem:** 955 of 970 marketing deals are marked overdue. This likely means the due dates were set during a bulk import and never updated.

**Suggested Fix:**
1. Add a "Bulk Snooze" or "Archive Stale" feature to the Marketing section
2. Or add a Salesforce sync that updates deal stages/dates
3. Consider adding a "last contacted" date that auto-updates when the Log button is used

---

## Issue 7: Today Page — 1,050 Flagged Emails

**Problem:** The flagged email count shows 1,050, which seems very high. This may be pulling all emails rather than just flagged ones.

**Suggested Fix:**
1. Verify the Outlook/Power Automate integration filter — is it filtering for `flag.flagStatus eq 'flagged'`?
2. If the count is accurate, add pagination or a "load more" mechanism instead of showing all 1,050

---

## Issue 8: Government Agency Label Truncation

**Problem:** Bar chart labels like "POTOMAC SERVICE...", "METROPOLITAN SE..." are truncated in the Agency Breakdown charts.

**Suggested Fix (Frontend):**
1. Add tooltips on hover showing the full agency name
2. Or increase the label width allocation in the bar chart CSS

---

## Supabase Connections

- **Government:** Project ID `scknotsqkcheojiaewwh`
- **Dialysis:** Project ID `zqzrriwuavgrquhisnoa`
- API proxies: `/api/gov-query.js` and `/api/dia-query.js`
