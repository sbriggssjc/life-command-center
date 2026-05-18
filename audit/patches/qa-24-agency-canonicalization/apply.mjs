#!/usr/bin/env node
// ============================================================================
// LCC QA-24 — canonicalize Agency Breakdown (gov dashboard).
//
// Two coupled fixes:
//   (a) gov canonicalize_agency() regex didn't match singular "Veteran Affairs"
//   (b) gov.js dashboard grouped by raw .agency instead of .agency_canonical
//
// This script verifies both edits are present in tree and appends the
// AUDIT_PROGRESS.md closeout. The migration was applied live via Supabase
// MCP on 2026-05-18 before this patch was assembled.
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
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government',
    '20260518220000_gov_qa24_canonicalize_agency_veteran_singular.sql');
  if (!await fileExists(path)) throw new Error('Migration not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'CREATE OR REPLACE FUNCTION public.canonicalize_agency',
    'veterans?\\s+affairs',
    'UPDATE public.properties',
    'QA-24 (2026-05-18)',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('Migration missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['gov QA-24 migration (canonicalize_agency singular VA)', 0, 'verified ✓']);
}

async function verifyGovJs(report) {
  const path = resolve(REPO_ROOT, 'gov.js');
  if (!await fileExists(path)) throw new Error('gov.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'QA-24 (2026-05-18): prefer agency_canonical',
    'QA-24 (2026-05-18): group by agency_canonical',
    'p.agency_canonical || p.agency',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('gov.js missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['gov.js (distinctAgencies + agencyMap use canonical)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #24 — Agency Breakdown canonicalization (gov) ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-24-agency-canonicalization\`
- **Patch:** \`audit/patches/qa-24-agency-canonicalization/apply.mjs\`
- **Migration:** \`supabase/migrations/government/20260518220000_gov_qa24_canonicalize_agency_veteran_singular.sql\`
- **Severity:** P1 — masked VA as the #1 federal tenant.

### Symptom
Gov dashboard Agency Breakdown widget showed VA-related properties split across THREE raw-string buckets:
- "US Department of Veteran Affairs" — 1,217 (singular)
- "US Department of Veterans Affairs - 1" — 289 (suffixed plural variant)
- Canonical "VA" — 657 (already canonicalized)

Result: GSA at 1,083 appeared as #1; VA's true 1,875 was hidden across the three buckets.

### Two bugs, one impact
**(a) Data — canonicalize_agency() regex didn't match singular "Veteran Affairs":**
The regex was \`\\m(va|veterans\\s+affairs|...)\\M\`. 1,217 rows of "US Department of Veteran Affairs" (singular) had agency_canonical = NULL.

**Fix:** \`veterans\\s+affairs\` → \`veterans?\\s+affairs\` (plus same pattern for \`veterans?\\s+health\`, \`department\\s+of\\s+veterans?\`).

**(b) UI — gov.js dashboard grouped by raw .agency, not .agency_canonical:**
\`portfolio.forEach(p => { const a = p.agency || 'Unknown'; ... })\` bypassed the canonical column entirely. Even after the regex fix, the dashboard would still group by whatever raw string the upstream gave.

**Fix:** \`const a = p.agency_canonical || p.agency || 'Unknown';\` (and same for distinctAgencies count).

### Verified live (Supabase MCP, 2026-05-18)
Before re-canonicalization:
\`\`\`
US Department of Veteran Affairs        1,217
General Services Administration (GSA)   1,083
SSA                                       781
US Department of Veterans Affairs - 1     289
\`\`\`

After re-canonicalization (agency_canonical):
\`\`\`
VA      1,875   ← +1,218 (was hidden across 3 buckets)
SSA     1,320
GSA     1,267
\`\`\`

VA is now correctly displayed as the **#1 federal tenant**, ~1.5× GSA.

### Lesson
When the canonicalizer regex skips a major variant, the impact compounds: not only does that raw value go un-canonicalized, the dashboard (which groups by raw \`.agency\` for fallback robustness) silently fragments it across multiple top-agency entries. Fixing one without the other isn't enough — both data and frontend group-by must use the canonical column.

### Out of scope (noted for future passes)
- Non-federal entities tagged as "Federal" (Federal Credit Unions, "10 Federal Self Storage", etc.) — canonicalizer correctly returns NULL; frontend now falls back to raw string.
- State/local government tenants (Florida DoH, Shelby County Government, etc.) — canonicalizer is federal-only by design.
- 8–14 sec page-render delay on Gov dashboard (separate investigation).
- SF PROSPECTING 0% / MISSING SF LINK 97% — real data gap, not a display bug.

### Files changed
- \`supabase/migrations/government/20260518220000_gov_qa24_canonicalize_agency_veteran_singular.sql\`
- \`gov.js\` — \`distinctAgencies\` + \`agencyMap\` group-by use \`p.agency_canonical || p.agency\`
- \`AUDIT_PROGRESS.md\` — this closeout

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-24 — Agency Breakdown canonicalization (gov) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyMigration(report);
  await verifyGovJs(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(70) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
