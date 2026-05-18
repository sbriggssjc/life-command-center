#!/usr/bin/env node
// ============================================================================
// LCC QA-09 — "Open Activities" stat reconciliation.
//
// Tight-scope fix:
//   1. ops.js: drop flagged_email / inbox rows from Pipeline "My Work" so
//      Pipeline agrees with Home's open_actions count.
//   2. ops.js: empty-state hint shows how many flagged emails were dropped
//      and routes the user to Inbox.
//   3. index.html: tooltip on Home "Open Activities" stat-card explains it
//      doesn't include raw flagged emails.
//
// This script:
//   1. VERIFIES the three edits are on disk (sentinels).
//   2. APPENDS the AUDIT_PROGRESS.md closeout block.
//
// Branch: audit/qa-09-open-activities-stat-reconcile
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
    "QA-09 (2026-05-18): exclude raw flagged-email",
    "window._opsMyWorkInboxDropped",
    'No action items assigned to you',
  ];
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error(
      'ops.js missing QA-09 sentinels:\n  - ' + missing.join('\n  - ') + '\n' +
      'Edit ' + path + ' near renderMyWork() / renderMyWorkList() to apply the filter ' +
      'and empty-state hint.'
    );
  }
  report.push(['ops.js (renderMyWork inbox filter + empty state)', 0, 'verified ✓']);
}

async function verifyIndexHtml(report) {
  const path = resolve(REPO_ROOT, 'index.html');
  if (!await fileExists(path)) throw new Error('index.html not found at ' + path);
  const src = await readFile(path, 'utf8');
  const sentinel = 'Promoted / assigned action items only';
  if (!src.includes(sentinel)) {
    throw new Error(
      'index.html missing QA-09 tooltip on #statActivities.\n' +
      'Expected the phrase "' + sentinel + '" in the title= attribute of the ' +
      'stat-card around line 110.'
    );
  }
  report.push(['index.html (#statActivities tooltip)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #9 — Open Activities stat reconciliation ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-09-open-activities-stat-reconcile\`
- **Patch:** \`audit/patches/qa-09-open-activities-stat-reconcile/apply.mjs\`

### The conflict (before)
| Surface | Stat | Value | What it actually counted |
|---|---|---|---|
| Home | "Open Activities" | 0 | \`work_counts.open_actions\` (correct, but ambiguously labeled) |
| Home | "Flagged Emails" | 3,569 | Raw Outlook flag count |
| Pipeline | "My Work · 23 items" | 23 | First 100 \`flagged_email\` rows after dedup |
| Metrics | "INBOX · 7,402 needs triage" | 7,402 | \`work_counts.inbox_new\` |
| Inbox page | "100 items" | 100 | Same flagged_email source, paginated |

### Tight-scope fix
1. **\`ops.js\` \`renderMyWork\`** — drops \`source_type='flagged_email'\` / \`item_type='inbox'\` rows from the My Work list before dedup. Records \`window._opsMyWorkInboxDropped\` so the empty state can surface the dropped count.
2. **\`ops.js\` \`renderMyWorkList\`** empty state — when the queue is empty after the filter and N emails were dropped, the empty-state copy now says "No action items assigned to you / N flagged emails sitting in Inbox — triage there to promote them into actions." with an Open Inbox CTA.
3. **\`index.html\`** — adds \`title="Promoted / assigned action items only — does not include raw flagged emails. See the Flagged Emails stat (next card) for the triage queue."\` to the \`#statActivities\` stat-card on Home.

### After
| Surface | Stat | Meaning | Consistent? |
|---|---|---|---|
| Home "Open Activities" | promoted/assigned actions only (tooltip) | matches Pipeline | ✓ |
| Home "Flagged Emails" | raw Outlook flag count (separate concept) | no overlap | ✓ |
| Pipeline "My Work" | true actions only, raw emails excluded | matches Home | ✓ |
| Metrics "INBOX · needs triage" | \`work_counts.inbox_new\` | separate concept | ✓ |
| Inbox page count | same source as Metrics | matches Metrics | ✓ |

### Caveats / out of scope
- The 3,569 (Home Flagged Emails) vs 7,402 (Metrics INBOX) gap is a separate issue: different sources (Outlook flag API vs canonical inbox_new). They will not agree until the inbox sync catches up. Not addressed here.
- Stat labels were not renamed — the tooltip is the minimum-blast-radius substitute. A future "medium scope" pass could rename to "Actions Assigned" / "Inbox to Triage" / etc.

### Files changed
- \`ops.js\` — filter in \`renderMyWork\`, empty-state hint in \`renderMyWorkList\`
- \`index.html\` — tooltip on #statActivities
- \`AUDIT_PROGRESS.md\` — this closeout

### Queued for follow-up
- **P1** Sync error count contradicts itself (Pipeline header / Metrics tile / Sync Health page)
- **P1** Public REITs + same-entity duplicates in \`llc_research_queue\`
- **P2** Casing/UX nits documented in \`outputs/lcc-qa-pass-2026-05-18.docx\`

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-09 — Open Activities stat reconciliation ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyOpsJs(report);
  await verifyIndexHtml(report);
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
