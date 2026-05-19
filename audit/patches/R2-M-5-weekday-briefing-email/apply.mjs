#!/usr/bin/env node
// ============================================================================
// LCC R2-M-5 — Flow spec for weekday daily briefing email.
//
// Doc-only patch — Power Automate flows live in the user's Microsoft
// account, not in the repo. This patch authors the flow spec at
// docs/architecture/flows/lcc-weekday-briefing-email.md and appends a
// closeout block to audit/ROUND_2_FINDINGS_2026-05-19.md. The user builds
// the flow per the spec; final implementation lands as a ZIP export
// committed to flow exports/ following the existing convention.
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

async function verifyFlowSpec(report) {
  const path = resolve(REPO_ROOT, 'docs', 'architecture', 'flows', 'lcc-weekday-briefing-email.md');
  if (!await fileExists(path)) throw new Error('Flow spec not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'Flow Detail: LCC Weekday Briefing Email',
    'Round 2 finding R2-M-5',
    "Schedule: `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`",
    '/api/briefing-email',
    '`Send_an_email_(V2)` via the `shared_office365` connector',
    'How to build',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('Flow spec missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['docs/architecture/flows/lcc-weekday-briefing-email.md', 0, 'verified ✓']);
}

async function updateRound2Findings(report) {
  const path = resolve(REPO_ROOT, 'audit', 'ROUND_2_FINDINGS_2026-05-19.md');
  if (!await fileExists(path)) throw new Error('ROUND_2_FINDINGS_2026-05-19.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);

  const sentinel = 'R2-M-5 closeout (2026-05-19)';
  if (original.includes(sentinel)) {
    report.push(['ROUND_2_FINDINGS_2026-05-19.md', 0, 'already applied']);
    return;
  }

  const block = toEol(`

## ${sentinel} — weekday daily briefing email (Power Automate flow spec) 🟧 REVIEW
- **Branch:** \`audit/r2-m-5-weekday-briefing-email\`
- **Patch:** \`audit/patches/R2-M-5-weekday-briefing-email/apply.mjs\`
- **Doc:** \`docs/architecture/flows/lcc-weekday-briefing-email.md\` (new)
- **Closes:** R2-M-5 (HIGH)

### Diagnosis (verified 2026-05-19)
- \`docs/architecture/flows/lcc-daily-briefing.md\` (Mon-Fri 12:30 UTC):
  \`Post_card_in_a_chat_or_channel\` to Teams. No email.
- \`docs/architecture/flows/lcc-morning-briefing.md\` (Sat-Sun 12:00 UTC):
  \`Send_an_email_(V2)\` via Office 365. No weekday counterpart.

Net effect: weekdays Scott only sees the briefing if he opens Teams; if he
starts his day in email, he never sees it. Same gap inverts on weekends:
Teams shows nothing, email shows the digest.

### Fix
New Power Automate flow \`LCC Weekday Briefing Email\` that:
- Triggers \`Recurrence\` Mon-Fri at 12:30 UTC (same wall-clock as the Teams
  flow so the email lands at the same instant the Teams card posts).
- GETs \`/api/briefing-email\` (the existing endpoint the Sat/Sun flow already
  consumes — no API change needed).
- Parses JSON, composes a date-stamped subject, sends an email via
  \`shared_office365\`.
- Includes a fault branch posting to the dead-letter pane on HTTP step
  failure — mitigates R2-M-7 for this flow from day one.

The Teams flow stays as-is; the weekday Teams card and the email arrive
simultaneously, giving Scott two reliable surfaces.

### Why doc-only
Power Automate flows live in the user's Microsoft 365 account, not in this
repo. The repo carries flow specs (markdown) and exported ZIPs as a
reference but the runtime artefacts live in PA itself. This patch authors
the spec; the user follows the "How to build" section to clone the existing
Sat/Sun flow, change the schedule, and export the result.

### Expected build time
~20 minutes (clone \`LCC Morning Briefing\` flow, change Recurrence schedule
to Mon-Fri, change start time to 12:30 UTC, add fault branch per the
dead-letter runbook, save + smoke test).

### Verification (post-build)
1. Power Automate UI shows two morning briefing flows:
   - \`LCC Morning Briefing\` (Sat, Sun, 12:00 UTC)
   - \`LCC Weekday Briefing Email\` (Mon-Fri, 12:30 UTC)
2. Manual run produces an email in Scott's inbox within 60s.
3. \`/api/admin?_route=dead-letter\` shows zero entries for the new flow.
4. \`FLOW_CHANGES_LOG.md\` has a new entry dated when the flow shipped.

### Out of scope (deferred follow-ups, captured in the spec)
- **R2-M-5b**: shrink the Teams card to a one-liner that links to the email.
- **R2-M-5c**: PTO/pause switch via user_settings.\`briefing_pause_until\`.
- **R2-M-5d**: unify Sat/Sun and weekday flows into a single
  \`LCC-Briefing-Daily\` flow with a day-of-week branch.

### Files changed
- \`docs/architecture/flows/lcc-weekday-briefing-email.md\` (new)
- \`audit/patches/R2-M-5-weekday-briefing-email/\` (patch package)
- \`audit/ROUND_2_FINDINGS_2026-05-19.md\` — this closeout

No code. No SQL. No allowlist changes. Doc-only — implementation lands in
Power Automate per the "How to build" section of the spec.
`, eol);

  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['ROUND_2_FINDINGS_2026-05-19.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC R2-M-5 — weekday daily briefing email flow spec ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyFlowSpec(report);
  await updateRound2Findings(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(70) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete. Next: build the flow in Power Automate per the spec.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
