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

## 2. G6 cap-rate exclusion — verified gap (recommend a targeted fix)

**What's solid:** the *tagging* half of G6 works — `cap_rate_quality_tick` (B5) +
the A5 retro-tag flag implausible gov cap rates as `cap_rate_quality =
'implausible_unverified'` (2,756 of 2,777 out-of-band live rows tagged).

**The gap:** the *consumer* side doesn't consume the tag. The dia `v_sales_comps`
view filters `WHERE COALESCE(exclude_from_market_metrics,false) = false` — it does
**not** filter `cap_rate_quality`. And only ~31% of out-of-band gov cap rates
carry `exclude_from_market_metrics`. So the other ~69% of implausible cap rates
**leak into comp/averaging consumers** that filter only the exclude flag. The
cap-rate-TTM aggregation behind `capital-markets.js` (`avg_cap_rate_ttm` etc.)
showed no `cap_rate_quality` filter either.

So G6 is **"tagged but not enforced downstream"** — the symptom ("implausible cap
rates pollute metrics") is only half-closed.

**Recommended fix (has a design choice — needs your call):** exclude
`cap_rate_quality = 'implausible_unverified'` from the cap-rate paths. Two options:
- **Null the cap rate, keep the row** — implausible cap rate is hidden from
  cap-rate averages, but the sale still counts in price/SF comps. *(Preferred —
  an implausible cap rate doesn't make the whole sale bad.)*
- **Exclude the whole row** — simpler, but drops the sale from price comps too.

Locations to change: `v_sales_comps` (dia + a gov equivalent if/when one exists)
and the cap-rate-TTM aggregation view/RPC behind capital-markets. Needs the
exact aggregation source pinned + UI verification, so flagged rather than changed
blind. dia impact is minimal (dia cap rates are mostly net-rent-derived,
`cap_rate_quality` largely NULL); the gov capital-markets dashboard is where it
matters.

## Net

- Drift detector: **fixed** (usable alarm again).
- G6 downstream exclusion: **verified gap** — recommend the null-the-cap-rate fix
  on the comp view + TTM aggregation, pending your choice of semantics.
- Plus the earlier-noted owner-side items (BD vault secrets, entities-layer
  growth) and product decisions (gov.unified_contacts fate, owner-entity clutter,
  engagement-sort formula).
