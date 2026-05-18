#!/usr/bin/env node
// ============================================================================
// LCC QA-14 — Messages page inline actions (flagged tab).
//
// Branch: audit/qa-14-messages-inline-actions
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

async function verifyAppJs(report) {
  const path = resolve(REPO_ROOT, 'app.js');
  if (!await fileExists(path)) throw new Error('app.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  const sentinels = [
    'QA-14 (2026-05-18): external_id → { id, status } map',
    'msgCanonicalById = new Map',
    'QA-14 (2026-05-18): Fetch the canonical inbox',
    'QA-14 (2026-05-18): attach the canonical inbox row id',
    'QA-14 (2026-05-18): when the flagged-tab item has a canonical inbox',
    '(not yet in inbox queue)',
  ];
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('app.js missing QA-14 sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['app.js (Messages page flagged-tab actions + canonical xref)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #14 — Messages page inline actions ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-14-messages-inline-actions\`
- **Patch:** \`audit/patches/qa-14-messages-inline-actions/apply.mjs\`

### Symptom
Every row on the Messages page had only "Open in Outlook ↗", forcing a context switch per message. The Inbox page has the full action set; the redundant Messages flagged tab did not.

### Structural difference from QA-13
The Home Inbox rail (QA-13) renders canonical inbox rows directly — each item already has a queue UUID and \`status\`. The Messages page's \`flagged\` tab pulls raw Outlook emails from \`/api/sync?action=flagged_emails\` — those items have an Outlook \`external_id\` but no canonical queue UUID. The canonical inbox sync runs separately, so at any given moment some flagged emails have a canonical match and some don't.

### Fix
\`app.js\`:
1. New module-level \`Map msgCanonicalById\` keyed by \`external_id\` → \`{ id, status }\`.
2. \`loadMessages\` also fetches \`/api/queue-v2?view=inbox&per_page=500\` and populates the map.
3. \`renderMessages\` flagged-tab path:
   - Cards with a canonical match render the four-button row (Triage shown only when \`status === 'new'\`).
   - Cards without a match keep just "Open in Outlook ↗" plus a grey hint "(not yet in inbox queue)".

Recent/Sent tabs unchanged — those items are SF activities, not triage queue items.

### Files changed
- \`app.js\` (loadMessages + renderMessages flagged-tab)
- \`AUDIT_PROGRESS.md\` (this closeout)

### Optional follow-up (out of scope here)
- "Bring to Inbox" button on unmatched flagged cards — would need a small backend endpoint (\`/api/workflows?action=canonicalize_email\` taking external_id) to manually create the canonical row instead of waiting for the next sync.

### Queued
- **QA-15** — Research page LLC + Agency Drift widgets (last item in the deferred queue).

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-14 — Messages page inline actions ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyAppJs(report);
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
