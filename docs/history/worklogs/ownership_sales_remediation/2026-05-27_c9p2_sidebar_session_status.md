# Ownership & Sales Remediation — 2026-05-27 Session Status (C9 Phase 2: CoStar sidebar — FINAL writer)

Picks up after the RCM/LoopNet migration (confirmed live in main). Focus this round: **C9 Phase 2 final writer — CoStar sidebar**, which completes the writer-migration sweep.

## What landed

### 1. Root-cause fix: financing_type deed-type leak (the headline)

`upsertDomainSales` line 4719 (gov branch) built `financing_type` as:
```js
financing_type: sale.financing_type || sale.deed_type || null
```
The `|| sale.deed_type` fallback wrote the deed type ("Quit Claim Deed", "Special Warranty Deed") into the `financing_type` column whenever CoStar didn't supply a real financing type. **This is the exact leak C2A had to enrich around** — C2A's `sales_enrich_from_loans()` cron populates `financing_type` authoritatively ('cmbs'/'conventional') from `gov.loans`, but the sidebar kept re-introducing deed-type values.

Fixed at the source: dropped the `|| sale.deed_type` fallback. `deed_type` is still preserved in `deed_records` (via `upsertGovernmentDeedRecords`), so nothing is lost. This is the highest-value change of the round — it stops the leak being created in the first place.

### 2. `validateSaleIngest` backstop in `upsertDomainSales`

After `saleData` is finalized, a SaleIngestDTO is validated. **Soft enforcement** — never blocks the write (sale_date is already guarded earlier; the SQL junk-party trigger is a second line of defense). It:
- Nulls any **residual** financing_type leak (belt-and-suspenders with the line-4719 fix)
- Logs other warnings (junk buyer/seller — already cleaned by `cleanSalesPartyValue`, but logged if anything slips through)

### 3. `persistSaleContacts` routed through `validateContactIngest`

The C2-Part-B sale-contact writer previously called bare `isJunkContactName`. Now routes through `validateContactIngest`, which **also catches federal-anti-pattern names** ("U S A" / "Government" bleed-through) — broader coverage for the same skip behavior.

### Circular import — intentional + verified safe

`ingest-contract.js` imports `isJunkContactName` / `isFederalOwnerAntiPattern` from `sidebar-pipeline.js`; this round adds `sidebar-pipeline.js` → `ingest-contract.js` (for `validateSaleIngest` / `validateContactIngest`). That's a cycle, but it's **safe** because all cross-module bindings are hoisted function declarations resolved at call-time, never at module-load. Verified with a real runtime import test:
```
sidebar exports isJunkContactName: function
contract validateSaleIngest: function
contract re-exported isJunkContactName('Listing Broker'): true
validateSaleIngest financing leak: {ok:false, errors:["financing_type ... deed_type leak"]}
```
A comment in sidebar-pipeline.js documents why the cycle is safe.

## Why non-breaking

- The financing_type fix only removes a fallback that wrote wrong-column data; no correct value is lost (deed_type lives in deed_records).
- The validateSaleIngest backstop is soft (log + sanitize, never block).
- persistSaleContacts keeps its skip-on-junk-name behavior, just broader.
- No data movement, no migration, no cron, no route, no env vars.

## C9 Phase 2 — writer sweep COMPLETE

| Writer | Status |
|---|---|
| deed-parser | ✅ migrated (deed DTO) |
| OM intake promoter | ✅ migrated (contact DTO) |
| RCM/LoopNet lead-ingest | ✅ migrated (contact DTO, TS port) — needs Edge redeploy |
| CoStar sidebar | ✅ migrated (sale + contact DTO + root-cause financing_type fix) |

All five curated-write paths now route through the ingest contract. New ingestion sources implement the DTO + call `validate*`; the contract is the single anti-regression gate.

## Plan status

- ✅ **DONE** (27): F1-F4, C1, C2, C3 (N/A), C4, C6, C8, B8, B6, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (2): C5 (Phase 1 + Phase 2 prep; EXCLUDE deferred) + **C9** (Phase 1 + Phase 2 writer sweep complete; only the optional `commit_*` orchestrators remain as a "nice to have")
- ⬜ **TODO** (4): C7, B3, A8, A9

C9 is effectively complete for practical purposes — every writer validates. The orchestrator layer (commit_* that also resolves canonical entity + records provenance in one call) is a future convenience, not a gap.

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 41 | C9_phase2_sidebar_migration_2026_05_27_001 | all | 0 (writer migration) |

## Files changed

| File | Change |
|---|---|
| `api/_handlers/sidebar-pipeline.js` | financing_type leak fix (line 4719) + validateSaleIngest backstop in upsertDomainSales + validateContactIngest in persistSaleContacts + contract import |
| `docs/ownership_sales_remediation/2026-05-27_c9p2_sidebar_session_status.md` | NEW — this doc |

API file count: 12 (unchanged).

## Recommended priorities for next session

1. **C5 Phase 2 final** — grandfather-WHERE EXCLUDE constraint, moves C5 PARTIAL → DONE
2. **A9 — unified_contacts consolidation** (biggest remaining; Decision #1 dependency)
3. **B3 — deed-relink-tick** (lower priority post-A4b)
4. **C7 — SOS adapter framework** (lower priority per user pref for free SOS-direct scrapers)

The remaining 4 TODOs are the last of the 32-item plan. After them, the plan is fully delivered (modulo the C9 orchestrator nice-to-have and the C5 EXCLUDE gated on the analyst-review queue drain).
