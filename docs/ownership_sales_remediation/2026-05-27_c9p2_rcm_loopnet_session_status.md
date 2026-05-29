# Ownership & Sales Remediation — 2026-05-27 Session Status (C9 Phase 2: RCM/LoopNet)

Picks up after PR merging the deed-parser + OM-promoter migrations (both confirmed live in main this round — verified via `git grep validateDeedIngest / validateContactIngest origin/main`). Main also picked up an unrelated SF-sync-log retention migration (2026-05-29 disk-pressure outage fix). Focus this round: **C9 Phase 2 — third writer migration: RCM/LoopNet lead ingest**.

## What landed

The RCM/LoopNet lead path has two implementations:
- **Primary**: `supabase/functions/lead-ingest/index.ts` (Deno/TS Edge Function on Dialysis_DB) — the dispatch always proxies here first
- **Fallback**: `api/sync.js::handleRcmIngest` / `handleLoopNetIngest` (Vercel) — only hit when the Edge proxy is unreachable

Both now sanitize the parsed lead name through the ingest contract.

### TS port of the contract (Edge side)

`supabase/functions/_shared/ingest-contract.ts` — new. The Node module (`api/_shared/ingest-contract.js`) can't be imported into Deno, so the contact-validation slice is ported: `isJunkContactName`, `isFederalOwnerAntiPattern`, `validateContactIngest`. Same accepted cross-boundary duplication the availability-checker Edge Function uses for its parsers. A comment flags both copies to keep them in sync.

### `sanitizeLeadName()` applied in both paths

A new helper in each path nulls a junk/section-label or federal-anti-pattern `lead_name` (and `lead_first_name`/`lead_last_name`), keeping the lead's email/phone identity. **Never drops a lead that has an email** — name-focused, same philosophy as the OM-promoter broker migration.

Applied at:
- `lead-ingest/index.ts` → `handleRcmIngest` + `handleLoopNetIngest` (right after parse, before insert)
- `api/sync.js` → `handleRcmIngest` + `handleLoopNetIngest` (fallback)

Passes `domain: 'dialysis'` (marketing_leads lives on dia).

## Deploy step (required to activate the Edge side)

The Vercel side (`api/sync.js`) deploys automatically on merge. The **Edge Function needs a manual redeploy** — same dance as the B8 data-query allowlist:

```bash
cd life-command-center
supabase functions deploy lead-ingest --project-ref zqzrriwuavgrquhisnoa
```

Project ref is **Dialysis_DB** (`zqzrriwuavgrquhisnoa`), where lead-ingest lives. Until the redeploy, the Edge Function keeps its current behavior (no lead-name sanitization); the Vercel fallback gets it on merge. RCM currently lands ~3 leads/week through the Edge path, so the redeploy is worth doing but not urgent.

## Smoke tests (JS contract; the TS port mirrors it)

```text
junk lead name "Listing Broker" (dia)   → name error → nulled
valid lead "Jane Buyer" + email (dia)    → ok
junk name "View More" + email            → name error → nulled, email kept
```

## Plan status

- ✅ **DONE** (27): F1-F4, C1, C2, C3 (N/A), C4, C6, C8, B8, B6, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (2): C5 (Phase 1 + Phase 2 prep) + **C9** (Phase 1 + Phase 2: deed-parser, OM promoter, RCM/LoopNet)
- ⬜ **TODO** (4): C7, B3, A8, A9

## C9 Phase 2 progress

| Writer | Status |
|---|---|
| deed-parser | ✅ migrated (deed DTO) |
| OM intake promoter | ✅ migrated (contact DTO) |
| RCM/LoopNet lead-ingest | ✅ migrated (contact DTO, TS port) — **needs Edge redeploy** |
| CoStar sidebar | ⬜ last + biggest (the writers already use isJunkContactName directly; migration is mostly routing them through validate*) |

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 40 | C9_phase2_rcm_loopnet_migration_2026_05_27_001 | all | 0 (writer migration) |

## Files changed

| File | Change |
|---|---|
| `supabase/functions/_shared/ingest-contract.ts` | NEW — Deno/TS port of contact validators |
| `supabase/functions/lead-ingest/index.ts` | `sanitizeLeadName()` + applied in RCM + LoopNet handlers |
| `api/sync.js` | `sanitizeLeadName()` + applied in RCM + LoopNet fallback handlers |
| `docs/ownership_sales_remediation/2026-05-27_c9p2_rcm_loopnet_session_status.md` | NEW — this doc |

API file count: 12 (unchanged).

## Recommended priorities for next session

1. **C9 Phase 2 final writer — CoStar sidebar** (biggest; the sidebar writers already call `isJunkContactName` inline, so the migration is mostly routing the sale/owner/deed/contact writes through the `validate*` functions for consistency + the financing_type / data_hash / sale_date guards)
2. **C5 Phase 2 final** — grandfather-WHERE EXCLUDE, closes out C5
3. **A9 — unified_contacts consolidation** (biggest remaining; Decision #1 dependency)
4. **B3 — deed-relink-tick** (lower priority post-A4b)
