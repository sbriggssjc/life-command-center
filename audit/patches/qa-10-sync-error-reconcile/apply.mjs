#!/usr/bin/env node
// ============================================================================
// LCC QA-10 — Sync error count reconciliation.
//
// Two-line ops.js fix so Sync Health and Metrics agree with Pipeline.
//
// This script:
//   1. VERIFIES the two edits are on disk (sentinels).
//   2. APPENDS the AUDIT_PROGRESS.md closeout.
//
// Branch: audit/qa-10-sync-error-reconcile
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

async function verifyOpsJs(report) {
  const path = resolve(REPO_ROOT, 'ops.js');
  if (!await fileExists(path)) throw new Error('ops.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  const sentinels = [
    'QA-10 (2026-05-18): show connector-status errors here',
    'QA-10 (2026-05-18): prefer the live connector-status error count',
    'connectors in error state',
  ];
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error(
      'ops.js missing QA-10 sentinels:\n  - ' + missing.join('\n  - ') + '\n' +
      'Edit ' + path + ' near the Sync Health summary tiles and the ' +
      'Metrics page Sync Errors tile.'
    );
  }
  report.push(['ops.js (Sync Health + Metrics Sync Errors tiles)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #10 — Sync error count reconciliation ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-10-sync-error-reconcile\`
- **Patch:** \`audit/patches/qa-10-sync-error-reconcile/apply.mjs\`

### The conflict (before)
| Surface | Stat | Value | Source |
|---|---|---|---|
| Pipeline page header | "⚠ 1 connector failing: outlook" | **1** | \`connectors.filter(c => c.status==='error'\\|\\|'degraded').length\` |
| Sync Health "Errors" tile | "0 unresolved sync issues" | **0** | \`unresolved_errors.length\` from \`/api/sync?action=health\` |
| Metrics "Sync Errors" tile | "0 connectors" | **0** | \`work_counts.sync_errors\` row count |

### Root cause
Two distinct concepts under the same label:
1. **Connector status errors** — accounts in \`status='error'\` right now. Lives in \`summary.error\` from \`/api/sync?action=health\`. What Pipeline shows.
2. **Sync log error rows** — rows in the \`sync_errors\` table that aren't resolved. Lives in \`unresolved_errors[]\` from the same endpoint and is also rolled up into \`work_counts.sync_errors\`. What Sync Health and Metrics were showing.

These diverge regularly: a connector can be \`status='error'\` (OAuth expired, etc.) with zero rows in \`sync_errors\` because no sync attempt logged, and vice-versa. The actionable signal for the operator is connector status.

### Fix
Two-line change in \`ops.js\`:
1. **Sync Health page "Errors" tile** — uses \`summary.error\` instead of \`unresolvedErrors.length\`. The \`unresolved_errors[]\` list still renders below in the "Recent Errors" widget for diagnostics.
2. **Metrics page "Sync Errors" tile** — uses \`syncHealthRes.data.summary.error\` (the page already fetches sync-health for the Operational Signals section). Falls back to \`c.sync_errors\` if sync-health fetch failed.

### After (verified live)
| Surface | Value | Source |
|---|---|---|
| Pipeline banner | 1 | connectors filter (unchanged) |
| Sync Health "Errors" tile | 1 | \`summary.error\` |
| Metrics "Sync Errors" tile | 1 | \`summary.error\` (with fallback) |

Verified via Chrome MCP on the live session: \`summary.error: 1\`, one outlook connector in \`status='error'\` with \`last_error: "object is not iterable (cannot read property Symbol(Symbol.iterator))"\`.

### Out of scope
- The Home team-pulse \`pulse-card\` (\`app.js\` line ~7018) still uses \`canonicalCounts.sync_errors\`. It only renders for managers AND only when at least one of open_actions / open_escalations / sync_errors / in_progress is > 0. Fixing it requires loading sync-health into Home's render flow. Lower priority because the widget is manager-only and gated on multiple signals.
- Redefining \`work_counts.sync_errors\` SQL to count connector status errors would let the Home pulse-card self-correct without client changes — captured as an optional follow-up.

### Files changed
- \`ops.js\` — two tile fixes
- \`AUDIT_PROGRESS.md\` — this closeout

### Queued for follow-up
- **P1** Public REITs + same-entity duplicates in \`llc_research_queue\`
- **P2** Casing/UX nits documented in \`outputs/lcc-qa-pass-2026-05-18.docx\`
- **Optional** redefine \`work_counts.sync_errors\` SQL to use connector status

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-10 — Sync error count reconciliation ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyOpsJs(report);
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
