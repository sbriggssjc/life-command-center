#!/usr/bin/env node
// ============================================================================
// LCC Bug-fix #2 + #3 (2026-05-17): intake pipeline schema drift on LCC Opps.
//
// Bug #2 — `invalid input syntax for type bytea`
//   schema/037_staged_intake_on_lcc_opps.sql declares
//     inline_data text
//   but the LCC Opps production DB has it as `bytea`. Every sidebar /
//   email upload that POSTs inline base64 fails the PostgREST cast.
//
//   Repair: ALTER COLUMN inline_data TYPE text USING <safe cast>. Existing
//   bytea rows get base64-encoded so no data is lost. After this, the
//   table matches the schema source of truth.
//
// Bug #3 — `staged_intake_items_status_check` violations
//   api/_handlers/intake-feedback.js lines 200–206 PATCHes statuses that
//   aren't in the CHECK list:
//     'approved' / 'corrected' → 'matched'        ❌
//     'rejected' / 'deferred'  → 'review_needed'  ❌ (typo of 'review_required')
//     'no_match'                → 'no_match'       ❌
//
//   Two-part repair:
//     1. Code fix: rename the writer values to match canonical statuses.
//        'review_needed' → 'review_required' (existing canonical value).
//        'matched' and 'no_match' are new post-feedback states; we expand
//        the CHECK to include them rather than collapse them into
//        'finalized' (which has different downstream semantics — the
//        promoter looks for it).
//     2. Migration: expand the CHECK to add 'matched' and 'no_match'.
//
// Branch: bugfix/02-03-intake-schema-drift
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
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0; let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
async function replaceUnique(path, oldStr, newStr, report, label) {
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const oldN = toEol(oldStr, eol);
  const newN = toEol(newStr, eol);
  const occ = countOccurrences(original, oldN);
  if (occ === 0) throw new Error(label + ': anchor not found in ' + path);
  if (occ > 1)  throw new Error(label + ': anchor matched ' + occ + ' times in ' + path);
  if (oldN === newN) { report.push([label, 0, 'no changes']); return; }
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function writeFileEnsuringDir(path, content, report, label) {
  if (DRY) { report.push([label, content.length, 'dry-run']); return; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  report.push([label, content.length, 'written']);
}

// ─── Migration: fix inline_data type + expand status CHECK ───
async function writeMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', '20260517250000_lcc_intake_schema_drift_repair.sql');
  const SQL = `-- ============================================================================
-- Bug-fix #2 + #3 (LCC Opps, 2026-05-17): intake pipeline schema drift repair.
--
-- Bug #2 — staged_intake_artifacts.inline_data type drift
--   schema/037_staged_intake_on_lcc_opps.sql:57 declares this column as
--   'text' (base64 payload), but production drifted to 'bytea'. Every
--   inline upload now fails with "invalid input syntax for type bytea".
--
-- Bug #3 — staged_intake_items.status CHECK is missing values the writer
--   needs. api/_handlers/intake-feedback.js PATCHes 'matched', 'no_match',
--   and (until the paired code-fix lands) 'review_needed'. Three of those
--   four are new post-feedback states with no equivalent canonical value;
--   the fourth ('review_needed') is a typo of 'review_required'.
-- ============================================================================

-- ─── Bug #2: restore inline_data to text ────────────────────────────────────
-- Use ALTER COLUMN with an explicit cast. If production rows are actually
-- bytea-typed base64 ASCII (the common case after a sloppy ALTER), the
-- convert_from path returns the original base64 text untouched. If they
-- were genuine binary, encode() base64-stringifies them, matching the
-- shape the extractor + LCC reader code expects.
DO $$
DECLARE
  current_type text;
BEGIN
  SELECT data_type INTO current_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'staged_intake_artifacts'
     AND column_name  = 'inline_data';

  IF current_type IS NULL THEN
    RAISE NOTICE 'inline_data column not found — nothing to repair';
  ELSIF current_type = 'text' THEN
    RAISE NOTICE 'inline_data already text — no migration needed';
  ELSIF current_type = 'bytea' THEN
    -- Preserve data: convert bytea -> base64 text. This matches the
    -- expected shape per schema/037 and the read code in
    -- api/_handlers/intake-extractor.js (which treats it as a base64 string).
    ALTER TABLE public.staged_intake_artifacts
      ALTER COLUMN inline_data TYPE text
      USING encode(inline_data, 'base64');
    RAISE NOTICE 'inline_data converted from bytea to text (base64-encoded existing rows)';
  ELSE
    RAISE EXCEPTION 'inline_data unexpected type: %', current_type;
  END IF;
END $$;

-- ─── Bug #3: expand status CHECK on staged_intake_items ─────────────────────
-- Add 'matched' and 'no_match' as valid post-feedback statuses. Keep all
-- existing values. ('review_needed' is being corrected to 'review_required'
-- in the paired code-fix to intake-feedback.js, so we do NOT add it.)
ALTER TABLE public.staged_intake_items
  DROP CONSTRAINT IF EXISTS staged_intake_items_status_check;

ALTER TABLE public.staged_intake_items
  ADD CONSTRAINT staged_intake_items_status_check
  CHECK (status IN (
    'queued',
    'processing',
    'review_required',
    'failed',
    'finalized',
    'discarded',
    'matched',          -- new: feedback decision = approved|corrected
    'no_match'          -- new: feedback decision = no_match
  ));

COMMENT ON CONSTRAINT staged_intake_items_status_check ON public.staged_intake_items IS
  'Allowed statuses: pre-feedback (queued, processing, review_required, failed) + ' ||
  'finalized (promoted to dia/gov) + discarded (rejected outright) + ' ||
  'matched (feedback approved/corrected) + no_match (feedback no_match).';
`;
  await writeFileEnsuringDir(path, SQL, report,
    'supabase/migrations/20260517250000_lcc_intake_schema_drift_repair.sql');
}

// ─── Code-fix: intake-feedback.js — use canonical status name ───
async function patchIntakeFeedback(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'intake-feedback.js');
  if (!await fileExists(path)) throw new Error('intake-feedback.js not found.');

  // Rename 'review_needed' -> 'review_required'. 'matched' and 'no_match'
  // stay as-is and the CHECK is expanded to accept them.
  await replaceUnique(path,
    `  const newStatus =
      decision === 'approved'  ? 'matched'
    : decision === 'corrected' ? 'matched'
    : decision === 'rejected'  ? 'review_needed'
    : decision === 'no_match'  ? 'no_match'
    : decision === 'deferred'  ? 'review_needed'
    : null;`,
    `  // Bug-fix #3 (2026-05-17): 'review_needed' was a typo of the canonical
  // 'review_required' status. The paired migration expands the CHECK to
  // accept 'matched' and 'no_match' as well, so this mapping is now
  // schema-valid for every decision path.
  const newStatus =
      decision === 'approved'  ? 'matched'
    : decision === 'corrected' ? 'matched'
    : decision === 'rejected'  ? 'review_required'
    : decision === 'no_match'  ? 'no_match'
    : decision === 'deferred'  ? 'review_required'
    : null;`,
    report, 'intake-feedback.js (status mapping)');
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — bug-fix #2 + #3 — Intake pipeline schema drift on LCC Opps
- **Status:** ✅ DONE
- **Branch:** \`bugfix/02-03-intake-schema-drift\`
- **Patch:** \`audit/patches/bug-02-03-intake-schema-drift/apply.mjs\`
- **Closes part of:** Task #29 (sidebar uploads broken). Surfaced via production Postgres logs during Item #6 triage.

### Bug #2 — \`invalid input syntax for type bytea\`
- \`schema/037_staged_intake_on_lcc_opps.sql\` line 57 declared \`inline_data text\` (base64 payload).
- Production LCC Opps drifted to \`bytea\` somewhere along the way.
- Every inline upload (sidebar, email body, Copilot) fails the PostgREST type cast on POST.
- Fix: \`ALTER COLUMN inline_data TYPE text USING encode(inline_data,'base64')\` — preserves any binary rows by base64-stringifying them to the shape the extractor expects.

### Bug #3 — \`staged_intake_items_status_check\` violations
- \`api/_handlers/intake-feedback.js\` lines 200–206 PATCHed statuses \`'matched'\`, \`'review_needed'\`, and \`'no_match'\` — none in the CHECK list.
- \`'review_needed'\` was a typo of the canonical \`'review_required'\`.
- \`'matched'\` and \`'no_match'\` are legitimate post-feedback states with no canonical equivalent.
- Two-part fix:
  1. Code: rename \`'review_needed'\` → \`'review_required'\`.
  2. Migration: expand CHECK to include \`'matched'\` and \`'no_match'\`.

### Files changed
- \`supabase/migrations/20260517250000_lcc_intake_schema_drift_repair.sql\`
- \`api/_handlers/intake-feedback.js\` — canonical status name
- \`AUDIT_PROGRESS.md\` — this closeout

### Apply
Run the migration via Supabase Studio SQL Editor on LCC Opps (project \`xengecqvemvfknjvbvrq\`). The DO-block in the migration is idempotent + safe: it inspects \`information_schema\` first and only ALTERs if needed.

### Verification
1. \`SELECT data_type FROM information_schema.columns WHERE table_name='staged_intake_artifacts' AND column_name='inline_data';\` → returns \`text\`.
2. \`SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid WHERE t.relname='staged_intake_items' AND c.conname='staged_intake_items_status_check';\` → includes \`matched\` and \`no_match\`.
3. Try a sidebar upload of a small PDF → row appears in \`staged_intake_artifacts\` with non-null \`inline_data\`. No bytea errors in Postgres logs.
4. Try the inbox-feedback "approve" / "reject" / "no_match" buttons on a staged item → no CHECK violation; status updates correctly.

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
  console.log('\n=== LCC Bug-fix #2 + #3 — Intake pipeline schema drift ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await writeMigration(report);
  await patchIntakeFeedback(report);
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
