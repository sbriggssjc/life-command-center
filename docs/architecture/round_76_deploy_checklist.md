# Round 76 Final Deploy Checklist (76m → 76p)

**Period:** 2026-04-27
**Trigger:** Task #91 audit — 0 MISMATCH but 107 duplicate_property_address issues + 13 NO_PROPERTY intakes whose 18:xx re-promotes created fresh duplicates instead of finding the property the 16:xx run had created.

## Root cause

`upsertDomainProperty` in `api/_handlers/sidebar-pipeline.js` had a write/read normalization mismatch:

- Lookup uses `normalizeAddress(address)` → `"599 Court Street"` becomes `"599 ct st"`
- Then queries `properties?address=ilike.<normAddr>` (no wildcards = exact case-insensitive match, NOT abbreviation-expanding fuzzy match)
- But `INSERT` stored the **raw un-normalized** form `"599 Court Street"`
- So next promote's lookup for `"599 ct st"` never matches the `"599 Court Street"` row → fresh duplicate row each time

Confirmed via 8 of 9 audit NO_PROPERTY intakes that each created 3 distinct property rows across 3 promote runs. The auto-merge cron's grouping function had the same gap (whitespace cleanup only, no abbreviation expansion).

## Fixes shipped

| Round | What | Where |
|---|---|---|
| 76m | `upsertDomainProperty` — Fallback 0 raw-address lookup + INSERT writes normalized form | `api/_handlers/sidebar-pipeline.js` |
| 76n | Extension tenant filter — OM section headers + compound metadata strings rejected | `extension/content/costar.js` |
| 76o | Migration — `dia_normalize_address()` SQL function; merge view + auto-merge cron use it; one-time backlog drain | `supabase/migrations/20260427120000_dia_normalize_address_for_merge.sql` |
| 76p | Refreshed `recover-final-4.ps1` to current 4 NO_PROPERTY intakes | `scripts/recover-final-4.ps1` |

## Deploy steps (in order)

1. **Push 76m–76p commits** — `git push origin main` from PowerShell. Railway picks up the api/ and scripts/ changes within ~2 minutes. Vercel doesn't need a redeploy for the migration or the extension.

2. **Apply Round 76o migration to dialysis Supabase.** Either:
   - Supabase dashboard → SQL editor → paste the migration file contents and run, OR
   - Supabase CLI: `supabase db push` from a context configured for the dialysis project.
   The migration is idempotent (CREATE OR REPLACE everywhere); safe to re-run.

3. **Reload the Chrome extension.** chrome://extensions → reload the LCC sidebar extension so the new `extension/content/costar.js` filters take effect on the next CoStar capture.

## Post-deploy verification

After all three steps:

1. **Migration drain confirmation.** The migration's tail block runs the auto-merge function up to 10×. Watch the SQL output for `auto-merge iteration N: {"merged":X,"failed":Y,"remaining_dup_groups":Z}`. Expect the first iteration to merge the bulk of the 107-issue backlog.

2. **Re-run the audit.**
   ```powershell
   .\scripts\Run-IntakeRecovery.ps1 -Mode AuditCorrectness
   ```
   Compare `NO_PROPERTY` count. Should drop from 13 toward ~4 once the migrated keep_ids replace the dropped duplicates referenced by stale promotion rows.

3. **Re-promote the final 4.**
   ```powershell
   .\scripts\recover-final-4.ps1
   ```
   Expected: 3-4 of the 4 (`2df833c4`, `78020de5`, `14ad93c9`, `b9018b18`) now promote successfully. If any still fail, look for `[upsertDomainProperty] Raw-address fallback matched:` in Vercel logs to confirm 76m is wired correctly.

4. **CoStar tenant capture spot-check.** On a CoStar property whose tenants panel includes `Loan / Financials / Changes` headers, save via the extension and verify only the real tenants appear in `entities.metadata.tenants[]` — no section-header junk.

## What to do if still broken

- **NO_PROPERTY drops to ~4 but the same 4 still fail:** likely an issue upstream of upsertDomainProperty in the multi-tenant case. Pull Vercel logs around the next `recover-final-4.ps1` run and look for failures inside `processSidebarExtraction` or `upsertDomainLeases`. Multi-tenant comma-separated `tenant_name` strings may be tripping a guard.

- **duplicate_property_address still > 50:** the auto-merge skipped these as multi-tenant. Pull `SELECT * FROM v_property_merge_candidates LIMIT 20` and review — these need human-confirmed merges via the existing UI panel.

- **Extension still capturing junk:** the `OM_SECTION_REJECT` regex is anchored `^...$` and case-insensitive. If a value slips through, it has surrounding noise (leading bullet, trailing punctuation). Note the exact captured value and we'll add it to the regex.

## Why this is closeable

The audit's headline result was **0 MISMATCH across 218 successful matches** — the pipeline doesn't send OMs to wrong properties. The duplicate-creation bug was the only systemic correctness issue and it's fixed at three layers (write normalization in 76m, merge normalization in 76o, source-of-junk in 76n). The remaining 4 NO_PROPERTY intakes are an extraction-quality tail (~1.7%) for human review, not a code regression.
