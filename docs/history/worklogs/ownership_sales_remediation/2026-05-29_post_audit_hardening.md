# Post-audit hardening — findings from things the audit exposed (2026-05-29)

Two follow-ups beyond the original gaps, surfaced during the remediation.

## 1. Provenance drift detector restored ✅ (fixed)

**Problem:** `v_field_provenance_unranked` (the Phase-4 alarm — "any new ingestion
write-path lacking a `field_source_priority` rule") sat permanently at **64**
rows, because the remediation's own one-shot cleanup runs record provenance with
a run-id "source" (`cleanup_run_*`). The real signal was buried in false
positives — the alarm was effectively blind.

**Fix:** excluded `source LIKE 'cleanup_run_%'` from the view (migration
`20260529220000_lcc_harden_field_provenance_unranked.sql`). **64 → 37.**

**The now-visible real signal (37):**
- **20** are `gov.gov.leases` — a **double-schema-prefix provenance bug that is
  already fixed** (R4-5, 2026-05-20; no rows after that date). These are
  historical rows aging out of the 30-day window — **no action.**
- **17** are genuine recurring-writer gaps, categorized:
  - **Structural/link fields** (`contacts.property_id` / `sale_id` / `sale_role`,
    `data_source`) — set once by one writer, **uncontested**; low value to rank.
  - **Contested data fields worth rules** — `sales_transactions.financing_type`
    (costar_sidebar; note C2A enriches this from gov.loans → loans/cmbs should
    outrank sidebar), `properties.assessed_value` (rca; county should outrank),
    `contacts.website`, `ownership_history.end_date` / `notes`.
  - **`gov.leases` fields** (expense_structure, expiration_date, tenant_agency,
    renewal_options, …) — these are governed by the **separate lease-provenance
    tiering** (`Lease_Data_Provenance_Schema_Design.md`); adding
    `field_source_priority` rules needs alignment with that system.

**Recommendation:** a small focused pass to add `field_source_priority` rules for
the contested data fields with correct ladders (and decide whether to rank or
ignore the structural link fields). Not done here to avoid guessing ladders /
duplicating the lease-provenance system. The detector is now usable as an alarm.

Audit log: `drift_detector_hygiene_2026_05_29_001`.

## 2. G6 cap-rate exclusion — downstream enforcement ✅ (fixed)

**What was solid:** the *tagging* half of G6 — `cap_rate_quality_tick` (B5) +
the A5 retro-tag flag implausible cap rates as `cap_rate_quality =
'implausible_unverified'` (tagged against an asset-class band, which is tighter
than the generic 0.04–0.12 sanity band).

**The gap (now closed):** the *consumer* side didn't consume the tag. Consumers
filtered only `exclude_from_market_metrics` (or nothing). Live data showed the
leak was real and **not** covered by the existing band filters:
- dia `v_sales_comps`: **472** live implausible cap rates surfaced as comps.
- gov `v_sale_comps` / `v_sales_comps`: surfaced raw `sold_cap_rate`.
- gov **`cm_gov_market_quarterly`** (the quarterly capital-markets cap-rate chart,
  via `cm_gov_cap_ttm_q` → `cap_rate_ttm_by_quarter`): averaged **raw
  `sold_cap_rate` with no band filter and no quality filter** — the primary leak.
- gov `cm_gov_market_quarterly_master_m` (monthly): **972** implausible rows were
  *inside* the generic 0.04–0.12 band (so the band filter missed them); **702**
  were live.

**Fix — "null the cap rate, keep the row"** (chosen semantics: an implausible cap
rate doesn't make the whole sale bad — the sale still counts in price/SF and
volume/count comps). Migrations `…230000_dia_g6_null_implausible_cap_in_comps.sql`
and `…230000_gov_g6_null_implausible_cap_rate.sql`. Applied to dia
(`zqzrriwuavgrquhisnoa`) and gov (`scknotsqkcheojiaewwh`):
- **Comp views** (dia `v_sales_comps`, gov `v_sale_comps`, gov `v_sales_comps`)
  surface the stated cap rate directly → nulled when `implausible_unverified`.
  Verified: implausible rows remain present, **0** still carry a cap rate.
- **gov `cm_gov_market_quarterly`** → `sold_cap_rate` nulled at source (excluded
  from `avg`/quartile, row still in volume/count). Headline `cm_gov_cap_ttm_q`
  stays populated and sane (recent quarters 6.8–10.7%).
- **gov `cm_gov_market_quarterly_master_m`** (TTM-A): this chain already
  band-filters **and** prefers an NOI-recalculated `cap_rate_history` value over
  the stated one (596 of the 702 in-band-live implausible rows have one, many
  high-confidence `property_noi_confirmed`). To avoid discarding those good
  recalcs, only the implausible **stated fallback** is nulled; the recalculated
  value is preserved. `cm_gov_market_quarterly_master_m_mat` refreshed.

Patches are idempotent and read the live definition via `pg_get_viewdef`, so they
adapt to orthogonal redefinitions — notably gov `v_sales_comps` was observed
flipping matview→view (+ a `transaction_state='live'` filter) by a concurrent
process mid-session; the gov patch detects relkind and branches accordingly.

Audit log: `G6_caprate_consumer_enforcement_2026_05_29_001` (audit_run_log 63).

## Net

- Drift detector: **fixed** (usable alarm again).
- G6 downstream exclusion: **fixed** — null-the-cap-rate enforcement applied to
  the dia + gov comp views and the gov capital-markets cap-rate aggregations
  (recalculated NOI cap rates preserved on the monthly chain).
- Plus the earlier-noted owner-side items (BD vault secrets, entities-layer
  growth) and product decisions (gov.unified_contacts fate, owner-entity clutter,
  engagement-sort formula).
