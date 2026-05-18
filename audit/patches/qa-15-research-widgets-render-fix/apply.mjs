#!/usr/bin/env node
// ============================================================================
// LCC QA-15 — Research page widgets render fix.
//
// Branch: audit/qa-15-research-widgets-render-fix
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
    'QA-15 (2026-05-18): the previous wiring',
    'QA-15 (2026-05-18): wrap the research queue content',
    "<div class=\"lcc-research-widgets\"></div>",
    "<div class=\"lcc-research-queue\">",
    "const widgetsEl = el.querySelector('.lcc-research-widgets');",
  ];
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('ops.js missing QA-15 sentinels:\n  - ' + missing.join('\n  - '));
  }
  // Sanity check: the widget renders must run AFTER el.innerHTML assignment.
  // Look for the wrapper assignment appearing before the render calls.
  const wrapperIdx = src.indexOf("'<div class=\"lcc-research-widgets\"></div>'");
  const llcRenderIdx = src.indexOf('renderLlcResearchQueueWidget(widgetsEl)');
  if (wrapperIdx < 0 || llcRenderIdx < 0 || wrapperIdx >= llcRenderIdx) {
    throw new Error('ops.js QA-15 ordering check failed — widget renders should follow the wrapper assignment.');
  }
  report.push(['ops.js (renderResearchPage widget hoist)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #15 — Research page widgets render fix ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-15-research-widgets-render-fix\`
- **Patch:** \`audit/patches/qa-15-research-widgets-render-fix/apply.mjs\`

### Symptom
Research page rendered as just "Research · 0 tasks · No research tasks match this filter" despite the LLC research queue having 1,200+ items and the Agency Drift queue having hundreds of rows. The widget renders were wired up (Item #2 Phase B on 2026-05-17, Fresh audit A-5 on 2026-05-18) but produced no visible output.

### Root cause
\`renderResearchPage\` (\`ops.js\`) called the two widget render functions, which prepend a widget into \`el\` via \`parentEl.insertBefore(widget, parentEl.firstChild)\`. Then the function continued building the queue-list \`html\` string and finished with \`el.innerHTML = html\` — which replaced every child of \`el\`, wiping out the just-rendered widgets. No console error: the widgets WERE rendering successfully; the parent function destroyed them on the next line.

### Fix
Restructure to render the widgets AFTER the \`el.innerHTML\` assignment:
\`\`\`js
el.innerHTML =
  '<div class="lcc-research-widgets"></div>' +
  '<div class="lcc-research-queue">' + html + '</div>';
const widgetsEl = el.querySelector('.lcc-research-widgets');
if (widgetsEl) {
  if (typeof renderLlcResearchQueueWidget === 'function') {
    await renderLlcResearchQueueWidget(widgetsEl);
  }
  if (typeof renderAgencyDriftQueueWidget === 'function') {
    await renderAgencyDriftQueueWidget(widgetsEl);
  }
}
\`\`\`

### Files changed
- \`ops.js\` — \`renderResearchPage\` restructure
- \`AUDIT_PROGRESS.md\` — this closeout

### Deferred queue cleared
QA-13 (Home Inbox inline actions), QA-14 (Messages page inline actions), and QA-15 (this) were the three items deferred at the end of the original 2026-05-18 QA pass. All shipped.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-15 — Research page widgets render fix ===');
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
