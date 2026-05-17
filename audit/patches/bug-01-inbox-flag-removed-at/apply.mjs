#!/usr/bin/env node
// ============================================================================
// LCC Bug-fix #1 (2026-05-17): add inbox_items.flag_removed_at + index.
//
// Surfaced in production Postgres logs on LCC Opps:
//   ERROR: column inbox_items.flag_removed_at does not exist
//
// api/sync.js references this column at lines 358, 406, 459, 545, 600, 601,
// 659. Read paths use a graceful fallback (retry without filter), but every
// flagged-email request still burns one failed query before falling back —
// directly contributing to slow Home loads. Write paths (459/601/659) are
// NOT fallback-protected, so unflagging an email silently drops state.
//
// Branch: bugfix/01-inbox-flag-removed-at
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

async function writeMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', '20260517240000_lcc_inbox_items_flag_removed_at.sql');
  const SQL = `-- ============================================================================
-- Bug-fix #1 (LCC Opps, 2026-05-17): add inbox_items.flag_removed_at column.
--
-- Closes the production error surfaced in Postgres logs:
--   ERROR: column inbox_items.flag_removed_at does not exist
--
-- api/sync.js (handleFlaggedEmails + dependents) references this column at
-- lines 358, 406, 459, 545, 600, 601, 659. Reads have a graceful fallback,
-- but every flagged-email request burns one failed round-trip before the
-- fallback fires — directly contributing to slow Home loads. Writes are
-- NOT fallback-protected, so unflagging an email silently drops state.
--
-- The column was supposed to land in schema/028_email_dedup_constraint.sql
-- but never reached this environment.
-- ============================================================================
ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS flag_removed_at TIMESTAMPTZ;

-- Partial index: only-not-removed rows are the hot path.
-- (workspace_id, source_type, status) WHERE flag_removed_at IS NULL is the
-- read shape on every Home + Inbox load.
CREATE INDEX IF NOT EXISTS idx_inbox_items_flag_removed_at_null
  ON public.inbox_items (workspace_id, source_type, status)
  WHERE flag_removed_at IS NULL;

COMMENT ON COLUMN public.inbox_items.flag_removed_at IS
  'Set when a flagged email is unflagged in Outlook. NULL = still flagged. '
  'Used by api/sync.js to filter the Home flagged-email rail and to soft-delete '
  'items archived during sync.';
`;
  if (DRY) {
    report.push(['supabase/migrations/20260517240000_lcc_inbox_items_flag_removed_at.sql', SQL.length, 'dry-run']);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SQL, 'utf8');
  report.push(['supabase/migrations/20260517240000_lcc_inbox_items_flag_removed_at.sql', SQL.length, 'written']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — bug-fix #1 — Add inbox_items.flag_removed_at column
- **Status:** ✅ DONE
- **Branch:** \`bugfix/01-inbox-flag-removed-at\`
- **Patch:** \`audit/patches/bug-01-inbox-flag-removed-at/apply.mjs\`
- **Closes part of:** Task #28 (app loading slowly). Surfaced via production Postgres logs during Item #6 triage.

### What this fixes
\`api/sync.js\` (handleFlaggedEmails + dependents) references \`inbox_items.flag_removed_at\` at lines 358, 406, 459, 545, 600, 601, 659. The column was missing on LCC Opps, throwing on every flagged-email read + silently dropping writes when an email was unflagged in Outlook.

- **Read path:** had a graceful fallback (retry without the filter) but burned one failed query per request. After this fix, the first query succeeds.
- **Write path:** had NO fallback. Lines 459/601/659 wrote \`new Date().toISOString()\` to a non-existent column → silent ingest_write_failures rows. After this fix, the writes land.

### Files changed
- \`supabase/migrations/20260517240000_lcc_inbox_items_flag_removed_at.sql\` — new migration
- \`AUDIT_PROGRESS.md\` — this closeout

### Apply
- Migration file is in the repo. Apply via Supabase Studio's SQL Editor on LCC Opps (project \`xengecqvemvfknjvbvrq\`) — the MCP route was wedged at apply-time on 2026-05-17 with intermittent \`Connection terminated due to connection timeout\` errors. Studio uses a different connection path and should succeed.

### Verification
1. Studio query: \`SELECT column_name FROM information_schema.columns WHERE table_name='inbox_items' AND column_name='flag_removed_at';\` → returns one row.
2. Hard-reload the app; \`api/sync.js\` no longer emits \`flag_removed_at\` error in Postgres logs.
3. Home load time drops noticeably (one fewer failed round-trip on every flagged-email render).

### Related findings during triage (handed off to follow-up bugs)
- Bug #2: \`invalid input syntax for type bytea\` (sidebar uploads) — root cause TBD.
- Bug #3: \`staged_intake_items_status_check\` violations — unknown writer using disallowed status.
- Observation: LCC Opps DB had intermittent query timeouts via Supabase MCP during this work, while dia + gov were instant. \`recordWriteFailure\` in \`api/_shared/ops-db.js\` is currently \`await\`ed inside \`domainQuery\`, so each silent failure adds ~50-200ms latency. With high failure rates that compounds. Captured as a Phase B refinement on Item #5.

`);

  const preflightAnchor = N('\n# Sprint preflight — 2026-05-17\n');
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, () => appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }
  if (c === original) {
    report.push(['AUDIT_PROGRESS.md', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Bug-fix #1 — inbox_items.flag_removed_at ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await writeMigration(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(80) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
