# Lease Comps · Cap-Rate Quality · On-Market Monitoring — Audit & Remediation (2026-05-29)

Third audit pass after the sales-comps / availables / Northmarq / BD work.
Covers three areas the user requested. **Priority-1 fixes (currently-wrong data)
applied live; Priority-2 (monitoring manual-follow-up loop) scoped as a feature.**

## 1. Cap-rate quality — FIXED (Priority 1)

**Finding:** G6 nulled implausible caps in `v_sales_comps`, so detail.js + the gov
dashboard were clean, but the exclusion was inconsistent:
- dia **dashboard** read the raw table, never checked `cap_rate_quality` (only a
  0.01–0.25 band) → implausible caps (avg ~8.4%) flowed in.
- **All cm_dialysis cap views** had no implausible gate (G6 only touched the view).
- Impact: dia TTM market cap **7.17% vs 6.83% clean (+34 bps)**; 463 dia / 816 gov
  implausible caps in the live comp set.

**Fix (applied live):**
- `dialysis.js` `normalizeSalesTxnRow`: null cap when
  `cap_rate_quality='implausible_unverified'` (mirrors `v_sales_comps`).
- `cm_dialysis_*` views: wrapped every cap expression with a null-implausible
  CASE ("null the cap, keep the row" — counts/volume unchanged). Migration
  `dialysis/20260529280000_dia_cm_views_gate_implausible_cap.sql`. All dia cap
  views verified gated + still querying.
- Gov: `v_sales_comps` + `cm_gov_market_quarterly` were **already gated** (gov
  rounds did this earlier).

**Follow-up:** the **14 gov standalone cap-detail views** (`cm_gov_cap_quartile_m`,
`core_cap_rate_dots`, `valuation_index_*`, `nm_vs_market_q`, `cost_of_capital_m`,
`returns_indexes_m`, `bid_ask_spread_*`, `cap_by_credit_q`, `cap_by_term_m`,
`net_lease_spread_q`, `value_prop_kpis`) are still ungated. Their expressions
reference `sold_cap_rate` in WHERE/FILTER/JOIN/`crh.cap_rate`-fallback contexts —
a blind replace would corrupt them, so they need a **per-view pass** (gov primary
cap is already clean, so this is detail-chart polish, not a headline error).

## 2. Lease comps — FIXED (Priority 1)

**Finding:** the lease-comps export read `v_lease_detail` unfiltered (5,733 of
12,323 leases are inactive/superseded) and picked one lease/property with a
client-side "prefer active else latest-expiration" heuristic → **superseded/stale
leases could surface as comps**, unlike `v_available_listings` (filters
`status='active'`). Plus 1,007 multi-active-lease properties with no guard.

**Fix (applied — `detail-lease-comps-fix.js`):** the lease pick now **excludes
inactive/superseded leases entirely** (a property with no active lease
contributes no lease rather than a stale one) and, among active leases, prefers
**most-recent commencement** (`lease_start DESC`, matching `v_available_listings`)
with a multi-active warning logged. This also means the rent shown is now always
the **current active lease's** rent (resolving the "stale/superseded rent"
inconsistency) rather than a superseded lease's.

**Open option (not changed — flagged):** lease comps show the active lease's **Y1
base `annual_rent`**; sales comps now show **rent-at-sale**. For a current lease,
base rent is a defensible convention, but if you want **escalated current rent**
(project Y1 → today via the property bumps, like `dia_project_rent_at_date`), say
so and I'll apply it to the export. Left unchanged to avoid silently altering a
client deliverable's rent convention.

## 3. On-market monitoring + manual follow-up — automated layer solid; manual loop = Priority 2 feature

**Automated lifecycle is well-built and currently healthy:** auto-scrape (:00) →
URL probe (:30) → promotion sweep (:45), 3-strike `unreachable` escalation,
`unverified_assumed_off` provisional lane, bot-block self-alert. Live check:
**0 orphaned unverified past the sweep window, 0 stuck `manual_review_needed`,
0 active-without-verification-due** — nothing is currently stuck.

**Gaps (latent — resilience, will bite as items accumulate):**
- **No UI/queue surface** for the 504 `unverified_assumed_off` listings the sweep
  can't deed-match (they age out of the 90-day window with no human path).
- **`manual_review_needed` never escalates** (unknown-host listings stay
  active/unclear indefinitely).
- **No general-user write-back endpoint** — only the Chrome sidebar can record a
  manual verification (`/api/entities?action=record_listing_verification`).
- **LLC research queue / stale `verification_due_at`** have no actionable UI.

**Recommended Priority-2 build (scoped, not yet done):**
1. `v_listings_needing_manual_confirmation` view + a "Listings needing
   confirmation" panel (ops.js / detail.js) listing `unverified_assumed_off`
   (and aged) listings with **Confirm sold / Mark withdrawn / Investigate**
   actions.
2. Escalation: after N `manual_review_needed` verdicts, flip to off_market or
   open a research task; surface stale `verification_due_at IS NULL`.
3. A main-app **manual verification endpoint** (reuse the entities handler /
   `lcc_record_listing_check(method='manual_user', verified_by=user.id)`) so
   confirmation isn't sidebar-only.
4. An LLC-research-queue panel (view/enrich/skip/mark-done).

---
*Companion to SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md and the
on-market / sales-comps remediation docs. Priority-1 applied live to dia
(zqzrriwuavgrquhisnoa) + gov (scknotsqkcheojiaewwh); JS deploys via Vercel.*
