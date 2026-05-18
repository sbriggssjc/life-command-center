#!/usr/bin/env node
// ============================================================================
// LCC QA-13 — Home Inbox rail inline actions.
//
// Verifies sentinels for the Home rail card change in app.js.
//
// Branch: audit/qa-13-home-inbox-inline-actions
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
    'QA-13 (2026-05-18): mirror the Inbox page action set on the Home rail',
    "_opsBtnGuard(this, triageSingle",
    "_opsBtnGuard(this, promoteSingle",
    "_opsBtnGuard(this, dismissSingle",
    "quickReassign(decodeURIComponent('${idEnc}'),'inbox'",
    "onclick=\"event.stopPropagation()\"",
  ];
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('app.js missing QA-13 sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['app.js (renderRecentEmails inline actions)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #13 — Home Inbox rail inline actions ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-13-home-inbox-inline-actions\`
- **Patch:** \`audit/patches/qa-13-home-inbox-inline-actions/apply.mjs\`

### Symptom
The Home rail's inbox cards offered only "Open in Outlook ↗" — every triage action required navigating to either Outlook or the dedicated Inbox page. With 7,400+ flagged emails, this click-economy cost made the Home rail's inbox preview essentially read-only.

### Fix
\`renderRecentEmails\` (\`app.js\`) — canonical-inbox path — now ends each card with the same four buttons used by \`inboxItemHTML\` on the Inbox page: **Triage** (only when status==='new'), **Promote** (primary), **Assign**, **Dismiss**. All four handlers (\`triageSingle\`, \`promoteSingle\`, \`dismissSingle\`, \`quickReassign\`, plus \`_opsBtnGuard\` and \`jsStringArg\`) are top-level declarations in \`ops.js\` and reachable as globals from \`app.js\` runtime contexts.

The button row is wrapped in \`<div onclick="event.stopPropagation()">\` so the card-level \`navTo('pageInbox')\` doesn't fire when a button is clicked.

The legacy fallback path (raw flagged emails from the edge function, no canonical queue row) keeps the existing "Open in Outlook ↗" link only.

### Files changed
- \`app.js\` — \`renderRecentEmails\` canonical-inbox path
- \`AUDIT_PROGRESS.md\` — this closeout

### Queued for follow-up
- **QA-14** Messages page inline actions (every row currently has only "Open in Outlook ↗").
- **QA-15** Research page — wire the LLC + Agency Drift widgets onto pageResearch.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-13 — Home Inbox rail inline actions ===');
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
