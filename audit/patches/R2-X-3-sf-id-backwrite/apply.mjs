#!/usr/bin/env node
// ============================================================================
// LCC R2-X-3 — Back-write SF id onto dia/gov denormalized columns.
//
// One JS change (api/_shared/bridge-handlers-salesforce.js). The edit was
// already applied by the Cowork session that authored this patch. apply.mjs
// verifies both Contact and Account handlers carry the back-write hook and
// appends a closeout block to audit/ROUND_2_FINDINGS_2026-05-19.md.
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

async function verifyHandler(report) {
  const path = resolve(REPO_ROOT, 'api', '_shared', 'bridge-handlers-salesforce.js');
  if (!await fileExists(path)) throw new Error('bridge-handlers-salesforce.js not found.');
  const src = await readFile(path, 'utf8');
  const expected = [
    "import { domainQuery } from './domain-db.js';",
    "import { normalizeCanonicalName } from './entity-link.js';",
    'async function backwriteSfIdToDomain',
    "R2-X-3 (2026-05-19): back-write sf_account_id onto dia.true_owners.salesforce_id",
    "R2-X-3 (2026-05-19): back-write sf_contact_id onto dia.contacts.salesforce_id",
    'sf_backwrite: sfBackwrite',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error(
      'bridge-handlers-salesforce.js missing R2-X-3 sentinels:\n  - ' +
      missing.join('\n  - ') +
      '\nHas the Python-via-bash edit been applied yet?'
    );
  }
  report.push(['api/_shared/bridge-handlers-salesforce.js (SF id back-write)', 0, 'verified ✓']);
}

