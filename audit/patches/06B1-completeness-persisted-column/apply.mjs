#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #6 Phase B-1: persisted completeness column.
//
// Phase A shipped the v_property_completeness view that computes a 0-100
// score + band + missing_fields JSONB at query time. Phase B-1 persists
// the score + band as denormalized columns on the properties table on
// both dia + gov, with a refresh function + nightly pg_cron job.
//
// Why persist? The view computes ~15-17k rows of CASE statements on every
// query. The detail panel hits it once per property open (acceptable). But
// the upcoming Phase B-2 (NBA queue weighting) and Phase B-3 (list-sort
// by completeness) would need to JOIN the view on every list render —
// expensive. Persisted columns + indexes make those usages free.
//
// Migrations already applied via MCP at 2026-05-17:
//   • Dia (zqzrriwuavgrquhisnoa): 15,219/15,219 properties scored,
//     cron at 0 7 * * * (07:00 UTC nightly).
//   • Gov (scknotsqkcheojiaewwh): 17,454/17,454 properties scored,
//     cron at 5 7 * * * (07:05 UTC nightly — staggered).
//
// This patch commits the .sql files for repo provenance + updates
// AUDIT_PROGRESS.md.
//
// Branch: audit/06B1-completeness-persisted-column
// ============================================================================

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
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
async function writeFileEnsuringDir(path, content, report, label) {
  if (DRY) { report.push([label, content.length, 'dry-run']); return; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  report.push([label, content.length, 'written']);
}

const DIA_MIGRATION = `-- ============================================================================
-- Item #6 Phase B-1 (dia, 2026-05-17): persist v_property_completeness
-- scores as denormalized columns on the properties table + nightly refresh.
--
-- Unlocks:
--   • List sorting by completeness without joining the view
--   • NBA queue weighting (Phase B-2 follow-up)
--   • Detail-panel load skips the view fetch (one fewer query)
-- ============================================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS completeness_score INTEGER,
  ADD COLUMN IF NOT EXISTS completeness_band  TEXT;

COMMENT ON COLUMN public.properties.completeness_score IS
  'Item #6 Phase B-1: denormalized cache of v_property_completeness.completeness_score (0-100). '
  'Refreshed nightly via pg_cron + on-demand via refresh_property_completeness().';

COMMENT ON COLUMN public.properties.completeness_band IS
  'Item #6 Phase B-1: denormalized cache of v_property_completeness.completeness_band '
  '(excellent/good/fair/poor). Refreshed nightly via pg_cron.';

CREATE INDEX IF NOT EXISTS idx_properties_completeness_score
  ON public.properties (completeness_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_properties_completeness_band
  ON public.properties (completeness_band);

-- Refresh function: pulls from v_property_completeness and patches changed rows only.
CREATE OR REPLACE FUNCTION public.refresh_property_completeness()
RETURNS TABLE(updated_count BIGINT, total_scored BIGINT, ran_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  upd_count BIGINT;
  tot_count BIGINT;
BEGIN
  WITH upd AS (
    UPDATE public.properties p
       SET completeness_score = v.completeness_score,
           completeness_band  = v.completeness_band
      FROM public.v_property_completeness v
     WHERE v.property_id = p.property_id
       AND (p.completeness_score IS DISTINCT FROM v.completeness_score
         OR p.completeness_band  IS DISTINCT FROM v.completeness_band)
    RETURNING 1
  )
  SELECT count(*) INTO upd_count FROM upd;

  SELECT count(*) INTO tot_count
    FROM public.properties
   WHERE completeness_score IS NOT NULL;

  updated_count := upd_count;
  total_scored  := tot_count;
  ran_at        := now();
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.refresh_property_completeness() IS
  'Item #6 Phase B-1: refresh denormalized completeness columns from v_property_completeness. '
  'Only updates rows whose score or band changed. Scheduled nightly via pg_cron.';

-- Seed: run once now to populate the new columns.
SELECT * FROM public.refresh_property_completeness();

-- Schedule nightly at 07:00 UTC (low-traffic window).
-- Drop any prior schedule with this jobname first so the migration is idempotent.
SELECT cron.unschedule(jobname)
  FROM cron.job
 WHERE jobname = 'refresh_property_completeness_nightly';

SELECT cron.schedule(
  'refresh_property_completeness_nightly',
  '0 7 * * *',
  $sql$SELECT public.refresh_property_completeness();$sql$
);
`;

const GOV_MIGRATION = `-- ============================================================================
-- Item #6 Phase B-1 (gov, 2026-05-17): persist v_property_completeness
-- scores as denormalized columns on the properties table + nightly refresh.
--
-- Mirror of the dia migration. Cron staggered 5 minutes later than dia
-- so the two domains don't pile up on the same minute.
-- ============================================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS completeness_score INTEGER,
  ADD COLUMN IF NOT EXISTS completeness_band  TEXT;

COMMENT ON COLUMN public.properties.completeness_score IS
  'Item #6 Phase B-1: denormalized cache of v_property_completeness.completeness_score (0-100). '
  'Refreshed nightly via pg_cron + on-demand via refresh_property_completeness().';

COMMENT ON COLUMN public.properties.completeness_band IS
  'Item #6 Phase B-1: denormalized cache of v_property_completeness.completeness_band '
  '(excellent/good/fair/poor). Refreshed nightly via pg_cron.';

CREATE INDEX IF NOT EXISTS idx_properties_completeness_score
  ON public.properties (completeness_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_properties_completeness_band
  ON public.properties (completeness_band);

CREATE OR REPLACE FUNCTION public.refresh_property_completeness()
RETURNS TABLE(updated_count BIGINT, total_scored BIGINT, ran_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  upd_count BIGINT;
  tot_count BIGINT;
BEGIN
  WITH upd AS (
    UPDATE public.properties p
       SET completeness_score = v.completeness_score,
           completeness_band  = v.completeness_band
      FROM public.v_property_completeness v
     WHERE v.property_id = p.property_id
       AND (p.completeness_score IS DISTINCT FROM v.completeness_score
         OR p.completeness_band  IS DISTINCT FROM v.completeness_band)
    RETURNING 1
  )
  SELECT count(*) INTO upd_count FROM upd;

  SELECT count(*) INTO tot_count
    FROM public.properties
   WHERE completeness_score IS NOT NULL;

  updated_count := upd_count;
  total_scored  := tot_count;
  ran_at        := now();
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.refresh_property_completeness() IS
  'Item #6 Phase B-1: refresh denormalized completeness columns from v_property_completeness. '
  'Only updates rows whose score or band changed. Scheduled nightly via pg_cron.';

-- Seed: run once now
SELECT * FROM public.refresh_property_completeness();

-- Schedule nightly at 07:05 UTC (5 minutes after dia, to spread cron load)
SELECT cron.unschedule(jobname)
  FROM cron.job
 WHERE jobname = 'refresh_property_completeness_nightly';

SELECT cron.schedule(
  'refresh_property_completeness_nightly',
  '5 7 * * *',
  $sql$SELECT public.refresh_property_completeness();$sql$
);
`;

async function writeDiaMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260517270000_dia_property_completeness_persisted.sql');
  await writeFileEnsuringDir(path, DIA_MIGRATION, report,
    'supabase/migrations/dialysis/20260517270000_dia_property_completeness_persisted.sql');
}

