# Ownership & Sales Remediation — 2026-05-27 Session Status (C9 Phase 1)

Picks up after PR #955 (C5 Phase 2 prep — missing_owner_data cluster drain, merged + deployed). Focus this round: **C9 — standard ingest contract (Phase 1: foundation)**.

## Scope: foundation now, writer migration later

Full C9 calls for every writer (sidebar, RCM/LoopNet, OM extractor, deed parser, county scraper, manual UI) to route through a single `commit_*` orchestrator that resolves canonical entity + computes dedup key + records `field_provenance`. That's many writer refactors at varying risk levels — not safe to land in one round.

**Phase 1 (this session)** delivers the foundation that future writers can build on, without touching existing writers:

1. **`api/_shared/ingest-contract.js`** — new module
2. **JSDoc-typed DTOs**: `SaleIngestDTO`, `OwnerIngestDTO`, `DeedIngestDTO`
3. **Validators**: `validateSaleIngest`, `validateOwnerIngest`, `validateDeedIngest` — each returns `{ok, errors[]}`
4. **Deterministic helpers**: `buildDeedDataHash`, `buildSaleDedupKey`
5. **Centralized junk filters**: re-exports of `isJunkContactName` + `isFederalOwnerAntiPattern` (now `export`-ed from sidebar-pipeline.js)

**Phase 2+ (deferred)**:
- `commitSale` / `commitOwner` / `commitDeed` orchestrators that wrap validate + canonical resolve + dedup compute + provenance record + write
- Migrating existing writers one at a time to use the orchestrators

## What the validators catch

Smoke-tested against 8 known anti-patterns from prior remediation rounds — all 8 caught:

| Anti-pattern (round it was originally fixed) | Caught by |
|---|---|
| **Sale without `sale_date`** (2026-04-27 CHECK constraint) | `validateSaleIngest` → required field error |
| **financing_type = "Quit Claim Deed"** (C2A leak — deed_type written into wrong column) | `validateSaleIngest` → allow-list error |
| **Federal anti-pattern owner name** "U S A" / "Government" (Round 76ek.i) | `validateOwnerIngest` → anti-pattern error, with `allow_federal` override for genuine cases |
| **dia.deed_records.data_hash length 16** (A4b synthetic pattern) | `validateDeedIngest` → CHECK constraint mirror |
| **dia.deed_records without property_id** (Round 76ae orphan guard) | `validateDeedIngest` → required field error |
| **Federal-anti-pattern grantor/grantee** on deeds | `validateDeedIngest` → warning |
| **Sale date 90+ days in future** | `validateSaleIngest` → likely bad source data |
| **Owner name too short** (< 3 chars) | `validateOwnerIngest` → required-length error |

These are the same patterns the C5 trigger + A4b CHECK + C2 column-discipline + Round 76ek.i / 76ae guards already enforce at the database / writer level. The contract module makes them visible to NEW writers BEFORE the database does — i.e. fail-fast in JS rather than fail-loud in SQL.

## Why this is the right "phase 1"

The plan note: *"This is the long-term anti-regression mechanism — adding a new ingestion source = implementing the DTO, nothing else."*

But "nothing else" only works once orchestrators exist + existing writers route through them. Building both halves in one round risks divergent behavior — a new writer calls `commitSale()`, an old writer calls `domainQuery('POST', 'sales_transactions', ...)`, and the two produce different `field_provenance` shapes.

Phase 1 lays the contract types + validators where any caller can pull them in incrementally. Even with no writers migrated, a code reviewer of a new feature can demand "wrap your new writer's input in `validateSaleIngest`" — that's a real anti-regression mechanism right now.

## Future-round migration path

A suggested order for Phase 2+ writer migration (lowest-risk first):

1. **CMS-sync / NPI-sync** — small surface, infrequent triggers
2. **Manual UI edits** — explicit user actions, easy to A/B
3. **Deed parser** (`api/_handlers/deed-parser.js`) — already self-contained
4. **OM intake promoter** (`api/_handlers/intake-promoter.js`) — single entry point
5. **RCM/LoopNet ingest** (Edge Function `lead-ingest`) — webhook-driven, well-bounded
6. **CoStar sidebar pipeline** (`api/_handlers/sidebar-pipeline.js`) — biggest, riskiest, save for last

After each writer migrates, verify:
- `field_provenance` row count for that source stays stable (no regression in attribution)
- `v_sales_completeness_summary` / `v_data_health_*` numbers don't drop
- Old + new writers produce identical row shapes when given the same input

## Plan status

- ✅ **DONE** (26, ↑1): F1-F4, C1, C2, C3 (N/A), C4, C6, C8, **C9 (Phase 1)**, B8, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (2): **C5** (Phase 1 + Phase 2 prep done; final EXCLUDE deferred) + **C9** (Phase 1 only; orchestrators + writer migration deferred)
- ⬜ **TODO** (5): C7, B3, B6, A8, A9

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 36 | C9_ingest_contract_phase1_2026_05_27_001 | all | 0 (infra-only) |

## Files changed

| File | Change |
|---|---|
| `api/_shared/ingest-contract.js` | NEW — DTO types + validators + helpers |
| `api/_handlers/sidebar-pipeline.js` | `export` keyword added to `isJunkContactName` + `isFederalOwnerAntiPattern` (no behavior change) |
| `docs/ownership_sales_remediation/2026-05-27_c9_session_status.md` | NEW — this doc |

API file count: 12 (unchanged — `_shared/` doesn't count toward Vercel's hobby-plan limit).

## Recommended priorities for next session

1. **B6 — propagate-recompute-tick nightly cron** (small, defensive, matches B-series pattern; could ship in one round)
2. **First C9 Phase 2 writer migration** — pick the deed-parser as the proof-of-concept (smallest writer; well-isolated)
3. **C5 Phase 2 final** — grandfather-WHERE EXCLUDE constraint (close out C5 fully)
4. **A9 — unified_contacts consolidation** (biggest remaining scope; Decision #1 dependency)
