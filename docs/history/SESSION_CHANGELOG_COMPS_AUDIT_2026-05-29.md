# Comps / Availables / Monitoring — Session Changelog & Final Audit (2026-05-29)

End-to-end audit + remediation of how the LCC stack defines, counts, windows,
attributes, and presents **sales comps**, **available (on-market) comps**, **lease
comps**, **cap rates**, **Northmarq/SJC attribution**, the **BD listing-event
pipeline**, the **Salesforce deal book**, and the **on-market monitoring +
manual-follow-up loop** — across dia (`zqzrriwuavgrquhisnoa`), gov
(`scknotsqkcheojiaewwh`), and LCC Opps (`xengecqvemvfknjvbvrq`).

All DB changes applied live + captured as migration files; all JS pushed to
`claude/dreamy-edison-LUv7m`. Companion audit docs:
`SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md`,
`ON_MARKET_LIFECYCLE_CATEGORIZATION_REVIEW_2026-05-29.md`,
`ON_MARKET_AVAILABILITY_IMPLEMENTATION_2026-05-29.md`,
`SALES_COMPS_IMPLEMENTATION_2026-05-29.md`,
`COMPS_LEASE_CAPRATE_MONITORING_AUDIT_2026-05-29.md`.

---

## 1. On-market / available listings — authoritative lifecycle gate
**Problem:** 3+ conflicting "available" definitions; dia view keyed on the
drifting `status` string (leaked 33 off-market + 144 synthetic placeholders);
gov keyed on "a sale exists" (suppressed genuine re-listings, leaked
withdrawn-unsold).
**Fix:** dia `v_available_listings` → gate on `is_active AND no sale`;
reclassified 144 synthetic imports; healed status drift; patched
`lcc_record_listing_check` to keep `status` synced. gov got a generated
`is_active` column + `is_active` gate (matview→live view, refresh cron dropped).
Shared `lccIsListingActive`/`lccIsListingOnMarket` helper in app.js; per-surface
predicates unified. **Result: dia 289→265, gov 161→188** (correct, lifecycle-true).

## 2. Sales comps — count each transaction once + consistent gates
**Problem:** `transaction_state` (uniqueness) and `exclude_from_market_metrics`
(stat-quality) were never synced, so dupes/stubs/needs-review leaked into comps,
TTM, and the CM PDF; dia dashboard read the raw table.
**Fix:** enforced invariant **non-live ⇒ excluded from market metrics**
(backfill + BEFORE trigger, both DBs) so every existing `exclude` gate equals the
canonical `live AND not-excluded`. dia dashboard loader + gov `v_sales_comps`
(matview→live view) corrected. **Non-live leak now 0 on both.**

## 3. Cross-month dedup + zero-price gap
**Problem:** dedup tick keyed on calendar-month; cross-month dups (CoStar
month-only date vs precise deed date) slipped through and reaccumulated;
needs-review tick missed `price=0`.
**Fix:** added Pass-2 proximity match (same property, price ±$1k, ≤60d) to
`sales_dedup_tick` (idempotent, both DBs); needs-review tick now catches
`<=0`. One-time history cleanup. **0 exact cross-month dups remain.**

## 4. Medium-confidence dedup review queue
`v_sales_dedup_review` surfaces the 0.5–5% / ≤45d band the tight auto-tick leaves
for humans. Worked it twice (human-reviewed, all genuine cross-source dups):
dia 44 + gov 34 (initial) and gov 8 (re-accumulated, cleared in final sweep).
**Both review queues now 0.**

## 5. Rent shown at sale date (dia)
Sales-comp rent was inconsistent (dashboard Y1 base vs detail raw `leases.rent`,
neither escalated). dia `v_sales_comps` matview + dashboard now project rent to
the **sale date**; gov already shows `gross_rent` at sale.

## 6. Cap-rate quality consistency (both domains)
**Problem:** G6 nulled implausible caps only in `v_sales_comps`; dia dashboard +
all CM cap views still averaged them (dia TTM cap overstated ~34 bps).
**Fix:** "null the cap, keep the row" applied to the dia dashboard
(`normalizeSalesTxnRow`) and **every** `cm_dialysis_*` + `cm_gov_*` cap view
(value expressions only — avg/COALESCE/percentile/spread/CTE — never WHERE/JOIN
conditions). **0 ungated cap views on both domains.** (Includes a corrected
over-claim + a re-patch of `cap_by_term_q` that a merge had un-gated.)

## 7. Lease comps — active-lease gate
Export read `v_lease_detail` unfiltered (~46% inactive/superseded leases could
surface as comps). Now excludes inactive/superseded, prefers most-recent active
commencement (matches `v_available_listings`), multi-active warning. (Rent
convention Y1-base vs escalated left as an open option.)

