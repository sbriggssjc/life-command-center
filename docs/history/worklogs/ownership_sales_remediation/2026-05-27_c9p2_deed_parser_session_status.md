# Ownership & Sales Remediation — 2026-05-27 Session Status (C9 Phase 2: deed-parser)

Picks up after PR #957 (B6 propagate-recompute cron, merged + deployed). Focus this round: **C9 Phase 2 — first writer migration to the standard ingest contract**.

## Why deed-parser first

Per the C9 Phase 1 close-out doc, the migration order should be lowest-risk-first:

1. ~~CMS-sync / NPI-sync~~ — too narrow, no value as a proof-of-concept
2. ~~Manual UI edits~~ — distributed across many handlers
3. **deed-parser** ← this round
4. OM intake promoter
5. RCM/LoopNet ingest
6. CoStar sidebar pipeline

deed-parser is the smallest writer (single insert path, ~50 lines), self-contained, and its inputs are already structured (parsed deed text → known fields). Validating works of-a-shape becomes the template for the bigger writers.

## What landed

`api/_handlers/deed-parser.js::processDeedDocument` now:

1. **Imports** `validateDeedIngest` + `buildDeedDataHash` from `_shared/ingest-contract.js`
2. **Builds a DeedIngestDTO** from the parsed deed text + caller opts
3. **Calls `validateDeedIngest(dto)` before any DB I/O**
4. **Classifies validation errors** into two buckets:
   - **Hard** (skip the write — would have failed a DB CHECK):
     - `data_hash` < 24 chars (A4b CHECK)
     - dia deed missing `property_id` (Round 76ae writer guard)
     - missing `document_number` / `recording_date` (NOT NULL columns)
   - **Soft** (log + proceed — pre-C9 behavior preserved):
     - missing `state` (deed-parser sometimes lacks state context)
     - grantor/grantee matches federal anti-pattern (already filtered upstream where it matters)
     - any other error not in the hard list
5. **Uses `buildDeedDataHash()`** instead of the inline `Buffer.from(...).toString('base64')`. Identical output, but the helper is now the single source of truth for the canonical hash format.
6. **Surfaces validation_errors / validation_warnings on `result.parsed`** so callers (currently none, but the data is there) can react.

## Why this is non-breaking

The migration is purely additive observability:

- **Pre-C9 successful writes still succeed.** Validation only reports — soft errors fall through to the insert exactly as before.
- **Pre-C9 failed writes (DB CHECK rejects)** now log a clear JS-side reason BEFORE the insert. The failure mode shifts from "INSERT 4xx, lost in `ingest_write_failures`" to "console.warn with the specific contract violation, then skipped."
- **No data movement.** No rows inserted, deleted, or modified by this round.
- **No new cron, no new route, no new env vars.**

## Smoke tests (5 paths, all behaving correctly)

```text
valid dia deed (PA, full data)                  → ok: true
state-less variant                              → soft warning "state must be a 2-letter US code"
dia orphan (no property_id)                     → HARD skip "require property_id"
valid gov deed (FL, state_code only)            → ok: true
synthetic short hash (16 hex chars, A4b pattern)→ HARD skip "data_hash must be >= 24 chars"
```

The dia-orphan and synthetic-hash hard-skips would have failed the DB CHECK constraints (Round 76ae writer guard, A4b CHECK respectively) — same outcome, clearer log line.

## Plan status

- ✅ **DONE** (27): F1-F4, C1, C2, C3 (N/A), C4, C6, C8, B8, B6, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (2): C5 (Phase 1 + Phase 2 prep) + **C9** (Phase 1 + Phase 2 first writer)
- ⬜ **TODO** (4): C7, B3, A8, A9

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 38 | C9_phase2_deed_parser_migration_2026_05_27_001 | all | 0 (writer migration; no data movement) |

## Files changed

| File | Change |
|---|---|
| `api/_handlers/deed-parser.js` | Imports + DTO build + validate + hard/soft error split + use `buildDeedDataHash()` |
| `docs/ownership_sales_remediation/2026-05-27_c9p2_deed_parser_session_status.md` | NEW — this doc |

API file count: 12 (unchanged).

## Migration pattern (template for future writers)

The deed-parser refactor establishes a 5-step template:

```js
// 1. Import the contract
import { validateXIngest, buildXHelper } from '../_shared/ingest-contract.js';

// 2. Build the DTO from your source data
const dto = { domain, ...sourceFields };

// 3. Validate before any DB I/O
const { ok, errors } = validateXIngest(dto);

// 4. Split errors: hard (skip) vs soft (warn + proceed)
if (!ok) {
  const hard = errors.filter(e => e.includes('REQUIRED-SHOWSTOPPER-PATTERNS'));
  if (hard.length) {
    console.warn(`[writer] hard-skip: ${hard.join('; ')}`);
    return; // or equivalent skip
  }
  console.warn(`[writer] soft warnings: ${errors.join('; ')}`);
}

// 5. Use canonical helpers (buildXHelper) instead of inline computation
```

This is the pattern OM promoter, RCM/LoopNet, and sidebar will follow in future rounds. Each one gets its own session because the writers have side effects (provenance, downstream cascades) that need verifying separately.

## Recommended priorities for next session

1. **C9 Phase 2 next writer — OM intake promoter** (`intake-promoter.js`, single entry point, well-bounded)
2. **C5 Phase 2 final** — grandfather-WHERE EXCLUDE constraint, closes out C5 fully
3. **A9 — unified_contacts consolidation** (biggest remaining; Decision #1 dependency)
4. **B3 — deed-relink-tick** (lower priority post-A4b, but catches future orphans before they accumulate)
