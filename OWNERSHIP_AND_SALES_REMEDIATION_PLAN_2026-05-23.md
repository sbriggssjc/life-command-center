# Ownership & Sales — Remediation Plan (2026-05-23)

**Companion to:** `OWNERSHIP_AND_SALES_AUDIT_2026-05-23.md`. Gap IDs (G1–G15) referenced below map directly to §1 of the audit.

**Goal:** Move the system from "duplicates accumulate; orphans drift; entities fragment" to "the database self-cleans, ingestion writes the right thing the first time, and what's already there is fixed once and stays fixed."

## Live Status (updated as work lands)

Last updated: **2026-05-24**.

| Phase | Step | Status | Notes / log_id |
|---|---|---|---|
| F | F1 audit_run_log + helpers | ✅ DONE | LCC Opps live; 10 runs logged |
| F | F2 quarantine state columns | ✅ DONE | dia + gov live |
| F | F3 record_cleanup_provenance helper | ✅ DONE | exercised in every cleanup |
| F | F4 v_data_health_* views | ✅ DONE | v2 rev addresses join-table linkage |
| F | cap_rate_bands seed (Decision #3) | ✅ DONE | 7 classes per domain |
| C | C1 sales UNIQUE partial index | ✅ DONE | dia + gov live; verified to raise 23505 |
| C | C2 sales writer refactor (contacts/lat-long) | ⬜ TODO | bigger JS refactor |
| C | C3 deed/parcel scraper persists property_id | ✅ N/A | audit overstated; system uses join table |
| C | C4 owner-entity BEFORE INSERT trigger | ⬜ TODO | gated on A1 |
| C | C5 ownership_history EXCLUDE constraint | ⬜ TODO | gated on A6 |
| C | C6 silent-failure fix on ownership_research_queue | ✅ DONE | landed in D-13 fix on 2026-05-17; both sites in sidebar-pipeline.js neutralized to no-op with console.debug |
| C | C7 SOS adapters (TX/FL/CA/GA/NC) | ⬜ TODO | per-state code |
| C | C8 RCM/LoopNet auth fix | ⬜ TODO | flow + endpoint |
| C | C9 standard ingest contract | ⬜ TODO | TypeScript DTO refactor |
| B | B1 sales-dedup-tick | ✅ DONE | `*/15 * * * *` both domains |
| B | B2 owner-merge-tick | ✅ DONE | hourly on both domains; uses canonical clusters view (dia) / canonical_name groups (gov) + apply_owner_merge() |
| B | B3 deed-relink-tick | ⬜ TODO | small; tiny backlog left |
| B | B4 ownership-chain-tick | ✅ DONE | v_sales_chain_breaks view + nightly tick on both domains (03:45 UTC). Baselines: dia 416 breaks / 167 matches / 579 unverifiable; gov 483 breaks / 357 matches / 437 unverifiable. Alerts fire on >25 growth vs prior snapshot. |
| B | B5 cap-rate-quality-tick | ✅ DONE | nightly 03:15 UTC both domains |
| B | B6 propagate-recompute-tick | ⬜ TODO | |
| B | B7 backslide alarms | ✅ DONE | data_health_snapshots + data_health_alerts tables, snapshot tick fn + nightly 02:30 UTC cron on both domains; 4 rule checks (dup_growth, missing_price_growth, entity_growth, coverage_regression) |
| B | B8 Data Health dashboard tile | ⬜ TODO | UI work in ops.js |
| A | A1 entity dedup backfill | ✅ DONE | 35 dia (15 clusters via v_recorded_owner_canonical_clusters) + 116 gov (115 clusters via canonical_name) = 151 losers merged with FK-repoint across 9 dia / 9 gov tables; merged_into_recorded_owner_id pointer set; field-merge backfills survivor non-nulls; remaining 247 dia / 1,030 gov redundant rows are lower-confidence variants the curated canonicalizers reject |
| A | A2 sales dedup quarantine | ✅ DONE | A2a; 1,077 rows quarantined (504 dia + 573 gov) |
| A | A3 ownership-stub reclassify | ✅ DONE | A3a (3,313) + A3b (3,006) — total 6,319 reclassified |
| A | A4 deed orphan recovery | ✅ PARTIAL | A4a synced 364 dia column-backfills; 232 dia + 88 gov true orphans remain (A4b) |
| A | A5 cap-rate retro-tagging | ✅ DONE | 4,018 rows tagged (1,301 dia + 2,717 gov) |
| A | A6 ownership_history overlap cleanup | ⏳ PARTIAL | A6b (same-owner duplicate open rows) DONE: 610 dia + 249 gov rows superseded. A6a (chronological closure across different owners — 1,111 dia + tbd gov rows) still TODO. C5 EXCLUDE constraint still gated on A6a. |
| A | A7 owner→SF link backfill | ⬜ TODO | depends on A1 |
| A | A8 CoStar Contacts retroactive harvest | ⬜ TODO | depends on C2 |
| A | A9 unified_contacts consolidation in LCC Opps | ⬜ TODO | A9a + A9b per Decision #1 |

**Symptoms tracked against the original user complaint:**

| Complaint | Status |
|---|---|
| "Duplicates for the same sale on the same property" | ✅ FIXED — 0 live duplicates remain; UNIQUE index prevents new ones; cron worker catches any that slip past |
| "Missing many elements of a sales transaction" | ⏳ PARTIAL — missing-price live rows down 6,302→0 (reclassified, not abandoned); contact PII persistence (C2) still pending |

See `docs/ownership_sales_remediation/2026-05-23_track_a_progress.md` for per-run details and `docs/ownership_sales_remediation/baselines/2026-05-23_post_week0_apply.md` for the original baseline.

---

The plan is three concurrent tracks. They reinforce each other, but the **safest sequencing is C → B → A** — fix the leak before mopping the floor.

- **Track A — Backfill cleanup** of the existing ~50k sales rows and ~70k owner rows.
- **Track B — Continuous propagation** — schedule-driven workers + write-time triggers that keep the cleanup permanent.
- **Track C — Source / ingestion fixes** — change writers and schemas so bad data never lands.

A reverse-order sequencing (A first) would re-create the duplicates within a week of every CoStar sidebar session. We therefore **freeze the duplicate-prone writers** while Track C deploys, run Track A only after Track C's write-time guards are live, and let Track B operate continuously on both ends.

---

## Cross-Cutting Foundations

These are prerequisites for all three tracks; build them first (Week 0).

### F1. Sandbox + snapshot
- Snapshot dia / gov / LCC Opps databases to a `_audit_2026_05_23` schema.
- Create a `scripts/audit/` runbook directory; every cleanup step is a reversible SQL file that writes its before/after row counts to `audit_run_log`.
- Set up `audit_run_log(run_id, step, rows_before, rows_affected, rows_after, started_at, finished_at, dry_run, notes)`.

### F2. Quarantine, don't delete
- Add `transaction_state text` (e.g. `live`, `duplicate_superseded`, `ownership_stub`, `quarantined_implausible`, `needs_review`) to `sales_transactions` on both domains.
- Add `ownership_state text` (e.g. `active`, `superseded`, `orphan_no_property`, `needs_review`) to `ownership_history`.
- Every cleanup step tags rows; nothing is hard-deleted in Track A. Per decision #2 below, **`duplicate_superseded` rows are retained indefinitely** as an audit trail — no sweep job.

### F3. Run-id provenance for every cleanup write
- Reuse `field_provenance` with `source='cleanup_run_<id>'` and `confidence` matching the rule's strength.
- Required so we can revert any single cleanup step.

### F4. "Self-test" views before and after
- Build / refresh `v_data_health_sales`, `v_data_health_ownership`, `v_data_health_entities` with the DQ counts from the 2026-05-20 audit. These are the dashboard for every track.

---

## Track C — Fix at the Source (Weeks 1–4)

**Principle:** every fix here is a write-time guard. If the guard is correct, Tracks A and B both shrink permanently.

### C1. Sales ingestion: schema parity + UNIQUE guard (addresses G1, G2a, G9)
**Migration `2026053101_sales_schema_parity.sql`**
- Add to gov `sales_transactions`: `recorded_date`, `sale_notes_raw`, `sale_notes_extracted`, `cap_rate_quality`, `cap_rate_source`, `cap_rate_confidence`, `transaction_state`, `dedup_group_id uuid`.
- Add to both: `dedup_natural_key text GENERATED ALWAYS AS (concat_ws('|', property_id::text, lpad((round(sold_price/1000)*1000)::bigint::text, 12, '0'), to_char(sale_date, 'YYYY-MM'))) STORED`.
- Add partial UNIQUE index: `CREATE UNIQUE INDEX ux_sales_dedup ON sales_transactions(dedup_natural_key) WHERE transaction_state = 'live' AND property_id IS NOT NULL AND sold_price > 50000;`.
- Add CHECK: `transaction_type NOT IN ('ownership_change_stub', 'ownership_stub') OR transaction_state = 'ownership_stub'` — forces stubs out of the `live` lane.

### C2. Sales writer refactor (addresses G1, G2a, G2b)
- Replace `sidebar-pipeline.js::upsertDomainSales` two-stage match with: (1) doc_number match, (2) `dedup_natural_key` match, (3) optional fuzzy fallback that only *suggests* (writes to `sale_dedup_candidates`, doesn't insert).
- Stop NULLing the stated cap rate on non-recent sales; instead write `cap_rate_source='costar_stated'`, `cap_rate_confidence='low'` and let the resolver pick.
- Per decision #5, persist full CoStar Contacts payload. Buyer/seller `address` to their own columns on `sales_transactions` (gov: add columns); `phone`, `email`, `website` to `contacts` with `contact_source='costar_sale_contacts'`, `contact_role IN ('buyer','seller','broker')`, FK back to `sale_id`.
- Persist lat/long to `properties.latitude`/`longitude` (add columns if absent) sourced from the CoStar Public Record panel.

### C3. Deed / parcel scraper fix (addresses G3)
- Modify `src/county_scraper.py` and `src/public_record_ingest.py` to take a `property_context = {property_id, situs_address, apn}` argument from the dispatcher and persist it on every row.
- Persist `recording_date` (currently captured but 91% NULL on gov).
- Add `scrape_run_id` so a bad run can be reverted as a unit.
- Backfill is handled in Track A; the source fix prevents *new* orphans.

### C4. Owner write-time entity dedup (addresses G4, G14)
- Add `BEFORE INSERT` trigger on `recorded_owners` and `true_owners`:
  1. Compute canonical key via `resolve_company(p_name, p_mailing_address)`.
  2. If a row already exists with that canonical key, RETURN existing UUID (insert becomes no-op + writes `contact_aliases` row recording the variant).
  3. Else insert with the canonical key persisted.
- Add address-canonical matcher (already spec'd) as a secondary key.
- Extend `field_provenance` priority matrix to ownership fields: `county > sos > sidebar_costar > om_extraction > manual_edit`.

### C5. Ownership_history integrity guards (addresses G10)
- Add `EXCLUDE USING gist (property_id WITH =, daterange(ownership_start_date, COALESCE(ownership_end_date, 'infinity'::date), '[)') WITH &&)` — prevents overlapping ownership periods.
- Add CHECK `ownership_end_date IS NULL OR ownership_end_date >= ownership_start_date`.
- Add CHECK `transaction_type IN ('deed', 'gsa_lessor_change', 'sos_resolution', 'manual', 'ownership_stub')`.

### C6. Silent-failure fix on `ownership_research_queue` (addresses G11)
- Reconcile the column list between `sidebar-pipeline.js:1759–1769` / `2592–2603` and the live schema. Add a TypeScript-style DTO check at the boundary.
- Route insert errors through the existing telemetry channel; fail loud, not silent.

### C7. SOS adapter framework (addresses G5)
- Per decision #4, first cut ships TX, FL, CA, GA, NC adapters under `api/_shared/sos/<state>.ts` — covers ~70% of the 1,696 queued rows.
- Manual sidebar write-back (`POST /api/sos-writeback`) stays as the fallback for the other 45 states.
- Worker `llc-research-tick` pulls from `llc_research_queue` in batches of 25, respects per-state rate limits, writes results into `recorded_owners` via C4's trigger so dedup is automatic.
- Second-wave queue (AZ, NV, CO, TN, OH) is tracked separately and not on this plan's critical path.

### C8. RCM / LoopNet auth fix (addresses G12)
- Add `X-LCC-Key` header to the Power Automate webhook. Verify the endpoint accepts it. Replay last 7 days of inbound emails to backfill `marketing_leads`.

### C9. Standard intake contract
- New module `api/_shared/ingest-contract.ts` exporting `SaleIngestDTO`, `OwnerIngestDTO`, `DeedIngestDTO`.
- Every writer (sidebar, RCM, county scraper, OM extractor, manual) must produce a DTO and call a single `commit_*` function. That function:
  - Resolves canonical entity (C4).
  - Computes dedup key (C1).
  - Records `field_provenance` (F3).
  - Returns the resolved IDs to the caller.
- This is the long-term anti-regression mechanism — adding a new ingestion source = implementing the DTO, nothing else.

---

## Track B — Continuous Propagation (Weeks 2–6, runs forever after)

**Principle:** treat data quality as an asynchronous workload. Triggers handle the "must be perfect at write time" cases; scheduled workers handle the "best-effort, eventually consistent" cases.

### B1. Cron worker `sales-dedup-tick` (every 15 min)
- Finds groups in `sales_transactions` sharing `dedup_natural_key` with `transaction_state='live'`. Picks survivor by source priority (`county > excel_master > costar_sidebar > NULL`). Marks losers `transaction_state='duplicate_superseded'`, sets `dedup_group_id = <survivor.sale_id>`, records `field_provenance`.
- Survivor inherits any non-null fields the losers had (buyer_address, financing, cap rate quality tag) where the survivor was NULL.
- Idempotent; safe to run any frequency.

### B2. Cron worker `owner-merge-tick` (hourly)
- Scans `recorded_owners` / `true_owners` for rows whose canonical key matches another row's (catches anything the C4 trigger missed — bulk imports, race conditions). Calls the same merge routine the trigger uses; FK-repoints `sales_transactions.recorded_owner_id`, `ownership_history.recorded_owner_id`, `properties.recorded_owner_id`, `unified_contacts.recorded_owner_id`.
- Logs every merge to `entity_merge_log(merge_id, surviving_id, merged_id, reason, fk_repoint_count, run_id)`.

### B3. Cron worker `deed-relink-tick` (hourly)
- Picks `deed_records` / `parcel_records` rows with `property_id IS NULL` but a non-null `situs_address` or `apn`. Attempts to link via address normalization (already exists per `docs/architecture/address_normalization_spec.md`) or APN exact match. Writes `property_id` + records source.
- Pre-C3 rows that have neither situs nor APN go to `orphan_deed_review_queue` for manual.

### B4. Cron worker `ownership-chain-tick` (nightly)
- For every property with ≥1 sale and ≥2 owners, validates seller(N) == buyer(N-1) on the canonical-entity key. Mismatch → opens a `research_tasks` row tagged `chain_break`.
- Detects gaps where `ownership_end_date(N) < ownership_start_date(N+1)` by more than 60 days → opens `research_tasks` tagged `ownership_gap`.
- Detects ownership periods that don't cover the latest sale_date → tagged `ownership_missing_for_known_sale`.

### B5. Cron worker `cap-rate-quality-tick` (nightly) (addresses G6)
- Reads bands from `cap_rate_bands(asset_class, min_pct, max_pct, effective_from, effective_until)` (per decision #3).
- Seed bands: medical office 5–8%, industrial 5–9%, retail 6–10%, office 6–10%, dialysis 5.5–8%, government-leased 5–8%. Properties with no `asset_class` use a 3–10% fallback.
- Validates `sold_cap_rate` against `gross_rent` and `noi` where present. Tags `cap_rate_quality`:
  - `verified` — derived cap matches stated ±0.5pp.
  - `stated_only` — no rent to verify.
  - `implausible_unverified` — outside the class band.
- Comp views read only `verified` or `stated_only`.

### B6. Cron worker `propagate-recompute-tick` (nightly)
- Re-runs `propagate_sale_to_property` and `propagate_ownership_to_property` for any property touched in the past 24h. Backstops the AFTER INSERT triggers.

### B7. Backslide alarms
- Daily check: `count(*) WHERE transaction_state='live' AND duplicate_group_count > 1` should approach 0. Slack alert if it rises >5% week-over-week.
- Daily check: count of orphaned deed_records inserted in the past 24h. Should be 0 after C3 ships. Alert if >0.
- Daily check: count of new `recorded_owners` whose canonical key already existed. Should be 0 after C4 ships.

### B8. Dashboard
- New page in the ops surface (`ops.js`): "Data Health". Tiles for the §4 metrics from the audit, sparkline 30-day. Drilldowns into `v_data_health_*` views.

---

## Track A — Backfill the Existing Data (Weeks 3–8, gated on C + B)

**Principle:** every backfill step is a SQL file under `scripts/audit/backfill/` that is dry-run-able, idempotent, and reversible by querying `audit_run_log`.

### A1. Entity dedup backfill (G4, prerequisite for everything else)
- Run `resolve_company()` over all `recorded_owners` and `true_owners`. Group by canonical key. Pick survivor (lowest `created_at`).
- FK-repoint losers' references across `sales_transactions`, `ownership_history`, `properties`, `unified_contacts`, `lcc_entity_portfolio_facts`, `entities`.
- Mark losers `superseded_by = <survivor.id>`. Do not delete.
- Expected impact: ~373 dia + ~1,349 gov rows superseded; ~2/3 of DQ-4 chain breaks resolve automatically.
- **Verification:** rerun `v_data_health_entities`; expect redundancy < 1%.

### A2. Sales dedup backfill (G1)
- Run B1's dedup logic over the full history. Expect ~490 dia + ~380 gov groups consolidated.
- For each group, the survivor inherits the union of non-null fields. This recovers field completeness for free.
- **Verification:** `v_data_health_sales` duplicate-group count → < 50 total (residual edge cases).

### A3. Ownership-stub re-classification (G9)
- Find gov `sales_transactions` WHERE `sold_price IS NULL OR sold_price < 50000` AND source LIKE `%ownership_change_stub%` (5,423 rows expected).
- For each: insert a corresponding `ownership_history` row if absent, tag the sale row `transaction_state='ownership_stub'`.
- These stop appearing in comp queries (which now filter `transaction_state='live'`).
- **Verification:** `count(*) FROM sales_transactions WHERE transaction_state='live' AND sold_price IS NULL` → 0.

### A4. Deed/parcel orphan recovery (G3)
- For each orphaned deed/parcel row, attempt B3's relink. Realistic recovery rate: 30–50% (rows that captured `mailing_address` are easier than rows with only owner name).
- Unrecoverable rows go to `orphan_deed_review_queue` with the raw payload preserved. The remediation note in `SPEC_deed_county_ingestion_fix.md` is correct that the rest will require re-scraping under C3.
- **Verification:** count of recoverable orphans relinked; remaining count fed to next sprint.

### A5. Cap-rate retroactive tagging (G6)
- Run B5 once over full history. Tag every `sold_cap_rate` row. Expected: ~458 gov rows marked `implausible_unverified` and removed from `v_sales_comps_projected_rent`.
- **Verification:** average gov cap rate in metrics drops from current outlier-skewed value into a plausible band.

### A6. Ownership_history integrity backfill (G10)
- BEFORE applying the EXCLUDE constraint from C5, find existing overlaps and resolve via the canonical-entity key (most overlaps are duplicate owners under different names — A1 fixes the bulk).
- Residual real overlaps → `research_tasks` for analyst.
- Once 0 overlaps, ALTER TABLE adds the constraint (cannot apply earlier or it errors).

### A7. SF link backfill (G8, depends on A1)
- For each `recorded_owners` / `true_owners` row with `sf_account_id IS NULL`, query Salesforce by canonical name + state. Confidence-score matches:
  - ≥0.9 → auto-link.
  - 0.7–0.9 → suggested-match queue.
  - <0.7 → no action; flagged for owner-class promotion path (auto-create Account stub when owner crosses lead-priority threshold).
- **Verification:** owner→SF link coverage rises from 1.5%/20% toward ≥60% on owners with non-trivial portfolios.

### A8. CoStar Contacts retroactive harvest (G2a)
- For sales captured by sidebar in the past 6 months, re-run the contacts extractor over the cached page payloads (if cache exists; if not, skip — going-forward C2 covers new captures).

### A9. unified_contacts consolidation in LCC Opps (G7)
Per decision #1, LCC Opps becomes the single canonical hub; dia/gov contacts tables become projections.

**A9a — Promote LCC Opps to authoritative.**
- Migrate gov's 13,111 wired `unified_contacts` rows into LCC Opps `unified_contacts` (preserve `unified_id` UUIDs so existing FKs survive).
- Backfill the link columns (`gov_contact_id`, `dia_contact_id`, `recorded_owner_id`, `true_owner_id`, `sf_account_id`, `outlook_contact_id`) from the entity-dedup output (A1).
- Set up the projection-sync worker `unified-contacts-projection-tick` (runs every 5 min) that pushes diffs into per-domain `contacts` views.

**A9b — Dia projection + backfill.**
- Stand up the dia projection view / table.
- Backfill 13,964 dia properties via the projection sync.
- Verification: every dia property with an owner has a `unified_id`; LCC Opps `unified_contacts` row count = union of distinct canonical entities across both domains.

Both A9a and A9b gate on A1 (entity dedup must be done first so we don't migrate duplicates into the new authoritative store).

---

## Phasing & Dependencies

```
Week 0    F1 F2 F3 F4
Week 1    C1 C2 C3 C6 C8                ← stop the bleeding
Week 2    C4 C5 C9        B1 B2 B6 B7
Week 3    C7              B3 B4 B5 B8   A1 ← entity dedup (unlocks A2, A6, A7)
Week 4    C7 (cont.)                    A2 A3
Week 5                                  A4 A5
Week 6                                  A6 A7
Week 7                                  A8
Week 8                                  A9 + verification sweep
```

**Hard dependencies:**
- A1 must precede A2, A6, A7 (entity dedup is foundational).
- C4 must precede A1 (trigger must be live before backfill, or the backfill recreates duplicates as new merges race against ongoing writes).
- C1 must precede A2 (UNIQUE index gives the backfill something to enforce against).
- C5 must precede A6 (the EXCLUDE constraint cannot be added with existing overlaps; A6 cleans them first, then ALTER TABLE).
- B3 / B5 / B7 should be live before opening sidebar to broker users again — otherwise we re-orphan.

---

## Success Metrics (read from `v_data_health_*`)

| Metric | Baseline | Target | Owner |
|--------|----------|--------|-------|
| Duplicate sale-groups, live | dia 490 / gov 380 | < 25 each | A2 + B1 |
| Sales with `property_id IS NULL` (gov) | 415 | < 50 | A4 + C3 |
| Sales with `sold_price IS NULL` & `transaction_state='live'` | 5,423 (gov) | 0 | A3 + C1 |
| Implausible cap rates in metrics | 458 gov | 0 | A5 + B5 + C6 |
| Orphaned deed/parcel rows | 9,402 gov / ~500 dia | < 1,500 (realistic floor) + 0 net new | A4 + C3 + B3 |
| Redundant owner rows | 373 dia / 1,349 gov | < 30 each | A1 + C4 + B2 |
| property→recorded owner coverage | 13% dia / 43% gov | ≥ 70% on both | A4 + C3 + C7 |
| Owner→SF link coverage (top decile portfolios) | 1.5–20% | ≥ 80% | A7 |
| Silent-fail `ownership_research_queue` inserts / day | unknown | 0 (alerts on >0) | C6 + B7 |
| New orphan deeds / day | unknown | 0 | C3 + B7 |

---

## Decisions Confirmed (2026-05-23)

These were the open questions from the audit's §6; all are now answered and locked into the plan.

1. **Canonical contact/entity hub: LCC Opps as single hub.** All cross-domain entity data lives in LCC Opps `unified_contacts`. dia/gov contacts tables become projections that sync from LCC Opps. A9 expands accordingly: instead of mirroring the gov pattern onto dia, A9 migrates gov's 13,111 wired rows into LCC Opps and stands up the projection sync for both domains. C9's `OwnerIngestDTO` is the canonical write path; dia/gov-side writes become projection writes only. Sequencing: migration plan now adds **Track A.9a** (LCC Opps `unified_contacts` becomes authoritative, gov migrates in) and **A.9b** (dia projection + backfill). Both gate on C4 (entity dedup trigger) so the migration does not re-fragment owners.

2. **Duplicate-superseded sales rows: kept forever as audit trail.** No sweep job. Rows tagged `transaction_state='duplicate_superseded'` are excluded from every live view, comp query, and metrics calculation but persist indefinitely with `dedup_group_id` pointing at the survivor. Storage impact is trivial (~870 rows). Maximum reversibility; investigators can always reconstruct the source of any merge. The 90-day-sweep language in F2 is therefore obsolete — the only sweep is the standard `audit_run_log` retention.

3. **Cap-rate plausibility band: per-asset-class.** Seed defaults: medical office 5–8%, industrial 5–9%, retail 6–10%, office 6–10%, dialysis 5.5–8%, government-leased 5–8%. B5's `cap-rate-quality-tick` reads from a new `cap_rate_bands(asset_class, min_pct, max_pct, effective_from, effective_until)` reference table so bands are tunable without code changes. Rows whose property lacks an `asset_class` fall back to a wide 3–10% net. A5's retroactive tagging uses the same table.

4. **SOS scraper scope: top 5 states first.** C7 ships TX, FL, CA, GA, NC adapters (covers ~70% of the 1,696 queued rows). Manual sidebar write-back stays as the fallback for the other 45 states. A second-wave plan (AZ, NV, CO, TN, OH) is queued for after the first 5 are stable; not on this plan's critical path.

5. **CoStar Contacts persistence: full persistence approved.** C2 and A8 persist phone, email, website, and address from the CoStar Contacts tab to `contacts` with `contact_source='costar_sale_contacts'`, `contact_role IN ('buyer','seller','broker')`, and FK back to the originating `sale_id`. No feature flag needed.

---

## Reversibility & Risk

- Every Track A step is reversible from `audit_run_log` + `field_provenance` writes within the run-id window.
- Track B workers are idempotent and stateless beyond their own logs; can be paused via env flag without data loss.
- Track C migrations are forward-only but each has a rollback `.down.sql` for the schema change (the writer behaviour change is reverted via feature flag).
- Highest-risk single step: A1 entity-dedup FK-repointing — touches ~3 tables × ~6,000 rows. Stage on a clone first, diff the FK counts before promoting.

---

*Plan prepared 2026-05-23. Direct extension of `OWNERSHIP_AND_SALES_AUDIT_2026-05-23.md`.*