## 8. Northmarq / SJC attribution
**Problem:** dia/gov dashboards used divergent broker-name regexes; dia matched
~0 (team deals spelled "Scott Briggs"/"SJC", not "Northmarq").
**Fix:** unified all surfaces onto the `is_northmarq` flag (`lccIsNorthmarq` in
app.js — superset of name-matching, proven on data); added a tunable canonical
roster matcher (`lcc_is_nm_broker`) + write-time triggers (columns + sale_brokers
co-broker) so the flag stays complete. **dia NM 258→310+ flagged; dia TTM share
~0%→~9.6%.**

## 9. BD listing-event pipeline
**Problem:** `lcc_sync_listing_events` pulled raw sales (no `transaction_state`
gate) — 235 of 293 queued "sale" events were noise (gov: 160 ownership stubs).
**Fix:** gated dia pull + gov `v_sales_transactions_portfolio` on `live`;
retracted the 235 (backed up). **Queue 293→58 real sales.**

## 10. Salesforce deal book (full-book attribution surface)
SF and the dia comp DB barely overlap, so SF can't drive comp NM — but it's the
authoritative SJC book. Built `v_sjc_deal_book` / `_summary` / `_by_year` over
the live-synced `sf_listing_staging.raw_row` (team, stage, economics, property,
close date) + a "SJC Deal Book" dia panel (KPIs, by-year track record, per-team
rollup, recent closed). Team Briggs ≈ 1,303 closed / ~$8.1B. (Power Automate
instructions issued for: broker-contact sync, deal-field completeness, BD-surface
routing.)

## 11. On-market monitoring + manual follow-up loop (P2)
**Problem:** `unverified_assumed_off` listings the sweep can't deed-match had no
human surface; manual verification was sidebar-only; LLC research queue (1,258
dia / 657 gov) had endpoints but no UI.
**Fix:** `v_listings_needing_manual_confirmation` (dia+gov, with pre-resolved
sale-match candidate) + "Listings Needing Confirmation" panels;
`/api/resolve-listing-confirmation` main-app write-back (domain-aware, audited via
`lcc_record_listing_check(method='manual_user')`); "LLC Research Queue" panels
(SOS-lookup + Completed/No-Match) wired to the now-domain-aware
`/api/resolve-llc-research`. `manual_review_needed` escalation deprioritized
(0 live rows both domains).

---

## Final verification sweep (live, 2026-05-29)

| Check | dia | gov | target |
|---|---|---|---|
| `v_available_listings` rows | 265 | 188 | lifecycle-gated ✓ |
| gov `is_active` column | — | present ✓ | — |
| live comps (`v_sales_comps`/gated) | 2,804 | 2,471 | ✓ |
| **non-live leak into comps** | **0** | **0** | 0 ✓ |
| dedup review queue remaining | 0 | 0 | 0 ✓ |
| exact cross-month dups | 0 | (n/a) | 0 ✓ |
| **CM cap views ungated** | **0** | **0** | 0 ✓ |
| gov portfolio view live-gated | — | true ✓ | — |
| NM flagged (live) | 310 | 118 | maintained ✓ |
| confirmation view rows | 504 | 51 | actionable ✓ |
| LLC queue (queued) | 1,258 | 657 | actionable ✓ |

**All targets green.**

---

## Deploy checklist (outstanding)
1. **`data-query` edge function → redeploy to Dialysis_DB** (`zqzrriwuavgrquhisnoa`).
   Required for the new read views to be reachable by the app: `v_sjc_deal_book*`,
   `v_listings_needing_manual_confirmation` (both domains' allowlist entries added).
2. **Vercel frontend deploy** — all JS (app.js / dialysis.js / gov.js / admin.js)
   + vercel.json rewrites (`resolve-listing-confirmation`, `llc-research-queue`,
   `resolve-llc-research`). API function count verified ≤ 12.
3. Migrations already applied live; files are in `supabase/migrations/{dialysis,
   government}/2026052916–30*.sql` + LCC Opps `20260529200000_*` for the
   merge-train / new-DB-instance path.

## Open / deferred (not blocking)
- Capital-markets PDF **rolling-12 TTM** unification (dashboards already rolling-12;
  PDF is quarter-aligned — labeled, not yet converted).
- Lease-comp **rent convention** (Y1 base vs escalated-to-today) — awaiting call.
- SF **per-broker** attribution — needs broker-contact sync (PA workstream).
- Lease comps & cap-rate fixes are **CREATE OR REPLACE on live views** → any
  future migration recreating a `cm_*` cap view must re-include the implausible
  gate (durability caveat).
