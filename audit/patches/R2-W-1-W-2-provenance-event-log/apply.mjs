#!/usr/bin/env node
// ============================================================================
// LCC R2-W-1 + R2-W-2 — provenance event log + canonicalizer source registry.
//
// Three SQL migrations, no JS changes. apply.mjs verifies each migration is
// present and well-formed and appends a closeout block to
// audit/ROUND_2_FINDINGS_2026-05-19.md.
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf   = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function verifyMigration(report, relPath, sentinels, label) {
  const path = resolve(REPO_ROOT, relPath);
  if (!await fileExists(path)) throw new Error(label + ' migration not found at ' + path);
  const src = await readFile(path, 'utf8');
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error(label + ' missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push([label, 0, 'verified ✓']);
}

async function updateRound2Findings(report) {
  const path = resolve(REPO_ROOT, 'audit', 'ROUND_2_FINDINGS_2026-05-19.md');
  if (!await fileExists(path)) throw new Error('ROUND_2_FINDINGS_2026-05-19.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);

  const sentinel = 'R2-W-1 / R2-W-2 closeout (2026-05-19)';
  if (original.includes(sentinel)) {
    report.push(['ROUND_2_FINDINGS_2026-05-19.md', 0, 'already applied']);
    return;
  }

  const block = toEol(`

## ${sentinel} — provenance event log + canonicalizer registry 🟧 REVIEW
- **Branch:** \`audit/r2-w-1-w-2-provenance-event-log\`
- **Patch:** \`audit/patches/R2-W-1-W-2-provenance-event-log/apply.mjs\`
- **Migrations (3):**
  - LCC Opps: \`supabase/migrations/20260519110000_lcc_r2_w1_canonicalizer_source_registry.sql\`
  - Dia: \`supabase/migrations/dialysis/20260519110000_dia_r2_w1_provenance_event_log_qa22_trigger.sql\`
  - Gov: \`supabase/migrations/government/20260519110000_gov_r2_w2_provenance_event_log_qa24_qa30_backfill.sql\`
- **Closes:** R2-W-1 (CRITICAL), R2-W-2 (CRITICAL)
- **Defers:** R2-W-1b / R2-W-2b (cross-DB flush cron — see Out of Scope below)

### Why three migrations

The original audit pointed out that \`lcc_merge_field\` lives on LCC Opps but
QA-22's trigger lives on dia and QA-24/QA-30's UPDATEs ran on gov. A row-level
trigger can't make a cross-DB RPC from inside a transaction. We addressed the
gap in three coordinated parts:

1. **LCC Opps** — registered three new sources in \`field_source_priority\`:
   \`qa22_davita_brand_canonicalize\`, \`qa24_canonicalize_agency\`,
   \`qa30_canonicalize_agency\`. All at priority 90 (record_only) — they're
   post-write normalizers and never compete with real ingest sources. Also
   updated the \`priority\` column COMMENT to document the new 90-99 band.

2. **Dia** — added \`public.provenance_event_log\` (target_database='dia_db')
   and rewrote \`properties_tenant_brand_canonicalize_trg\` to INSERT a log
   row whenever the canonicalizer actually rewrites NEW.tenant. Plus a
   single historical-marker row for the 2,646-row 2026-05-18 UPDATE.

3. **Gov** — added \`public.provenance_event_log\` (target_database='gov_db')
   and inserted two historical-marker rows (QA-24's 1,218 row impact,
   QA-30's 4 row impact). Gov has no canonicalize_agency trigger to upgrade
   today; the function is called from application code + one-shot
   migrations.

### Future writes are captured

After this patch lands, every future trigger-driven rewrite of
\`dia.properties.tenant\` writes an audit row to \`dia.provenance_event_log\`
with \`old_value\`, \`new_value\`, the \`record_pk_value\`, source, and a
\`trigger_op\` field so we can see whether the canonicalization happened on
INSERT or UPDATE. The flush cron (deferred — see Out of Scope) will drain
those rows into LCC Opps \`field_provenance\` so the Phase 3 strict-mode
rollout can be authored without surprise from invisible writers.

### Backward compatibility

- Existing application code paths that PATCH \`dia.properties.tenant\` are
  unchanged — the trigger still does the canonicalization and the application
  doesn't need to know about the new audit log.
- field_source_priority rows are \`record_only\` mode — they observe, do not
  block any write path.
- The historical-marker rows are visibly distinguished by
  \`record_pk_value LIKE '<bulk_backfill_%>'\` and a \`metadata.kind\` of
  \`'historical_bulk_update_marker'\` so the flush cron can choose either to
  emit them as bulk events on LCC Opps or to skip them.

### Verification (post-apply)

\`\`\`sql
-- 1. LCC Opps: three new priority rows registered
SELECT target_table, field_name, source, priority, enforce_mode
  FROM public.field_source_priority
 WHERE source IN ('qa22_davita_brand_canonicalize','qa24_canonicalize_agency','qa30_canonicalize_agency')
 ORDER BY target_table, field_name, source;
-- Expected: 3 rows, all priority=90, enforce_mode='record_only'

-- 2. Dia: table created, trigger upgraded, backfill marker present
SELECT count(*) FROM public.provenance_event_log;  -- expect ≥1
SELECT recorded_at, source, record_pk_value, metadata->>'rows_affected' AS rows
  FROM public.provenance_event_log
 WHERE record_pk_value = '<bulk_backfill_QA22>';
-- Expected: 1 row, rows='2646'

-- 3. Gov: table created, two backfill markers present
SELECT recorded_at, source, record_pk_value, metadata->>'rows_affected' AS rows
  FROM public.provenance_event_log
 WHERE record_pk_value LIKE '<bulk_backfill_QA%>'
 ORDER BY recorded_at;
-- Expected: 2 rows (QA-24 rows='1218', QA-30 rows='4')

-- 4. Trigger smoke test on dia (use a known DaVita property)
SELECT property_id, tenant FROM public.properties
 WHERE property_id = <pick_one>;
UPDATE public.properties SET tenant = 'davita Test Site'
 WHERE property_id = <pick_one>;
SELECT property_id, tenant FROM public.properties
 WHERE property_id = <pick_one>;
-- Expected: tenant is now 'DaVita Test Site'
SELECT count(*) FROM public.provenance_event_log
 WHERE record_pk_value = '<pick_one>'::text
   AND source = 'qa22_davita_brand_canonicalize'
   AND recorded_at > now() - interval '1 minute';
-- Expected: 1 row
-- Then revert the test write.
\`\`\`

### Out of scope (deferred follow-ups)

- **R2-W-1b / R2-W-2b: lcc-provenance-event-flush cron.** Drains
  \`provenance_event_log\` rows where \`flushed_to_lcc_opps_at IS NULL\` to
  LCC Opps \`field_provenance\` via a small HTTP handler that calls
  \`lcc_merge_field\` for each. Should be batched (e.g., 100 rows per tick)
  and idempotent (PATCH \`flushed_to_lcc_opps_at\` and increment
  \`flush_attempt_count\` on each attempt). pg_cron schedule on LCC Opps,
  \`*/15 * * * *\`. Deferred because we want at least one tick of
  observability on the log table before bridging to LCC Opps.

- **Gov canonicalize_agency trigger.** Today \`canonicalize_agency\` is called
  from app code + one-shot migrations. If we ever add a BEFORE INSERT/UPDATE
  trigger on \`gov.properties.agency_canonical\` (mirror of the dia QA-22
  pattern), upgrade that trigger function to write to \`provenance_event_log\`.

- **Dia QA-23 norm_text canonicalization in view layer.** QA-23 chained
  \`canonicalize_davita_brand\` into \`norm_text\` so views surface the canonical
  form even from upstream sources (\`leases.tenant\`, \`medicare_clinics.facility_name\`).
  Those reads are non-persisted — no provenance row is needed. But a future
  audit of "do view-layer canonicalizations introduce drift between view and
  base table" should consider whether to instrument them. Out of scope today.

### Files changed
- \`supabase/migrations/20260519110000_lcc_r2_w1_canonicalizer_source_registry.sql\` (new)
- \`supabase/migrations/dialysis/20260519110000_dia_r2_w1_provenance_event_log_qa22_trigger.sql\` (new)
- \`supabase/migrations/government/20260519110000_gov_r2_w2_provenance_event_log_qa24_qa30_backfill.sql\` (new)
- \`audit/patches/R2-W-1-W-2-provenance-event-log/\` (patch package)
- \`audit/ROUND_2_FINDINGS_2026-05-19.md\` — this closeout

No frontend. No JS. No Edge Function. No allowlist changes (provenance_event_log is internal).
`, eol);

  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['ROUND_2_FINDINGS_2026-05-19.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC R2-W-1 + R2-W-2 — provenance event log + canonicalizer registry ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];

  await verifyMigration(
    report,
    'supabase/migrations/20260519110000_lcc_r2_w1_canonicalizer_source_registry.sql',
    [
      "INSERT INTO public.field_source_priority",
      "'qa22_davita_brand_canonicalize'",
      "'qa24_canonicalize_agency'",
      "'qa30_canonicalize_agency'",
      "ON CONFLICT (target_table, field_name, source) DO UPDATE",
    ],
    'LCC Opps R2-W-1 source registry'
  );

  await verifyMigration(
    report,
    'supabase/migrations/dialysis/20260519110000_dia_r2_w1_provenance_event_log_qa22_trigger.sql',
    [
      'CREATE TABLE IF NOT EXISTS public.provenance_event_log',
      "target_database         text NOT NULL DEFAULT 'dia_db'",
      'CREATE OR REPLACE FUNCTION public.properties_tenant_brand_canonicalize_trg',
      "'qa22_davita_brand_canonicalize'",
      "'<bulk_backfill_QA22>'",
      'BEFORE INSERT OR UPDATE OF tenant ON public.properties',
    ],
    'Dia R2-W-1 provenance_event_log + trigger'
  );

  await verifyMigration(
    report,
    'supabase/migrations/government/20260519110000_gov_r2_w2_provenance_event_log_qa24_qa30_backfill.sql',
    [
      'CREATE TABLE IF NOT EXISTS public.provenance_event_log',
      "target_database         text NOT NULL DEFAULT 'gov_db'",
      "'qa24_canonicalize_agency'",
      "'qa30_canonicalize_agency'",
      "'<bulk_backfill_QA24>'",
      "'<bulk_backfill_QA30>'",
    ],
    'Gov R2-W-2 provenance_event_log + backfill markers'
  );

  await updateRound2Findings(report);

  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(70) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete. Next: apply all 3 .sql migrations via Supabase MCP (LCC Opps, dia, gov).\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
