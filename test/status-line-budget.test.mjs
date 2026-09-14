/**
 * Guard: docs/claude-code/STATUS.md must stay under a line budget, and its
 * Open-threads table must stay findable at the top.
 *
 * WHY THIS EXISTS (CONSOLIDATE2, round 2, 2026-09-12)
 * STATUS.md is an append-mostly running log — CONSOLIDATE1 archived it at 8,975 lines
 * (2026-09-08), it grew back to 10,742 by 2026-09-12, and nothing in the repo failed a build
 * over it. A file nobody is forced to trim just keeps growing until a fresh session cannot
 * read it in one pass. This test is that force: it fails loudly, with the archive procedure
 * named in the assertion message, instead of letting the file silently cross 20k lines.
 *
 * CONSOLIDATE3 (2026-09-12) RAISED THE BUDGET AND ADDED A SOFT WARNING because CONSOLIDATE2's
 * own reconcile pass left only ~40 lines of headroom on a 2,500-line cap — one more entry from
 * ANY concurrent session would have failed the suite. The hard cap alone gave no advance notice.
 *
 * THE FIX WHEN THE HARD BUDGET GOES RED:
 * Follow the archive procedure CONSOLIDATE1/CONSOLIDATE2 already used (see the pointer note at
 * the top of STATUS.md itself, and `docs/history/STATUS_claude-code_*.md` for the convention):
 *   1. Pick a contiguous line span of OLDER entries (not necessarily a clean date boundary —
 *      STATUS.md is not strictly date-sorted; verify no needed recent entry sits inside the
 *      span before cutting).
 *   2. Move that span VERBATIM (byte-for-byte, no rewording) into a new
 *      `docs/history/STATUS_claude-code_<start>_to_<end>.md`, with a header explaining what
 *      moved and confirming nothing open was lost (every backlog ID in the span should already
 *      be tracked in `docs/os/PLANNED-BACKLOG.md` — grep to confirm before cutting).
 *   3. Archive down to ARCHIVE_TARGET_RATIO of LINE_BUDGET (60%), not just under the cap, so the
 *      next normal week of entries doesn't immediately retrigger the warning.
 *   4. Leave a short pointer blockquote in STATUS.md linking to the new archive file, and keep
 *      the "## Open threads" table as the very first heading in the file.
 *   5. Re-run this test; it should pass once the file is back under budget.
 *
 * ENTRY-LENGTH CONVENTION (CONSOLIDATE3): a STATUS entry should read as ≤12 lines. Numbers and
 * full narrative belong in the relevant audit doc and the backlog row, not the running log —
 * this test does not enforce it (a single count is a blunt instrument for that), it is a norm.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_FILE = path.join(REPO_ROOT, 'docs', 'claude-code', 'STATUS.md');

// Raised by CONSOLIDATE3 (2026-09-12): 2,500 left only ~40 lines of headroom the moment
// CONSOLIDATE2's own reconcile pass landed. 3,000 restores real headroom; WARN_RATIO gives
// advance notice before the hard cap, instead of a same-day fail.
export const LINE_BUDGET = 3000;
export const WARN_RATIO = 0.8;
export const ARCHIVE_TARGET_RATIO = 0.6;

test('docs/claude-code/STATUS.md stays under its line budget', () => {
  const content = fs.readFileSync(STATUS_FILE, 'utf8');
  const lineCount = content.split('\n').length;

  assert.ok(
    lineCount <= LINE_BUDGET,
    `docs/claude-code/STATUS.md is ${lineCount} lines, over the ${LINE_BUDGET}-line budget.\n` +
      `Archive an older contiguous span verbatim to docs/history/STATUS_claude-code_<range>.md, ` +
      `down to ~${Math.round(LINE_BUDGET * ARCHIVE_TARGET_RATIO)} lines (${ARCHIVE_TARGET_RATIO * 100}% ` +
      'of budget) — see the header of this test file, or the pointer note at the top of ' +
      'STATUS.md, for the exact procedure CONSOLIDATE1/CONSOLIDATE2 used.'
  );

  const warnAt = Math.round(LINE_BUDGET * WARN_RATIO);
  if (lineCount > warnAt) {
    // eslint-disable-next-line no-console
    console.warn(
      `⚠️  docs/claude-code/STATUS.md is ${lineCount} lines, over the ${warnAt}-line ` +
        `soft-warn mark (${WARN_RATIO * 100}% of the ${LINE_BUDGET}-line budget). Plan an ` +
        'archive soon — see this test file for the procedure.'
    );
  }
});

test('the Open threads table stays findable at the top of the file', () => {
  const content = fs.readFileSync(STATUS_FILE, 'utf8');
  const lines = content.split('\n');
  const firstForty = lines.slice(0, 40).join('\n');

  assert.ok(
    firstForty.includes('## Open threads'),
    'The "## Open threads" table must appear within the first 40 lines of STATUS.md. New ' +
      'entries go BELOW the `---` that follows the table, not above it — CONSOLIDATE2/3 moved ' +
      'this table to the top specifically so a fresh session sees it before the running log.'
  );
});

test('the line budget itself is a positive number a real file could exceed', () => {
  // Positive control: prove the assertion above can actually fail, so a future edit that
  // hollows out the check (e.g. sets LINE_BUDGET to Infinity) is itself caught.
  assert.ok(Number.isFinite(LINE_BUDGET) && LINE_BUDGET > 0);
  const content = fs.readFileSync(STATUS_FILE, 'utf8');
  const lineCount = content.split('\n').length;
  assert.ok(lineCount > 0, 'STATUS.md must not be empty');
});