async function updateRound2Findings(report) {
  const path = resolve(REPO_ROOT, 'audit', 'ROUND_2_FINDINGS_2026-05-19.md');
  if (!await fileExists(path)) throw new Error('ROUND_2_FINDINGS_2026-05-19.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);

  const sentinel = 'R2-X-3 closeout (2026-05-19)';
  if (original.includes(sentinel)) {
    report.push(['ROUND_2_FINDINGS_2026-05-19.md', 0, 'already applied']);
    return;
  }

  const block = toEol(`

## ${sentinel} — SF id back-write onto dia/gov denormalized columns 🟧 REVIEW
- **Branch:** \`audit/r2-x-3-sf-id-backwrite\`
- **Patch:** \`audit/patches/R2-X-3-sf-id-backwrite/apply.mjs\`
- **File changed:** \`api/_shared/bridge-handlers-salesforce.js\` (+118 lines, -2 lines)
- **Closes:** R2-X-3 (HIGH)

### Diagnosis (verified 2026-05-19)
When \`api/_shared/bridge-handlers-salesforce.js::handleSalesforceContactUpsert\`
or \`handleSalesforceAccountUpsert\` lands an SF webhook payload, it writes:
  (a) \`external_identities\` via \`linkSalesforce\` (the LCC bridge row)
  (b) \`unified_contacts.sf_contact_id\` / \`sf_account_id\` (LCC Opps cache)

It does **not** PATCH the domain-side denormalized columns:
  - \`dia.contacts.salesforce_id\`     (column exists per Round 76ak migration)
  - \`dia.true_owners.salesforce_id\`  (column exists; QA-25's
    \`v_prospect_targets\` reads it)
  - \`gov.true_owners.sf_account_id\`  (column exists; QA-25's gov view reads
    \`WHERE t.sf_account_id IS NULL\`)
  - \`gov.contacts.sf_contact_id\`     (gov-side convention)

Net effect: QA-25's "Unprospected Owners" widget on gov reads
\`sf_account_id IS NULL\` — every SF-linked owner that lands via the bridge
without back-write is mis-classified as unprospected. The metric is wrong
by the back-write gap. Same problem on dia for any dashboard that filters
on \`contacts.salesforce_id\`.

### Fix
Added \`backwriteSfIdToDomain({ kind, sfId, email, name })\` helper to
bridge-handlers-salesforce.js. Conservative match strategy:

- **Contact** (kind='Contact'): SELECT \`dia.contacts\` then \`gov.contacts\`
  by \`email=ilike.<lower(p.Email)>\` with \`<col>=is.null\` filter,
  \`limit=2\`. Per-domain column: dia uses \`salesforce_id\` (Round 76ak),
  gov uses \`sf_contact_id\`. PATCH only when exactly 1 candidate.
- **Account** (kind='Account'): SELECT \`dia.true_owners\` then
  \`gov.true_owners\` by \`canonical_name=ilike.<canonicalized name>\` with
  \`<col>=is.null\`, \`limit=2\`. dia column \`salesforce_id\`, gov column
  \`sf_account_id\`. PATCH only when exactly 1 candidate.

Match safety:
- Never overwrites a curated value (\`<col>=is.null\` filter).
- Aborts on multi-match (limit=2 + exactly-1 check) — avoids cross-tenant
  collisions where the same email or LLC name appears in both dia and gov
  for unrelated reasons.
- Wrapped in try/catch — any error logs to console and is reported in the
  result's \`sf_backwrite\` summary but never aborts the bridge handler.
  The SF \`external_identities\` row remains the authoritative link.

Per-call summary is added to the handler's result as \`sf_backwrite\` so
the activity log + future audit dashboard can see per-domain success /
failure counts.

### Why limit=2 with exactly-1 PATCH
Two motivations:
- **Single match is the unambiguous case** — patch confidently.
- **Two-or-more candidates** is a real-world signal that the email or
  canonical name maps to multiple domain rows (e.g., a property manager
  who appears as a broker on three dia listings and an owner on five
  gov ones). PATCHing all of them would silently glob unrelated records
  together. Capture as R2-X-3b (collision review queue).

### Verification (post-apply)
1. \`grep -c "backwriteSfIdToDomain" api/_shared/bridge-handlers-salesforce.js\` → 3
   (1 helper definition + 1 Contact call + 1 Account call)
2. \`node -c api/_shared/bridge-handlers-salesforce.js\` → no error
3. Smoke: send a synthetic SF Contact upsert with an email that matches one
   dia.contacts row whose salesforce_id is NULL. After the handler:
   - \`external_identities\` has the new salesforce row
   - \`unified_contacts.sf_contact_id\` is populated
   - \`dia.contacts.salesforce_id\` is now the SF id for that row
   - Handler result includes \`sf_backwrite: { contact: { dialysis: { rows_patched: 1 } } }\`
4. Re-send the same SF payload. The second call's \`sf_backwrite.contact.dialysis\`
   reports \`candidates_found: 0\` (because the column is no longer NULL) and
   \`rows_patched: 0\` — idempotent.
5. Sanity-check the QA-25 "Unprospected Owners" widget — its count should
   drop by the number of SF-linked owners that now have non-NULL
   \`sf_account_id\` / \`salesforce_id\`.

### Sandbox tooling note
\`bridge-handlers-salesforce.js\` is 20 KB — well under the Edit-tool
truncation threshold. Edit was performed via Python-via-bash anyway to
preserve line-ending convention (HEAD uses LF; sibling files in
\`api/_shared/\` are mixed — \`entity-link.js\` is CRLF, the rest LF).
Final \`git diff --stat\`: 118 insertions, 2 deletions. Clean.

### Risks
- **False-negative skip on multi-match.** Today the back-write quietly
  records \`candidates_found: 2\` and skips. The bridge row in
  \`external_identities\` still establishes the link, so reads through the
  bridge are correct. Only the denormalized column-based filters under-
  count. R2-X-3b will surface multi-match cases for review.
- **Email-case sensitivity.** Match uses \`ilike\` (case-insensitive) on a
  lower-cased input — handles common variations.
- **PATCH-on-null guard.** Means a corrupted manual edit (e.g. someone
  pasted the wrong SF id into a dia.contacts row) won't be auto-corrected.
  That's intentional — the bridge should never overwrite curated data.
  R2-X-3c can add a "detect SF-id mismatch and surface as data-quality
  warning" follow-up if needed.

### Out of scope (deferred follow-ups)
- **R2-X-3b**: collision-review queue when a back-write matches >1
  candidate. Today they're silently skipped (with a count in the summary);
  surface them in a \`v_sf_backwrite_collisions\` view so they can be
  resolved manually.
- **R2-X-3c**: SF-id mismatch detection — when the bridge sees a payload
  for an entity whose denormalized column already holds a DIFFERENT SF id,
  log to \`data_corrections\` instead of silently skipping.
- **R2-X-3d**: one-shot historical backfill. The 358 dia.contacts rows
  that had \`sf_contact_id\` migrated to \`salesforce_id\` in Round 76ak are
  already linked, but every entity created since then that doesn't have
  a column-side id is a candidate for back-write via this new helper run
  in batch mode.
- **R2-X-3e**: same back-write pattern for dia.recorded_owners (different
  table from true_owners). Today recorded_owners has neither
  \`salesforce_id\` nor \`sf_account_id\` columns; if/when one is added,
  extend \`backwriteSfIdToDomain\`.

### Files changed
- \`api/_shared/bridge-handlers-salesforce.js\` (+118 lines, -2 lines)
- \`audit/patches/R2-X-3-sf-id-backwrite/\` — patch package
- \`audit/ROUND_2_FINDINGS_2026-05-19.md\` — this closeout

No SQL. No Edge Function. No allowlist changes.
`, eol);

  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['ROUND_2_FINDINGS_2026-05-19.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC R2-X-3 — SF id back-write onto dia/gov denormalized columns ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyHandler(report);
  await updateRound2Findings(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(70) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
