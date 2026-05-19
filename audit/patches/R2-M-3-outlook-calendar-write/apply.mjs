#!/usr/bin/env node
// ============================================================================
// LCC R2-M-3 — Flow spec for Outlook calendar write-back.
//
// Doc-only patch — Power Automate flows live in the user's Microsoft
// account. This authors the flow spec at
// docs/architecture/flows/lcc-outlook-calendar-write.md and appends a
// closeout to audit/ROUND_2_FINDINGS_2026-05-19.md. R2-M-3b (LCC outbound
// caller) and R2-M-3c (callback handler) are deferred follow-ups captured
// in the spec.
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
  const path = resolve(REPO_ROOT, 'docs', 'architecture', 'flows', 'lcc-outlook-calendar-write.md');
  if (!await fileExists(path)) throw new Error('Flow spec not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'Flow Detail: LCC Outlook Calendar Write',
    'Round 2 finding R2-M-3',
    '`Create_calendar_event_(V2)` via `shared_outlook`',
    'OUTLOOK_CALENDAR_WRITE_FLOW_URL',
    'record_calendar_invite',
    'R2-M-3b',
    'R2-M-3c',
    'How to build',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('Flow spec missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['docs/architecture/flows/lcc-outlook-calendar-write.md', 0, 'verified ✓']);
}

async function updateRound2Findings(report) {
  const path = resolve(REPO_ROOT, 'audit', 'ROUND_2_FINDINGS_2026-05-19.md');
  if (!await fileExists(path)) throw new Error('ROUND_2_FINDINGS_2026-05-19.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);

  const sentinel = 'R2-M-3 closeout (2026-05-19)';
  if (original.includes(sentinel)) {
    report.push(['ROUND_2_FINDINGS_2026-05-19.md', 0, 'already applied']);
    return;
  }

  const block = toEol(`

## ${sentinel} — Outlook calendar write-back (Power Automate flow spec) 🟧 REVIEW
- **Branch:** \`audit/r2-m-3-outlook-calendar-write\`
- **Patch:** \`audit/patches/R2-M-3-outlook-calendar-write/apply.mjs\`
- **Doc:** \`docs/architecture/flows/lcc-outlook-calendar-write.md\` (new)
- **Closes (when paired with R2-M-3b + R2-M-3c):** R2-M-3 (HIGH)

### Diagnosis (verified 2026-05-19)
Calendar bridge is unidirectional Outlook → Supabase:
- \`LCC - Personal Calendar Sync\` (hourly, GetEventsCalendarView) pulls events into Supabase.
- \`docs/architecture/lcc-microsoft-salesforce-pipeline-gap-analysis.md:37\` explicitly says "LCC cannot write or update Outlook calendar events."
- \`api/_shared/cadence-engine.js:378\` has a \`touchData.type === 'meeting'\` branch that increments \`meetings_scheduled\` but there is no actual calendar invite created — only a counter increment.

Net: cadence touches "Phone Follow-Up" and "Direct Ask — schedule meeting"
produce LCC-side actions but every actual calendar invite is hand-authored
in Outlook. The cadence-engine already knows the contact, the property, and
the suggested follow-up window; none of that reaches the calendar surface.

### Fix (this round)
Authored the Power Automate flow spec for \`LCC-OutlookCalendarWrite\`:

- Trigger: HTTP \`Request\` (LCC POSTs to a PA-generated trigger URL stored
  in Vercel env as \`OUTLOOK_CALENDAR_WRITE_FLOW_URL\` — Vault-managed).
- Request schema: subject, body_html, start/end ISO + TZ, attendees,
  location, categories, \`metadata.lcc_cadence_id\` + \`lcc_touch\` for
  the callback to wire to the right cadence row. \`correlation_id\` and
  \`schema_version\` mirror the existing calendar-sync hardening pattern.
- Flow body: \`Parse_JSON\` → \`Create_calendar_event_(V2)\` via
  \`shared_outlook\` → HTTP callback to LCC at
  \`/api/operations?_route=draft&action=record_calendar_invite\` →
  \`Response\` 200 with Outlook event ID. Fault branch on the create step
  posts to the dead-letter pane.
- Auth: PA-generated trigger URL (signed) + secondary HMAC header
  \`X-LCC-Caller\` so a leaked URL alone can't fire events.

### Why doc-only this round
Power Automate flows aren't in the repo — they live in Scott's M365
account. The repo carries the spec; the user builds the flow following
the "How to build" section. Two paired follow-ups are needed before the
end-to-end loop closes:

- **R2-M-3b**: LCC-side \`Schedule meeting\` button on \`detail.js\` +
  \`api/operations.js\` action that builds the request payload and POSTs
  to the PA trigger URL.
- **R2-M-3c**: New \`?action=record_calendar_invite\` handler in
  \`api/operations.js\` that accepts the PA callback, patches
  \`touchpoint_cadence.last_calendar_event_id\`, and advances the cadence
  via \`recordTouchOutcome('meeting')\`.

R2-M-3b and R2-M-3c are tracked as Round 2 sub-findings so they don't
get lost.

### Additional deferred follow-ups (captured in the spec)
- **R2-M-3d**: Conflict-detection prefix — query
  \`GetEventsCalendarViewV2\` for the request window inside the flow,
  return 409 if any existing event overlaps.
- **R2-M-3e**: Bidirectional sync — when the user moves or cancels the
  Outlook event, propagate the change back via the existing hourly pull.

### Verification (post-build, after PA flow + R2-M-3b + R2-M-3c ship)
1. Open a dia property detail page; click "Schedule meeting" on the
   sticky action bar. Pick a date/time.
2. Confirm an Outlook event appears on Scott's calendar within 30s with
   the right subject, attendee, and LCC category tag.
3. Confirm \`touchpoint_cadence.last_calendar_event_id\` is populated
   (matches the Outlook event ID).
4. Confirm the cadence advanced to the next touch.
5. Cancel the Outlook event manually; verify (today) the cancel is
   visible in the next hourly pull (R2-M-3e is needed before LCC reacts
   to the cancel).

### Files changed
- \`docs/architecture/flows/lcc-outlook-calendar-write.md\` (new)
- \`audit/patches/R2-M-3-outlook-calendar-write/\` (patch package)
- \`audit/ROUND_2_FINDINGS_2026-05-19.md\` — this closeout

No code. No SQL. No allowlist changes. Doc-only — R2-M-3b/c follow.
`, eol);

  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['ROUND_2_FINDINGS_2026-05-19.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC R2-M-3 — Outlook calendar write-back flow spec ===');
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
  else     console.log('\n✓ Apply complete. Next: build PA flow per the spec; R2-M-3b/c follow.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