async function writeGovMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260517270000_gov_property_completeness_persisted.sql');
  await writeFileEnsuringDir(path, GOV_MIGRATION, report,
    'supabase/migrations/government/20260517270000_gov_property_completeness_persisted.sql');
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 6 Phase B-1 — persisted completeness column + nightly refresh
- **Status:** ✅ DONE (B-1 of 3 in Item #6 Phase B). B-2 (NBA queue weighting) + B-3 (list-sort UI) queued as follow-ups.
- **Branch:** \`audit/06B1-completeness-persisted-column\`
- **Patch:** \`audit/patches/06B1-completeness-persisted-column/apply.mjs\`
- **Closes:** the persistence half of B-15. Unlocks NBA queue weighting + list-sort by completeness as cheap follow-ups.

### What this adds (both DBs)
- New columns on \`public.properties\`: \`completeness_score INTEGER\`, \`completeness_band TEXT\` — denormalized cache of the \`v_property_completeness\` view.
- Indexes: \`idx_properties_completeness_score\` (DESC NULLS LAST) + \`idx_properties_completeness_band\`.
- Function: \`public.refresh_property_completeness()\` — incrementally patches changed rows from the view. Returns \`(updated_count, total_scored, ran_at)\`.
- Cron: \`refresh_property_completeness_nightly\` — runs the function nightly at 07:00 UTC (dia) / 07:05 UTC (gov) so the two domains don't pile up on the same minute.

### Live state (verified via MCP 2026-05-17)
- **Dia:** 15,219 / 15,219 properties scored, cron schedule \`0 7 * * *\`.
- **Gov:** 17,454 / 17,454 properties scored, cron schedule \`5 7 * * *\`.

### Why persist?
The Phase A view (\`v_property_completeness\`) computes CASE expressions over ~15-17k rows on every query. For per-property reads (detail panel), the cost is fine. For list-level reads that would need to join the view for every render, the cost compounds. Persisted columns + indexes make list sorts and the NBA queue weighting free.

### Files changed
- \`supabase/migrations/dialysis/20260517270000_dia_property_completeness_persisted.sql\` (already applied via MCP)
- \`supabase/migrations/government/20260517270000_gov_property_completeness_persisted.sql\` (already applied via MCP)
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. \`SELECT count(*) FILTER (WHERE completeness_score IS NOT NULL), count(*) FROM public.properties;\` → equal numbers on each domain.
2. \`SELECT schedule, command FROM cron.job WHERE jobname = 'refresh_property_completeness_nightly';\` → returns the schedule + the refresh call.
3. \`SELECT completeness_band, count(*) FROM public.properties GROUP BY 1 ORDER BY 2 DESC;\` → distribution matches the view's distribution from Item #6 Phase A.
4. Manual refresh: \`SELECT * FROM public.refresh_property_completeness();\` → returns \`(0, <total_scored>, <ts>)\` after the seed (zero changes because the seed already aligned them).

### Follow-ups (Phase B-2 + B-3)
- **Phase B-2 — NBA queue weighting.** Modify \`v_next_best_action\` so \`gap_value\` is multiplied by \`(1 + (100 - completeness_score)/100)\` or similar, so an "almost-complete" record's open gaps rank higher than a "mostly-empty" record's same-dollar gaps. Concretely: when two properties both have a "missing_recorded_owner" gap at \$5M value, prefer the one that's 75% complete over the one that's 30% complete — because closing the owner gap on the 75% one delivers a near-finished underwriting.
- **Phase B-3 — List sort UI.** Add a "Sort by: Value · Date · Completeness" toggle to gov + dia list views, with localStorage persistence. Plus a visible completeness band chip in list rows.

`);

  const preflightAnchor = N('\n# Sprint preflight — 2026-05-17\n');
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, () => appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }
  if (c === original) { report.push(['AUDIT_PROGRESS.md', 0, 'no changes']); return; }
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Audit Sprint — Item #6 Phase B-1 (persisted completeness) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await writeDiaMigration(report);
  await writeGovMigration(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(85) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
