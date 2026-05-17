#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #2, Phase A: pg_cron schedule for llc-research-tick
//                                        + AUDIT_PROGRESS.md update
// Branch: audit/02-research-queue-drain
//
// Phase A delivers ONLY the cron migration (already applied to LCC Opps via
// Supabase MCP, this file commits the .sql to the repo as the historical
// record) + the progress tracker update. Phase B (UI surfaces in gov.js and
// dialysis.js) lands as a follow-up commit on the same branch.
//
// Run from the repo root:
//   node audit/patches/02-research-queue-drain/apply.mjs --dry
//   node audit/patches/02-research-queue-drain/apply.mjs --apply
// ============================================================================

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

// ----------------------------------------------------------------------------
// FILE A: supabase/migrations/20260517140000_lcc_llc_research_tick_cron.sql
// ----------------------------------------------------------------------------
async function writeCronMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', '20260517140000_lcc_llc_research_tick_cron.sql');
  const SQL_LF = `-- ============================================================================
-- Round AUDIT-02a (2026-05-17): pg_cron schedule for lcc-llc-research-tick.
--
-- Schedules a 30-min cron on LCC Opps that POSTs to the existing Vercel/
-- Railway handler /api/admin?_route=llc-research-tick (handleLlcResearchTick
-- in api/admin.js). The handler drains llc_research_queue on both gov and
-- dia domain databases up to limit=50 rows per tick.
--
-- Feature-flag behavior:
--   • OPENCORPORATES_API_KEY set     → rows process and resolve to done /
--                                       no_match / unsupported_state.
--   • OPENCORPORATES_API_KEY unset   → handler returns handler_configured:
--                                       false; rows stay 'queued' (the
--                                       drainer never advances them, but
--                                       writes nothing destructive).
-- Per Scott's preference, the SOS-direct scraper path is deferred. While
-- the key is absent, the cron is harmless and the new UI (item #2 phase B)
-- surfaces queued rows for manual SOS-link research.
--
-- Already applied to LCC Opps (xengecqvemvfknjvbvrq) at 2026-05-17 via
-- Supabase MCP. This file commits the migration to the repo as the
-- historical record so any new environment provisioning (branch DBs,
-- restored snapshots, fresh local dev) inherits the schedule.
--
-- Reversal:
--   SELECT cron.unschedule('lcc-llc-research-tick');
--
-- Closes audit findings:
--   • A-1 (the queue-drainer half — UI half ships in phase B)
--   • B-5 (the cron half — UI half ships in phase B)
-- Refs:
--   audit:  LCC_Holistic_Audit_2026-05-17.docx, item #2 (Top-10 priority)
--   branch: audit/02-research-queue-drain
--   handler: api/admin.js:2623 handleLlcResearchTick
-- ============================================================================

-- Idempotent guard: if a job with this name already exists from a prior
-- apply, drop it before re-scheduling. cron.schedule has no IF NOT EXISTS,
-- and re-running would create a second row with the same name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-llc-research-tick') THEN
    PERFORM cron.unschedule('lcc-llc-research-tick');
  END IF;
END$$;

SELECT cron.schedule(
  'lcc-llc-research-tick',
  '*/30 * * * *',
  $$SELECT public.lcc_cron_post(
      '/api/admin?_route=llc-research-tick&domain=both&limit=50',
      '{}'::jsonb,
      'vercel'
    )$$
);

-- Sanity probe (no-op SELECT; result visible in psql but ignored by migrators)
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'lcc-llc-research-tick';
`;
  // Match repo convention: LF in migration files (Postgres-friendly).
  const SQL = SQL_LF; // no CRLF conversion needed
  if (DRY) {
    report.push(['supabase/migrations/20260517140000_lcc_llc_research_tick_cron.sql', SQL.length, 'dry-run (would create)']);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SQL, 'utf8');
  report.push(['supabase/migrations/20260517140000_lcc_llc_research_tick_cron.sql', SQL.length, 'written']);
}

