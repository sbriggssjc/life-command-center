# Data Quality — Lease Duplicates + Property-Owner Accuracy (2026-07-31)

Scott flagged data quality as the top priority, specifically **property-owner accuracy** and the
**lease duplicate issue**. This is the audit + what shipped + what needs his call.

## A. Lease duplicates — FIXED at source (Dialysis_DB)

**Root cause (two layers):**
1. `v_lease_detail` selected **all** leases — it exposed `superseded_at` / `is_active` as columns but
   never filtered on them, so superseded/inactive history leaked into the property tab's limit-5 fetch.
2. The client dedup (`_udFilterAndDedupeLeases`) keys on the tenant **string**, so the *same* lease under
   a friendly name ("DaVita Kidney Care") vs a full legal name ("DVA Healthcare Renal Care, Inc.") both
   survived → shown as two leases.

**Fix 1 (broad):** `v_lease_detail` now returns **live leases only** (`superseded_at IS NULL AND
is_active`), ordered best-first (documented > estimated > inferred, then has-rent, then newest). The view
dropped from **12,818 → 6,594 rows**, and multi-lease properties from thousands → **8**.

**Fix 2 (targeted, reversible):** superseded 7 redundant same-lease rows on the 6 properties where the
duplicate carried **consistent rent** (underwriting unaffected), keeping the documented/most-complete row
(25336, 31115, 34043, 35724, 35749, 35766). Migration + reversal SQL:
`migrations/dialysis_db/20260731_lease_dedup_v_lease_detail_live_only.sql`.

**⚠️ Needs Scott's call — 2 properties with materially conflicting values (NOT auto-deduped):**
- **Property 23772 (DaVita):** lease 25381 (exp **2032**, $133,937, documented) vs 16314 (exp **2035**,
  $139,000, *future 2025 start*, inferred). The 3-year expiration gap suggests this may be a **renewal**,
  not a duplicate — which one is current?
- **Property 31964 (DaVita):** lease 25384 ($206,108) vs 18657 ($68,252) — a **3× rent gap**. Both
  documented. Which rent is correct?

## B. Property-owner accuracy — AUDIT (no data changed yet; needs direction)

**Coverage:** 1,799 of 4,854 assets resolved (**37%**). Source mix: relationship_graph 1,767 (avg conf
0.88), sf_seller 23, manual 8, rel_owns 1. Of the gap: ~1,019 assets have evidence but no candidate
cleared the 0.55 confidence bar; ~2,036 assets have **no owner evidence at all**.

**Accuracy — the operator-as-owner error class (the P0.1 failure, recurring in the data):**
A handful of resolved "owners" are actually **operators/tenants**, not owners:
- `DaVita HealthCare Prtnrs` — **3 assets** (conf 1.00, relationship_graph)
- `Fresenius Medical Care` — 1 asset (conf 0.63)
- Borderline (likely real owner-SPEs, keep): `CG Davita WI LLC`, `CSRE Davita Garfield Park LLC`;
  ambiguous: `Davita Hemodialysis Center LLC`.
These come from `owns` graph edges that mis-captured the operator as owner (conf 1.00 = single candidate).

**Recommended owner-accuracy plan (needs Scott's pick):**
1. **Operator-suppression guard (accuracy, quick).** Add a known-operator exclusion to the property-owner
   feeder/reconciler so operator entities (DaVita, Fresenius, US Renal, American Renal, DCI, Satellite,
   etc.) can never resolve as *owner*; clean the ~4 clear operator-as-owner rows to "Unresolved" (per
   doctrine, Unresolved beats showing the operator). **Needs Scott's canonical operator list** (or I seed
   one from the tenant/operator columns).
2. **Deed/county feeder (coverage, bigger).** The highest-authority non-human source (`deed_recorded`,
   weight 6) is still unbuilt — this is the real lever for the 2,036 no-evidence assets and to override
   graph guesses. Connector-dependent.
3. **Re-reconcile the ~1,019 evidenced-but-unresolved** — tune the tie-break / decay so more clear cases
   clear the bar without lowering it blindly.

**Recommendation:** do #1 first (fast accuracy win, needs the operator list), then scope #2 (the coverage
lever). Holding on data changes to owners until Scott confirms the operator list, since "who owns it" is
core BD truth.
