# Rent Intelligence Engine — Phase 2 Report (Spine + Builder)

**DB:** Dialysis_DB `zqzrriwuavgrquhisnoa` (dia) · **Repo:** life-command-center ·
**Branch:** `claude/rent-intelligence-discovery-t7t0ey` · **Date:** 2026-08-08

> **GATE:** Report-back before Phase 3 (intake-path wiring). Phase 2 is applied live and idempotent;
> nothing is wired into intake yet. Phase 4 (serving) deliberately **not** started (it follows Phase 3).

---

## What shipped (all applied live to dia + committed)

| Migration | Object |
|---|---|
| `20260808_dia_rent_intelligence_phase2_spine.sql` | `property_rent_timeline`, `tenant_lease_conventions`, `rent_confidence_ladder`, `rent_reconcile_queue`, `v_property_rent_current`; seeds |
| `..._convention_projection` | `dia_resolve_lease_convention()`, `dia_project_rent_for_tenant()`, rebuilt `dia_project_rent_at_date` (data-driven default) |
| `..._builder` / `..._builder_nearest_anchor` | `dia_build_property_rent_timeline()` (per-property, idempotent, versioned) |
| `..._driver` | `dia_build_rent_timeline_all()` (batch driver) |
| `..._nm_audit_valueprop` | `v_dia_nm_attribution_audit`, `cm_dialysis_value_prop_24m` (gated) |
| `api/_shared/rent-projection.js` | refactored to read conventions; `resolveTenantConvention()` added |

## Decisions honored

1. **Universe:** built only where a basis exists. **4,316 properties** now carry a timeline; the
   ~5,337 no-evidence properties get **no rows** (absence is signal). Coverage stats will surface
   them as the research backlog (Phase 4c).