// ----------------------------------------------------------------------------
// FILE B: AUDIT_PROGRESS.md — update item #2 status + log discoveries
// ----------------------------------------------------------------------------
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');

  // Read existing content; we want to update specific sections, not regen
  // the whole file (preserves any manual edits Scott may have made).
  if (!await fileExists(path)) {
    throw new Error('AUDIT_PROGRESS.md not found — item #1 should have created it.');
  }
  const original = await readFile(path, 'utf8');
  const eol = (original.match(/\r\n/g) || []).length > 0 ? '\r\n' : '\n';
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);

  let c = original;

  // ---- 1) Flip item #1 status row from 🟧 REVIEW to ✅ DONE (it merged to main)
  const item1Old = N(`| 1 | Fire \`runListingBdPipeline\` from sidebar + OM intake | \`audit/01-bd-pipeline-trigger\` | 🟧 REVIEW | A-1 (part), D-1, D-5 | CRITICAL · sidebar + OM-intake wired; pending verification |`);
  const item1New = N(`| 1 | Fire \`runListingBdPipeline\` from sidebar + OM intake | \`audit/01-bd-pipeline-trigger\` | ✅ DONE | A-1 (part), D-1, D-5 | Merged to main as commit \`60f0364\` on 2026-05-17 |`);
  const n1 = c.split(item1Old).length - 1;
  if (n1 === 1) c = c.replace(item1Old, item1New);
  else if (n1 === 0) console.warn('[audit_progress] item-1 status row not found — skipping (may already be updated)');
  else throw new Error(`item-1 row matched ${n1} times; aborting`);

  // ---- 2) Flip item #2 status to 🟨 IN PROGRESS (Phase A complete, Phase B pending)
  const item2Old = N(`| 2 | Drain \`llc_research_queue\` + \`ownership_research_queue\` (cron + UI, no scraper) | \`audit/02-research-queue-drain\` | 🟦 PENDING | A-1, B-5, D-13 | CRITICAL · scraper deferred per Scott |`);
  const item2New = N(`| 2 | Drain \`llc_research_queue\` (cron + UI, no scraper) | \`audit/02-research-queue-drain\` | 🟨 IN PROGRESS | A-1, B-5 | CRITICAL · Phase A: cron scheduled (2026-05-17). Phase B: UI surfaces. D-13 moved to item #5 — see notes below. |`);
  const n2 = c.split(item2Old).length - 1;
  if (n2 === 1) c = c.replace(item2Old, item2New);
  else if (n2 === 0) console.warn('[audit_progress] item-2 status row not found — skipping');
  else throw new Error(`item-2 row matched ${n2} times; aborting`);

  // ---- 3) Update item #5 row to absorb D-13
  const item5Old = N(`| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) | \`audit/05-provenance-integrity\` | 🟦 PENDING | A-3 | CRITICAL |`);
  const item5New = N(`| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) + sidebar→ownership_research_queue schema fix | \`audit/05-provenance-integrity\` | 🟦 PENDING | A-3, D-13 | CRITICAL · sidebar writers at sidebar-pipeline.js:1759 + :2592 have been silently failing for unknown duration (wrong columns: write \`property_id\` to a table whose schema is \`research_id\`/\`lead_id\`/\`task_type\`). Discovered 2026-05-17 during item #2 investigation. |`);
  const n5 = c.split(item5Old).length - 1;
  if (n5 === 1) c = c.replace(item5Old, item5New);
  else if (n5 === 0) console.warn('[audit_progress] item-5 status row not found — skipping');
  else throw new Error(`item-5 row matched ${n5} times; aborting`);

  // ---- 4) Append a closeout section for item #1 (with the real commit SHA)
  //         and a Phase-A closeout for item #2 + a Discoveries section.
  const appendBlock = N(`

## Closeout — item 1 — Fire runListingBdPipeline from sidebar + OM intake
- **Status:** ✅ DONE
- **Branch:** \`audit/01-bd-pipeline-trigger\`
- **Item commit:** \`7f058d6 audit(item-1): fire runListingBdPipeline from sidebar + OM intake\`
- **Merge commit:** \`60f0364 Merge audit/01-bd-pipeline-trigger: fire runListingBdPipeline from sidebar + OM intake\`
- **Merged into main:** 2026-05-17
- **Closes:** A-1 (partial — full closure pairs with item #2), D-1 ✓, D-5 ✓
- **Smoke test recommended:** Capture a CoStar listing for an asset+state with known peer-owner contacts; confirm new \`inbox_items\` rows with \`source_type='listing_bd_trigger'\`. Re-capture; confirm no duplicate inbox items.

## Closeout — item 2 — Phase A (cron migration)
- **Status:** 🟨 IN PROGRESS (Phase A landed; Phase B = UI, in flight)
- **Branch:** \`audit/02-research-queue-drain\`
- **Patch:** \`audit/patches/02-research-queue-drain/apply.mjs\`
- **Files changed:**
  - \`supabase/migrations/20260517140000_lcc_llc_research_tick_cron.sql\` — pg_cron schedule for \`lcc-llc-research-tick\` (every 30 min, calls existing handler in safe-mode without API key)
  - \`AUDIT_PROGRESS.md\` — this file
- **Migration applied via Supabase MCP** on LCC Opps (\`xengecqvemvfknjvbvrq\`) at 2026-05-17 14:42 UTC. Verified \`cron.job\` row: \`jobid=30, jobname='lcc-llc-research-tick', schedule='*/30 * * * *', active=true\`.
- **Initial queue depths at preflight (2026-05-17 14:30 UTC):**
  - dia.llc_research_queue: 1,267 queued
  - gov.llc_research_queue: 199 queued
- **Verification (post-commit):**
  1. \`grep -F "lcc-llc-research-tick" supabase/migrations/20260517140000_lcc_llc_research_tick_cron.sql\` → present
  2. (LCC Opps SQL) \`SELECT * FROM cron.job WHERE jobname='lcc-llc-research-tick'\` → 1 row, active=true
  3. Wait until the next :00 or :30 minute boundary, then \`SELECT * FROM cron.job_run_details WHERE jobid=30 ORDER BY end_time DESC LIMIT 5\` → run records appear, status='succeeded'
- **Phase B (next):** apply script that adds Owner Research Queue UI to gov.js + dialysis.js. Ranked by linked-property estimated value, sosBtns one-click SOS links, inline Mark-researched form writing back to \`recorded_owners.manager_name\`/\`registered_agent_name\`.

---

# Discoveries — 2026-05-17 (item #2 investigation)

## D-discovery-1: \`ownership_research_queue\` is a working AI pipeline, NOT a missing system

The audit doc finding **D-13** (\"ownership_research_queue has a writer; no contact-resolution worker\") was incorrect on the consumer side. The actual gov-DB table has columns \`research_id\`/\`lead_id\`/\`task_type\`/\`task_status\`/\`ai_prompt\`/\`ai_response\`/\`ai_confidence\`/\`ai_sources\`/\`human_verified\` — i.e., a full AI research + human-verification workflow, NOT a simple first-name-only broker resolver. As of 2026-05-17, the queue carries **32,437 complete / 15,662 skipped / 691 queued / 142 failed** rows across 9 task types: \`county_lookup\`, \`entity_resolution\`, \`deed_owner_verify\`, \`entity_registry_verify\`, \`parcel_verify\`, \`contact_discovery\`, \`mortgage_extract\`, \`public_record_extract\`, \`tax_mailing_verify\`. The Python file \`pipeline/ai_research.py\` is the producer/consumer; most-recent rows are from 2026-05-11, so the pipeline is actively running.

## D-discovery-2: sidebar-pipeline.js writers to ownership_research_queue have been silently failing

\`api/_handlers/sidebar-pipeline.js:1759-1769\` and \`:2592-2603\` POST to \`ownership_research_queue\` with these columns: \`property_id\`, \`address\`, \`city\`, \`state\`, \`recorded_owner_name\`, \`source\`, \`priority\`, \`status\`, \`created_at\`. **None of those columns exist on the real table** (the schema is \`research_id\`, \`lead_id\`, \`task_type\`, \`task_status\`, \`ai_prompt\`, ...). Every one of those POSTs has been failing with PostgREST 400 (\"column does not exist\"). Because \`domainQuery\` swallows non-2xx responses without throwing (the silent-write bug in finding **A-3 / D-3**), nobody noticed. Date range of the bug is unknown — needs git-blame on those two writer call sites.

**Resolution:** moved D-13 from item #2 to item #5 (\"Fix silent-write loop in sidebar-pipeline\"). When item #5 lands the silent-write fix, those writes will start surfacing errors. The writers should then be either (a) rewritten to use the correct AI-pipeline schema (\`task_type='contact_discovery'\` for first-name-only brokers, \`task_type='entity_resolution'\` for unknown true_owner), or (b) deleted as redundant since the existing Python pipeline already covers both cases.

`);

  // Append before the existing "Sprint preflight" section so the closeout
  // log stays in chronological order at the top.
  const preflightAnchor = N(`\n# Sprint preflight — 2026-05-17\n`);
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, appendBlock + preflightAnchor);
  } else {
    // Fallback: append at end of file
    c = c + appendBlock;
  }

  if (c === original) {
    report.push(['AUDIT_PROGRESS.md', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`AUDIT_PROGRESS.md (${eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  console.log(`\n=== LCC Audit Sprint — Item #2 Phase A: cron + tracker ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY (will write files)'}`);
  console.log(`Repo: ${REPO_ROOT}\n`);

  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }

  const report = [];
  await writeCronMigration(report);
  await updateAuditProgress(report);

  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(70)}  ${sign}${delta} bytes  (${note})`);
  }

  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply to write changes:\n`);
    console.log(`  node audit/patches/02-research-queue-drain/apply.mjs --apply\n`);
  } else {
    console.log(`\n✓ Apply complete. Next steps:\n`);
    console.log(`  git status`);
    console.log(`  git diff --stat`);
    console.log(`  git add -A`);
    console.log(`  git commit -F audit/patches/02-research-queue-drain/COMMIT_MSG.txt\n`);
  }
}

main().catch(err => {
  console.error(`\n❌ FAILED: ${err.message}\n`);
  console.error(`No files were modified.\n`);
  process.exit(1);
});
