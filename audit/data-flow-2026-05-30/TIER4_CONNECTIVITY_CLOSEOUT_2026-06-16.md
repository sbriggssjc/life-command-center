# Tier 4 — Connectivity closeout + final baselines (2026-06-16)

Closes the five-tier deep-dive plan: de-noised detectors (Tiers 0–2), one
consolidated review surface (Tier 3), and **real connectivity filled (Tier 4)**.
As with every prior tier, live grounding corrected the audit's first-pass
numbers before any write.

## Unit 1 — gov recorded-owner metric (display + re-baseline) — DONE

The Domain Health "Property → recorded_owner" gov cell was driven by gov
`v_data_health_ownership`, whose `props` CTE counted **all-status** properties
(19,152) → it reported **44.00%**. The cell read blank in the app because the
real `govQuery` was being shadowed by the `app.js` no-op stub (no
`window.govQuery` rebind, unlike `window.diaQuery`) under a stale `gov.js?v=`.

Fixes (live + committed):
- gov `v_data_health_ownership.props` re-baselined to the **active universe**
  (`status IS DISTINCT FROM 'archived'`, the R22/R23 doctrine): recorded_owner
  **44.00% → 67.44%** (8,427 / 12,495), true_owner 37.12% → 56.90%.
  Migration `government-lease/sql/20260616_gov_tier4_unit1_data_health_active_universe.sql`.
- `gov.js`: bind `window.govQuery = govQuery` (mirror `window.diaQuery`);
  `index.html`: bump `gov.js?v=` cache-bust.

Receipt: gov cell resolves to ~67.4% on the active book; denominator excludes
the 6,657 archived shells; matches the live SQL check.

## Unit 2 — recorded-owner backfill (dia) — DONE

**Audit premise corrected (the headline):** the audit's primary dia source —
the linked CMS clinic `medicare_clinics.owner_name` — is the **OPERATOR**
(DaVita / Fresenius / US Renal Care / "Independent"), **not the landlord**.
Sample proof: property 21885 CMS="DaVita" vs real recorded owner
"A. M. Davis Mercantile Company"; 21890 CMS="DaVita" vs "Delaware Phillips
Holdings, LLC". Writing CMS owner_name into `recorded_owner_id` would record
the tenant as the landlord — a serious corruption (the gate caught this).
dia `deed_records` grantees = 0; `assessed_owner`/`tax_mailing_owner` = empty.

The clean, in-book source is the **3,344 properties already carrying a real
`recorded_owner_name`**; **3,272 linkable** after the operator + shape guard
(72 operator names correctly rejected).

Built (reusing existing machinery, not forked):
- `dia_backfill_recorded_owner_from_name(p_limit, p_dry_run default true)` —
  reuses `is_known_operator` (operator guard) + `normalize_entity_name`;
  find-or-create on `recorded_owners` (tagged `source='recorded_owner_backfill'`);
  sets `recorded_owner_id` **fill-blanks-only by IS-NULL selection** (no clobber,
  no conflict). Safe by default (dry_run true).
- `dia_recorded_owner_backfill_log` + `dia_revert_recorded_owner_backfill()` —
  full reversibility.
- Migration `supabase/migrations/dialysis/20260616_dia_tier4_unit2_recorded_owner_backfill.sql`.

Drained live (dry-run → capped real 200 → full drain), all verified:
- dia recorded-owner coverage **19.13% → 45.78%** (2,349 → 5,621).
- 3,272 links (100% intact), 2,669 owners created, **0 operator names** slipped
  the guard, full reversible log.
- Live `v_data_health_ownership` (dia) now reads 45.78%.

**Deferred follow-up:** ~6,586 properties with no owner-name signal anywhere
need external county/SOS sourcing — a separate, lower-confidence,
source-dependent project. NOT part of this tier.

## Unit 3 — SF-link (the 30k myth corrected) — DONE (the real, bounded part)

Phase A grounding killed the "0%/30k" framing:
- LCC mirrors **2,008 SF Accounts** (2,006 distinct entities) + 816 Contacts —
  i.e. ~every mirrored SF account is **already linked** to an entity.
- Unlinked: 11,069 orgs / 3,795 persons / **3,986 assets** (assets correctly
  carry 0 SF — they have no SF account).
- The realistic NEW-link ceiling is bounded by the SF-account universe, **not**
  11k orgs — and the true target requires the **live SF connector account dump**
  (not knowable from the DB).

The one DB-grounded win: **275** clean unlinked orgs normalize-name-match an
**already-SF-linked** entity → they are **duplicates**, not new links. Rolled
up, **84 merge groups** mix an SF-linked + unlinked org. Merging each into its
linked twin dedups the graph AND **inherits the SF link** (`lcc_merge_entity`
moves `external_identities` to the survivor). Merges stay **HUMAN** (no
auto-merge cron — the only merge cron is `lcc-merge-log-reconcile`, a backref
patcher).

Done (route to the human merge-review surface with the SF context):
- `v_lcc_merge_candidates` (append-only) +`sf_inheritance` / +`sf_linked_member_count`
  (migration `20260616220000_lcc_tier4_unit3_merge_sf_inheritance.sql`). 84
  SF-inheritance groups (11 auto, 73 review-only).
- `admin.js` `merge_duplicate_entities` lane now includes `sf_inheritance` groups
  (was `auto_mergeable` only → the 73 review-class SF-inheritance merges were
  invisible); ranks SF-inheritance first; carries the flag into context.
- `ops.js` card: "↪ inherits SF link" badge + meta.

**Deferred follow-up:** the full SF-link backfill (matching unlinked orgs to NEW
SF accounts) — connector-dependent, run when the live SF account dump is
available. Not built (no speculative match infra for an unknown ceiling).

## Final connectivity baselines (live 2026-06-16)

| Metric | Before | After |
|---|---|---|
| gov recorded-owner (active universe, displayed) | 44.00% (all-status) | **67.44%** (8,427 / 12,495) |
| dia recorded-owner | 19.13% (2,349) | **45.78%** (5,621) |
| SF Account links (entities) | 2,484 | unchanged — duplicates routed to human merge review (84 groups); new-link backfill deferred (connector-gated) |

## Plan status: CLOSED

Tiers 0–2 de-noised the detectors; Tier 3 consolidated the review surface;
Tier 4 filled real connectivity (gov metric, +3,272 dia owner links, the 275
duplicates → merge lane). Remaining connectivity work (the dia no-owner-data
long tail, gov ownership-history/parcel recovery, and the connector-gated
SF-link backfill) is documented as bounded follow-ups, not open audit items.
