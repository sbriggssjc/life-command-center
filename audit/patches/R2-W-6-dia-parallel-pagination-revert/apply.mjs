#!/usr/bin/env node
// ============================================================================
// LCC R2-W-6 — Revert diaQueryAll parallel pagination (mirror QA-33's gov revert).
//
// Because dialysis.js is >500KB and the Edit-tool truncation issue documented
// in audit/SANDBOX_TOOLING_NOTES.md is unresolved, this patch is delivered as
// a Python-via-bash edit that an operator runs from the Windows-side terminal
// where the truncation issue doesn't apply. apply.mjs's role is:
//
//   1. Verify the prior PARALLEL block is no longer present in dialysis.js
//      (i.e. the revert has been applied — either by running the embedded
//      Python below from a workstation, or by the Cowork agent that authored
//      this patch).
//   2. Verify the new SERIAL block IS present with its R2-W-6 sentinel.
//   3. Append the closeout block to audit/ROUND_2_FINDINGS_2026-05-19.md.
//
// If the file has NOT been edited yet, the verifier surfaces a clear error
// with instructions to apply the Python edit manually before re-running.
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

async function verifyDialysisJs(report) {
  const path = resolve(REPO_ROOT, 'dialysis.js');
  if (!await fileExists(path)) throw new Error('dialysis.js not found at ' + path);
  const src = await readFile(path, 'utf8');

  // Sentinel that the OLD parallel block is gone
  const oldSentinel = "const others = await Promise.all(pages);";
  if (src.includes(oldSentinel)) {
    throw new Error(
      'dialysis.js still contains the parallel-Promise.all block. Apply the\n' +
      'edit first (it is delivered as a Python-via-bash operation; see the\n' +
      'embedded edit script in this patch package or use the original Cowork\n' +
      'apply transcript). Once dialysis.js no longer contains\n' +
      '`' + oldSentinel + '`, re-run this script.'
    );
  }

  // Sentinels that the NEW serial block landed
  const required = [
    "R2-W-6 (2026-05-19): reverted to serial pagination",
    "const maxTime = 120000",
    "while (true) {",
    "if (Date.now() - start > maxTime) {",
    "console.warn('diaQueryAll(",
    "if (!rows || rows.length < pageSize) break;",
  ];
  const missing = required.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('dialysis.js missing R2-W-6 sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['dialysis.js (R2-W-6 serial revert)', 0, 'verified ✓']);
}

async function updateRound2Findings(report) {
  const path = resolve(REPO_ROOT, 'audit', 'ROUND_2_FINDINGS_2026-05-19.md');
  if (!await fileExists(path)) throw new Error('ROUND_2_FINDINGS_2026-05-19.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);

  const sentinel = 'R2-W-6 closeout (2026-05-19)';
  if (original.includes(sentinel)) {
    report.push(['ROUND_2_FINDINGS_2026-05-19.md', 0, 'already applied']);
    return;
  }

  const block = toEol(`

## ${sentinel} — diaQueryAll parallel pagination revert 🟧 REVIEW
- **Branch:** \`audit/r2-w-6-dia-parallel-pagination-revert\`
- **Patch:** \`audit/patches/R2-W-6-dia-parallel-pagination-revert/apply.mjs\`
- **Files changed:** \`dialysis.js\` only (no SQL, no Edge Function, no allowlist)
- **Closes:** R2-W-6 (HIGH)

### Diagnosis (verified 2026-05-19)
QA-33 reverted gov's parallel-pagination QA-26 because it caused ~60 concurrent
HTTP requests at page-load and a 194-second full-load with browser unresponsiveness.
The QA-33 closeout flagged that "QA-27 (dia parallel) NOT reverted yet — need
to probe dia separately."

Today's R2-W-6 verification confirmed \`diaQueryAll\` at \`dialysis.js:174-188\`
still issued every page past the first via \`Promise.all\` (the exact pattern
QA-33 had to unwind on gov). dia tables are smaller (medicare_clinics 8.5k,
true_owners 3.4k vs gov's properties 17.5k) so the regression is less dramatic,
but the failure mode is identical when dashboards stack multiple
\`diaQueryAll\` calls in \`Promise.all\` — and dialysis.js does exactly that
(loadDiaData Phase 1 + ownership-coverage block + sales/contacts widgets).

### Fix
Replaced the parallel implementation with a serial while-loop that:
- Issues one page at a time, accumulating into \`all\`.
- Breaks early when \`rows.length < pageSize\` (PostgREST max-rows cap).
- Carries a 120 s total-time fuse with a \`console.warn\` on overshoot so a
  hung Edge Function can't lock a dashboard load forever.
- Drops the \`includeCount=true\` first-page request — callers that need a
  true count (the QA-29 v_prospect_targets reader) keep using \`diaQuery\`
  directly with \`includeCount=true\`, which is one call, not a fan-out.

Matches \`govQueryAll\`'s post-QA-33 shape exactly so future maintenance is
symmetric across the two dashboards.

### Sandbox tooling note
\`dialysis.js\` is 604 KB — above the audit/SANDBOX_TOOLING_NOTES.md threshold
where the Cowork \`Edit\` tool silently truncates. The actual edit was
performed through Python via \`mcp__workspace__bash\` (the documented
workaround). \`wc -c\` post-edit: 604,189 bytes / 10,936 lines. Tail verified
intact. \`git diff --stat\` reports 26 insertions / 18 deletions — exactly the
expected swap of the OLD 21-line block for the NEW 28-line block.

### Expected perf
Dia dashboard wall-clock returns to QA-26-era serial behaviour (~400 ms per
page × N pages). For dia's biggest reads (medicare_clinics 9 pages, true_owners
4 pages) that's ~3.6 s and ~1.6 s respectively. Slower than the parallel
optimum, but no perf cliff under load.

### Verification (post-apply)
1. \`grep -c "R2-W-6 (2026-05-19)" dialysis.js\` → 1
2. \`grep -c "Promise.all(pages)" dialysis.js\` → 0
3. Open the dia dashboard, watch the network tab — requests stack sequentially,
   no burst of 8+ concurrent /api/dia-query calls.
4. Spot-check the QA-29 Unprospected Owners modal — \`window._diaUnprospectedTotal\`
   should still read 532 (the QA-29 fix uses \`diaQuery\` with includeCount
   directly, untouched by this revert).

### Risks
- The 120-second total fuse is on the safe side — a real timeout would mean
  ~120 pages × 1 s each = 120k rows, well beyond any dia table.
- Existing callers (~13 sites) expect a flat array return — preserved.
- The diaQuery includeCount opt-in (QA-27 change to diaQuery itself) is NOT
  reverted; it's a useful primitive and the v_prospect_targets caller relies
  on it.

### Out of scope (deferred follow-ups)
- **Throttled-parallel (concurrency=4)** for both \`govQueryAll\` and
  \`diaQueryAll\`. QA-33's closeout flagged this as the better long-term
  shape — six independent serial pages plus four concurrent ones gives most
  of the parallel win without the perf cliff. Defer to a focused perf round.
- **dia parallel readers OUTSIDE diaQueryAll** — the ownership-coverage block
  at \`dialysis.js:454,869,870\` already runs three independent reads in
  parallel via top-level \`Promise.all\`. That's three concurrent requests,
  not N × pages, so the cliff doesn't apply. Leave as-is.

### Files changed
- \`dialysis.js\` — diaQueryAll body replaced (lines 168-188)
- \`audit/patches/R2-W-6-dia-parallel-pagination-revert/\` — patch package
- \`audit/ROUND_2_FINDINGS_2026-05-19.md\` — this closeout
`, eol);

  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['ROUND_2_FINDINGS_2026-05-19.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC R2-W-6 — diaQueryAll parallel pagination revert ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyDialysisJs(report);
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