2. **Conventions (empirical fit, n≥20):** DaVita 15/3×5/**10%-per-5** (approved; empirical annualized
   modal 2%/1yr n=339 confirms), USRC 10/2×5/**2.5%-annual** (approved), **FMC empirical 1.7%/1yr
   (n=324)** flagged low-confidence, ARA (n=4) + DCI (n=13) → fallback standard (flagged, <20). A `*`
   **generic_fallback** row (2%/1yr) replaces the retired hardcoded default. All carry `effective_from`.
3. **Finding #3 resolved at root:** the SQL `dia_project_rent_at_date` default is now **materialized
   from the `generic_fallback` convention row at migration time** (no numeric literal in code), and the
   builder + `rent-projection.js` project via `dia_project_rent_for_tenant()` / `resolveTenantConvention()`
   — both read `tenant_lease_conventions`. Verified: DaVita→$121,000, USRC→$128,008, FMC→$118,361,
   unknown→generic $121,899 over the same 10y test.
4. **Sanity gate:** rent PSF **[5,200]**; out-of-band rows → `rent_reconcile_queue` (`unit_error`,
   log-don't-drop), never silently dropped.
5. **Finding #2:** `rent_source LIKE 'projected%'` sale rows are **excluded from the evidence set**
   (self-corroboration poison) — only genuine point evidence anchors the curve.

## Timeline coverage (current version)

| basis | rows | properties | avg confidence |
|---|---|---|---|
| contract | 5,408 | 4,012 | 0.98 |
| stated | 1,344 | 1,122 | 0.79 |
| projected | 120,911 | 4,316 | 0.64 |

Evidence years keep their basis/confidence; projection fills gaps only, anchored to the **nearest
prior evidence point** (not a single global anchor).

## Builder mechanics (per property, idempotent, versioned)

1. Assemble evidence date-ordered: documented leases + `lease_escalations` (contract), genuine
   `rent_at_sale` (stated) — **excluding `projected_from_*`**.
2. Unit-normalize to annual total using RBA (`building_size`/max `leased_area`); PSF-looking values
   scaled up; `[5,200]` PSF gate → bad rows to `rent_reconcile_queue`.
3. Collapse to one evidence point/year (highest confidence, latest date).
4. Resolve tenant convention; compute lease life = start + initial + options.
5. For each year: direct evidence → its basis/confidence; else project from **nearest prior evidence**
   via `dia_project_rent_for_tenant` → `projected` (or `convention`), confidence from the ladder,
   decaying 0.05/option period beyond initial term (→0.2 in holdover).
6. Supersede prior version, insert new — `v_property_rent_current` = latest unsuperseded.

## Acceptance sample — DaVita 2011 property #22023 (round-trips)

Anchor $207,936 @2011-03 (contract, conf 1.0), DaVita 10%/5yr, 30-yr life to 2041:

| year | rent | psf | phase | basis | conf |
|---|---|---|---|---|---|
| 2011 | 207,936 | 20.19 | initial | contract | 1.00 |
| 2016 | 228,730 | 22.21 | initial | projected | 0.70 |
| 2021 | 221,450 | 21.50 | initial | **contract (evidence overrides)** | 1.00 |
| 2022 | 221,450 | 21.50 | initial | projected (from 2021) | 0.70 |
| 2026 | 243,595 | 23.65 | option_1 | projected | 0.65 |
| 2031 | 267,954 | 26.02 | option_2 | projected | 0.60 |
| 2041 | 368,372… | | month_to_month | projected | 0.20 |

Correct 10% steps, evidence beats model at 2021, post-2021 projection re-anchors to the 2021 evidence,
option-phase confidence decay. (The full synthetic resale/expansion round-trip is a **Phase 3**
acceptance — reconciliation isn't wired yet.)

## NM attribution audit (added to Phase 2 scope) — **AUDIT FAILS; value-prop NOT published**

Reconciled the Salesforce closed-won source (`sf_comp_staging` `comp_type='Internal' & status='Sold'`
= NM-brokered) against `sales_transactions.is_northmarq`. Reproducible in `v_dia_nm_attribution_audit`.

| metric | value |
|---|---|
| SF Internal-Sold, all-time | 35 |
| SF Internal-Sold, 2023-26 | **4** |
| …linked to a sale | 13 (all-time) |
| `is_northmarq=TRUE` sales 2023-26 | 53 |
| `is_northmarq=TRUE` all-time | 381 |
| total 2023-26 sales | 890 |
| 2023-26 matched staging→sale | 2 (both correctly flagged, 0 misclassified) |

**Conclusion:** the SF Internal-Sold staging is **far too sparse** (4 rows in 2023-26) to certify the
53 `is_northmarq=TRUE` flags — let alone surface NM deals hidden among the 837 market-classified. The
2/4 that matched were correct, but n=4 is no basis for a published claim. **This mirrors the SOS/SAM
"mechanism-correct, source-starved" pattern.** `cm_dialysis_value_prop_24m` is defined (pooled 24-mo
simple avg, canonical band [0.03,0.15], sample counts) but ships `published=false` — nothing reads it.
Its current read (NM 7.33% vs market 7.67%, +34bps, n=29 vs 208) is **directional only, not for
external use.** **Recommendation:** stand up a real closed-won feed (Ascendix / SF export of NM
dialysis closings 2023-26) before publishing the value-prop.

## Remaining Phase-2 follow-ups (flagged, not blockers to the gate)

1. **Convention shells (decision 3, ~2,138 tenant-known shells):** builder currently materializes
   contract/stated/projected. The cohort-median-anchored shell pass (tenant×vintage×state n≥5, conf
   0.35, hard-excluded from published charts) is designed but **not yet run** — recommend building it
   as `dia_build_rent_convention_shells()` in the same idempotent driver before Phase 4c coverage stats.
2. **Legacy view call-sites** (`v_sales_comps`, `v_ownership_history_portfolio`,
   `v_property_attributes_portfolio`, `v_loan_maturity_watch`) still call `dia_project_rent_at_date`
   with the generic-fallback default (identical 2% behavior — CM/comps unchanged, suite green). Migrating
   them to `dia_project_rent_for_tenant` (per-tenant curves) is a deliberate, separately-verifiable
   follow-up so comps cap-rate output changes are reviewed on their own.
3. **`~271 no_evidence` + `unit_error` queue** — the sanity gate correctly parked properties whose only
   rent failed [5,200] PSF; these are fixable-data review items, not losses.

## Verification

- Projection engine round-trip verified (per-tenant + generic default preserved).
- Builder round-trip verified on #22023.
- Universe built idempotently via the batch driver (resumable, per-property error isolation).
- Full JS suite: see commit (comps/CM green; pre-existing live-DB-dependent failures unrelated to this
  change noted separately).

*Awaiting review before Phase 3 (reconciliation loop + intake-path wiring).*
