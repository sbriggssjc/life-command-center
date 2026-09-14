/**
 * Guard: docs/claude-code/STATUS.md must keep its H1 on line 1, exactly once.
 *
 * WHY THIS EXISTS (2026-09-12)
 * STATUS.md is newest-first, so every session prepends. Five separate sessions in a single day
 * prepended ABOVE the `# Claude Code queue — STATUS` H1, burying it at lines 25, 29, 57, 83 and
 * 212 and twice leaving a DUPLICATE H1 stranded mid-file. Each burial was repaired by hand, and
 * each repair was followed by another burial — including one after a prose CONVENTION note was
 * added to the top of the file saying not to do it. A convention nobody is forced to read is not
 * a convention; this test is the force.
 *
 * Why it matters beyond tidiness: a reader (human or agent) opening STATUS.md lands on whatever
 * is at line 1. With the H1 buried, the first thing they see is one arbitrary entry with no
 * indication that it is the newest of ~74, no line budget note, and no archive pointer — so they
 * prepend blindly too, and the failure compounds.
 *
 * THE FIX WHEN THIS GOES RED:
 *   1. Delete any `# Claude Code queue — STATUS` line that is NOT line 1. Do not add another.
 *   2. Move the H1 (and the HTML convention comment block that follows it) back to the top.
 *   3. Put your new entry DIRECTLY BELOW that block, not above it.
 * Nothing needs to be reworded or removed — a burial is a placement bug, never a content one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_FILE = path.join(REPO_ROOT, 'docs', 'claude-code', 'STATUS.md');
export const H1 = '# Claude Code queue — STATUS';

test('STATUS.md H1 is on line 1', () => {
  const lines = fs.readFileSync(STATUS_FILE, 'utf8').split('\n');
  assert.equal(
    lines[0].trim(), H1,
    `docs/claude-code/STATUS.md line 1 is ${JSON.stringify(lines[0].slice(0, 80))}, not the H1.\n` +
    `An entry was prepended ABOVE the header. Move "${H1}" (and the convention comment block\n` +
    `beneath it) back to the top, then put new entries DIRECTLY BELOW that block.`,
  );
});

test('STATUS.md has exactly one H1 (no burial leftovers)', () => {
  const lines = fs.readFileSync(STATUS_FILE, 'utf8').split('\n');
  const at = lines.reduce((acc, l, i) => (l.trim() === H1 ? acc.concat(i + 1) : acc), []);
  assert.deepEqual(
    at, [1],
    `docs/claude-code/STATUS.md has ${at.length} copies of its H1, at line(s) ${at.join(', ')}.\n` +
    `Exactly one must exist, on line 1. Delete the stray copies — they are leftovers from a\n` +
    `session prepending above the header; do not add another.`,
  );
});

test('STATUS.md keeps its prepend-convention block directly under the H1', () => {
  const head = fs.readFileSync(STATUS_FILE, 'utf8').split('\n').slice(0, 6).join('\n');
  assert.ok(
    head.includes('<!--') && /CONVENTION/i.test(head),
    'The HTML convention comment block is missing from the top of docs/claude-code/STATUS.md.\n' +
    'It tells the next session where to prepend and how to archive; restore it under the H1.',
  );
});
