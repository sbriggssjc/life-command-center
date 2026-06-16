# Claude Code prompt — TIER 0: quarantine the gov junk-shell property rows (the root pollutant)

> From the deep-dive audit (`DEEP_DIVE_AUDIT_data_quality_review_and_connectivity.md`).
> Tier 0 is the highest-leverage single change: ~6,657 gov "properties" are empty-shell
> junk import rows that flood the property-merge review queue, deflate the gov connectivity
> metrics, and inflate the book. Quarantining them collapses the gov duplicate queue and
> fixes the gov metrics before any other tier runs. **GOV ONLY — dia is explicitly out of
> scope** (dia shells are real un-enriched clinics, not junk). Receipts-first; reversible;
> never hard-delete.

## Grounding (measured live, gov `scknotsqkcheojiaewwh`)
- **6,833** gov properties have NO recorded owner, NO lease, NO sale, NO listing.
- **6,657 of those (97%)** sit in **big shared-address clusters** (≥10 properties at one
  normalized address+state), with **null `lease_number`**. Examples: `3800 Charlotte Ave,
  Nashville TN` ×173, `277 looney rd, OH` ×163, `718 robinson st, NC` ×154. A spot check of
  3 clusters (490 props) found **0 distinct recorded owners, 0 leases, 1 sale, 1 listing**
  total. These are corrupted/placeholder import rows — not 173 leases, not duplicates.
- The remaining 176 gov shells (168 unique-address + 8 no-address) are NOT in this scope —
  treat them like dia un-enriched stubs (leave for review/backfill), don't quarantine.

## The junk-shell signature (the quarantine predicate)
A gov property is a junk shell iff ALL hold:
- `recorded_owner_id IS NULL`
- no row in `sales_transactions`, `leases`, or `available_listings` for its property_id
- it is a member of a same-address cluster of size **≥ 10** (normalized
  `lower(trim(address))||'|'||upper(state)`)
- `lease_number IS NULL`
- `status` is NOT already `archived` (don't double-handle)

Use ≥10 as the cluster floor (a corruption signal); never quarantine small groups or
unique-address shells. This is deliberately conservative.

## Phase 1 — AUDIT (read-only, receipts to the gate)
- Exact count matching the signature; the cluster-size distribution (how many clusters,
  their sizes); the top 20 clusters by size with their address/agency.
- **Root cause:** which `data_source` / import batch / created_at window produced these
  rows (group the shells by `data_source` and creation time). Name the leak so an ingest
  guard can stop it re-accruing.
- **Safety carve-out check (must be ZERO before quarantine):** none of the matched rows is
  referenced by the LCC BD graph in a way that would orphan real work — check LCC Opps
  `external_identities (source_type='asset', source_system='gov')`,
  `lcc_entity_portfolio_facts`, and `bd_opportunities`/cadences for any matched property_id.
  (A shell has no owner so this should be empty; prove it.)
- Report the BEFORE numbers: gov property count, gov `recorded_owner` coverage %, the gov
  `duplicate_property_address` / property_merge lane count.

## Phase 2 — SURFACE EXCLUSION (the data quarantine is ALREADY DONE)
**Verified live: all 6,657 big-cluster junk shells are already `status='archived'`** (a
prior round/cron archived them). So Phase 2 does **NOT** re-archive anything. The real bug
is that the REVIEW SURFACES don't filter archived: **6,662 of the 6,908 gov
`duplicate_property_address` issues are on archived junk** (only 246 are on active
properties). Fix the surfaces so archived junk stops appearing as review work:
- **Do NOT introduce a new status.** Verified live: the entire gov `archived` set IS this
  junk backfill — all 6,662 archived rows carry `data_source='junk_backfill_archived_
  2026-06-09'` (6,657 strict shells + 5 near-shells); there are ZERO legitimately-sold/
  merged archived gov rows to disambiguate from. The discriminator already exists
  (`status='archived'` + that `data_source`). A new enum value adds status-consumer
  regression risk for no benefit. Surface exclusion filters on `status='archived'`
  (unambiguously correct — no real archived to preserve); junk-specific needs (root-cause,
  ingest guard, un-quarantine) filter on the `data_source` tag.
- **The duplicate-address detector** (`v_data_quality_issues` and whatever the gov
  property_merge federated lane reads) must exclude `status='archived'`. This drops the gov
  duplicate-address lane from ~6,908 to **~246 active-property issues** — the genuine
  remainder.
- **Check the 5 near-shells** under the same `data_source` that don't match the strict
  signature — confirm they're also junk (vs a real property the backfill mis-archived); un-
  archive any genuine one.
- **Gov market-metric / coverage / connectivity views** that count `properties` in their
  denominator must exclude archived, so `recorded_owner` % and the book count re-baseline.
  (Grep the views reading `properties` for dup/market/coverage and add the guard.)
- **Confirm the LCC mirrors are already clean** — the R22/R23 reconcile excludes archived,
  so `lcc_property_attributes` / `lcc_property_owner_facts` should already have dropped
  these 6,657 ids. Verify (don't rebuild); if any archived shell still has a mirror row,
  run the existing `lcc_reconcile_mirrors_*`, don't fork new logic.
- **Ingest guard + root-cause (still do this):** trace which import/`data_source` created
  the clusters (Phase 1) and add a `v_data_quality_issues` detector (or writer check) that
  auto-flags/auto-archives a NEW ≥10 same-address null-lease-number no-data cluster, so the
  junk can't silently re-accrue.
- Idempotent migration(s) in `supabase/migrations/government/`; no data re-write needed
  beyond the view guards + the detector.

## Phase 3 — VERIFY (my independent gate, read-only)
- Exactly the signature set quarantined (count matches Phase 1); ZERO rows with any
  owner/lease/sale/listing touched; the 176 non-cluster shells untouched.
- gov property_merge / duplicate-address lane drops from ~6,914 toward the genuine
  remainder; gov `recorded_owner` coverage % re-baselined (denominator drops ~6,657).
- LCC mirrors self-pruned the quarantined ids on the next reconcile (or on a manual
  `lcc_reconcile_mirrors_*` run); `lcc_refresh_entity_connected_value` +
  `lcc_refresh_priority_queue_resolved` rebuild clean.
- Un-quarantine path proven on 1 row (flip status back, reason cleared) then re-applied.

## Guardrails
- GOV ONLY. dia shells (4,517 unique-address real clinics) are NOT touched — they are a
  Tier-4 backfill target.
- Never hard-delete; reversible status + provenance tag; conservative ≥10 cluster floor.
- Receipts-first: Phase 1 to the gate BEFORE Phase 2 writes. Migrations committed +
  idempotent; reuse the R22/R23 reconcile, don't fork a parallel prune.
- Root-cause the source import so the junk stops re-accruing — don't just sweep.

## After Tier 0
Re-baseline the gov metrics, then Tier 1 (detector split + provenance auto-resolve) runs on
the de-noised gov book. Update the audit doc's gov numbers with the post-quarantine
baseline.
