/**
 * Guard: docs/claude-code/STATUS.md must stay under a line budget.
 *
 * WHY THIS EXISTS (CONSOLIDATE2, round 2, 2026-09-12)
 * STATUS.md is an append-mostly running log — CONSOLIDATE1 archived it at 8,975 lines
 * (2026-09-08), it grew back to 10,742 by 2026-09-12, and nothing in the repo failed a build
 * over it. A file nobody is forced to trim just keeps growing until a fresh session cannot
 * read it in one pass. This test is that force: it fails loudly, with the archive procedure
 * named in the assertion message, instead of letting the file silently cross 20k lines.
 *
 * THE FIX WHEN THIS GOES RED:
 * Follow the archive procedure CONSOLIDATE1/CONSOLIDATE2 already used (see the pointer note at
 * the top of STATUS.md itself, and `docs/history/STATUS_claude-code_*.md` for the convention):
 *   1. Pick a contiguous line span of OLDER entries (not necessarily a clean date boundary —
 *      STATUS.md is not strictly date-sorted; verify no needed recent entry sits inside the
 *      span before cutting).
 *   2. Move that span VERBATIM (byte-for-byte, no rewording) into a new
 *      `docs/history/STATUS_claude-code_<start>_to_<end>.md`, with a header explaining what
 *      moved and confirming nothing open was lost (every backlog ID in the span should already
 *      be tracked in `docs/os/PLANNED-BACKLOG.md` — grep to confirm before cutting).
 *   3. Leave a short pointer blockquote in STATUS.md linking to the new archive file.
 *   4. Re-run this test; it should pass once the file is back under budget.
 *
 * The budget is generous on purpose — this guards against unbounded growth, not against a
 * normal week of entries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_FILE = path.join(REPO_ROOT, 'docs', 'claude-code', 'STATUS.md');

// Generous on purpose (see header). CONSOLIDATE2 round 2 trimmed the file to ~2,350 lines;
// this leaves ample room for a normal run of entries before it must be archived again.
export const LINE_BUDGET = 2500;

test('docs/claude-code/STATUS.md stays under its line budget', () => {
  const content = fs.readFileSync(STATUS_FILE, 'utf8');
  const lineCount = content.split('\n').length;

  assert.ok(
    lineCount <= LINE_BUDGET,
    `docs/claude-code/STATUS.md is ${lineCount} lines, over the ${LINE_BUDGET}-line budget.\n` +
      'Archive an older contiguous span verbatim to docs/history/STATUS_claude-code_<range>.md ' +
      '(see the header of this test file, or the pointer note at the top of STATUS.md, for the ' +
      'exact procedure CONSOLIDATE1/CONSOLIDATE2 used) before adding more entries.'
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
