#!/usr/bin/env node
// ============================================================================
// LCC R2-X-2 — Extend dia_merge_property to cover every property_id FK.
//
// SQL-only change. apply.mjs verifies the migration is present and
// well-formed, then appends a Round 2 closeout entry to
// audit/ROUND_2_FINDINGS_2026-05-19.md (flipping R2-X-2's status to
// 🟧 REVIEW pending live application via Supabase MCP).
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

async function verifyMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis',
    '20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql');
  if (!await fileExists(path)) throw new Error('Migration not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'CREATE OR REPLACE FUNCTION public.dia_merge_property',
    "c.contype   = 'f'",
    "c.confrelid = 'public.properties'::regclass",
    'mv_property_value_signal',
    'r2_x2_runtime_fk_discovery_2026_05_19',
    'DELETE FROM public.properties WHERE property_id = p_drop_id',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('Migration missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['dia R2-X-2 migration (runtime FK loop + MV refresh)', 0, 'verified ✓']);
}

async function updateRound2Findings(report) {
  const path = resolve(REPO_ROOT, 'audit', 'ROUND_2_FINDINGS_2026-05-19.md');
  if (!await fileExists(path)) throw new Error('ROUND_2_FINDINGS_2026-05-19.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);

  // Flip top-of-doc status line: R2-X-2 PENDING → REVIEW (in the Top 7 table)
  // and on the R2-X-2 finding header itself.
  const sentinel = 'R2-X-2 closeout (2026-05-19)';
  if (original.includes(sentinel)) {
    report.push(['ROUND_2_FINDINGS_2026-05-19.md', 0, 'already applied']);
    return;
  }

  // Append a closeout block at the bottom (the existing doc ends with the
  // Sprint 4 paragraph). The Top 7 table can be hand-flipped separately;
  // appending a closeout is the unambiguous record of what changed.
  const block = toEol(`

---

# Closeout log

## ${sentinel} — R2-X-2 dia_merge_property complete FK coverage 🟧 REVIEW
- **Branch:** \`audit/r2-x2-dia-merge-property-fk-coverage\`
- **Patch:** \`audit/patches/R2-X-2-dia-merge-property-fk-coverage/apply.mjs\`
- **Migration:** \`supabase/migrations/dialysis/20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql\`
- **Closes:** R2-X-2 (CRITICAL)
- **Pending:** R2-X-2b (gov merge_property MV refresh — gov has runtime FK loop already but no MV exists yet on gov; no migration needed today)

### Diagnosis (verified 2026-05-19)
\`dia_merge_property\` (Round 76be / 20260425240000) used a hand-coded 9-table
UPDATE list. Since April:

- Round 76ek (2026-05-08) added \`loans\` / \`property_financials\` (FK to properties).
- Round 76ek.j Phase 1 (2026-05-08) added \`llc_research_queue\` (FK to properties).
- \`cap_rate_history\`, \`property_sale_events\`, \`property_intel\`,
  \`property_cms_link\`, \`property_cms_link_history\`, \`lease_extensions\`,
  \`lease_rent_schedule\`, \`staged_intake_matches\`, \`cm_features\` all carry
  property_id columns added across the same period.

The gov mirror (\`gov_merge_property\`, Round 76be, 20260428290000) already
uses a runtime \`pg_constraint\` loop that auto-discovers every FK targeting
public.properties.property_id. The dia helper lagged behind.

### Fix
Ported the gov runtime-discovery pattern verbatim:

- Loop over \`pg_constraint\` rows where \`contype='f'\` and
  \`confrelid='public.properties'::regclass\`, EXECUTE format() per child to
  UPDATE the discovered column from p_drop_id → p_keep_id. Each per-child
  UPDATE in its own BEGIN/EXCEPTION block so a single RLS or missing-column
  edge case doesn't abort the whole merge.
- Recorded per-child row counts (and any SQLERRM) in the JSONB audit map.
- Added pre-flight existence check for both keep_id and drop_id so typos at
  call sites fail loudly instead of silently moving nothing.
- After the FK loop, REFRESH MATERIALIZED VIEW CONCURRENTLY
  \`mv_property_value_signal\` (QA-06's dia value-signal MV). Non-concurrent
  fallback if the CONCURRENTLY pre-req unique index isn't built yet.
- Bumped audit return shape with \`merge_function_version\` =
  \`r2_x2_runtime_fk_discovery_2026_05_19\` so callers can detect the new path.

### Verification (post-apply)
1. \`grep -c "c.confrelid = 'public.properties'::regclass" supabase/migrations/dialysis/20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql\` → 1
2. (Supabase MCP, dia) — sanity-check the FK discovery walks the expected universe:
   \`\`\`sql
   SELECT t.relname AS table_name, a.attname AS column_name
     FROM pg_constraint c
     JOIN pg_class      t ON t.oid = c.conrelid
     JOIN pg_namespace  n ON n.oid = t.relnamespace
     JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.properties'::regclass
      AND n.nspname = 'public'
    ORDER BY 1, 2;
   \`\`\`
   Expected: ≥14 rows (leases, available_listings, sales_transactions, contacts,
   ownership_history, parcel_records, tax_records, listing_change_events,
   property_public_records, loans, property_financials, llc_research_queue,
   cap_rate_history, property_sale_events, …). If the list is shorter than the
   prior hand-coded 9 tables, abort — the dia DB drifted.
3. (Smoke test on a staging copy) Pick two properties known to share an address
   and have child rows in each: a leases row, a loan, an llc_research_queue
   row, a cap_rate_history row. Call \`dia_merge_property(keep, drop)\` and
   assert all of those rows now point at keep and the drop properties row is gone.
4. After APPLY of the .sql via Supabase MCP, flip this entry's status from
   🟧 REVIEW to ✅ DONE in a follow-up commit and update the Top 7 table at
   the top of this doc.

### Risks considered
- **RLS denial inside the loop**: per-child SAVEPOINT means a single denial is
  surfaced in the audit JSONB but doesn't abort the merge — opposite of the
  prior hand-coded path where an unexpected EXCEPTION would have rolled back
  the whole merge. Audit JSONB key is \`<table>.<col>_error\`.
- **CASCADE FKs vs SET NULL**: the loop runs BEFORE the DELETE FROM properties,
  so it captures the row's true association with drop_id while the row still
  exists. ON DELETE SET NULL FKs (e.g. llc_research_queue.property_id) get
  re-pointed to keep_id instead of nulled. ON DELETE CASCADE FKs (e.g.
  property_financials, recorded_owners) — children are repointed first, so
  the subsequent DELETE no longer cascades into them.
- **MV refresh blocking**: CONCURRENTLY is non-blocking; the fallback non-
  concurrent path could in theory pause readers for the MV duration but only
  if the unique index is missing — a one-time edge case, not a recurring
  hazard.

### Out of scope (deferred follow-ups)
- **R2-X-2b (gov side):** gov already uses runtime FK discovery; no MV exists
  on gov today. When gov adds an MV that derives from properties, mirror this
  pattern. Add a CLAUDE.md note ("any future MV derived from gov.properties
  must be added to gov_merge_property's refresh list").
- **Provenance ghosts (R2-X-5):** the DELETE FROM properties still leaves
  field_provenance rows referencing the deleted property_id as ghosts. The
  Round 2 R2-X-5 finding (nightly cleanup cron) addresses this separately.
- **Non-FK property_id columns:** none currently exist on dia or gov per the
  pg_attribute survey on 2026-05-19. If a future writer adds a column named
  property_id WITHOUT a formal FK constraint, the loop will miss it — but
  this is the same gap the gov function has had since April and there are
  no live examples.

### Files changed
- \`supabase/migrations/dialysis/20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql\` (new)
- \`audit/ROUND_2_FINDINGS_2026-05-19.md\` — this closeout
- \`audit/patches/R2-X-2-dia-merge-property-fk-coverage/\` — patch package

No frontend. No Edge Function. No allowlist changes.
`, eol);

  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['ROUND_2_FINDINGS_2026-05-19.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC R2-X-2 — dia_merge_property complete FK coverage ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyMigration(report);
  await updateRound2Findings(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(70) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete. Next: apply the .sql via Supabase MCP on dia.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
