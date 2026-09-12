// BACKLOG-ids guard — docs/os/PLANNED-BACKLOG.md's row IDs must each appear exactly once.
//
// WHY THIS EXISTS (2026-09-12)
// PLANNED-BACKLOG.md is the canonical open-work list; every prompt, STATUS entry and handoff
// points into it by ID. Measured 2026-09-12: 27 IDs each appeared on MORE THAN ONE row, split
// into two failure classes needing OPPOSITE fixes — a COLLISION (one ID naming two unrelated
// issues, e.g. `SEC2` was both "wave0-config-values.txt is tracked in git" and "rotate the
// Supabase service_role key") and a RESTATEMENT (successive sessions re-writing a row instead
// of editing it in place, e.g. `MB3`/`MB4` each accreted 4 copies). Both were fixed in the same
// change this test ships with: collisions were renamed (never collapsed — an unrelated issue
// was given a fresh ID so it isn't destroyed), restatements were merged into one row keeping
// every distinct fact. See docs/claude-code/prompts/BACKLOG-ids-collisions-and-restatements.md
// for the full repair record and docs/claude-code/STATUS.md's 2026-09-12 entries.
//
// THE FIX WHEN THIS GOES RED:
//   1. Read both (or all) occurrences of the flagged ID in docs/os/PLANNED-BACKLOG.md.
//   2. Classify:
//      - Class A COLLISION (unrelated content): keep the ID on whichever row more citations
//        already point at (grep docs/, test/, code comments for the ID — count, don't guess).
//        Rename the OTHER occurrence to a free ID in its own section's series, updating every
//        citation to it in the same change, and leave a one-line pointer on the renamed row
//        ("renamed from X 2026-09-12 — collided with ...") so an old reference still resolves.
//      - Class B RESTATEMENT (the same issue re-written): merge into ONE row that keeps every
//        distinct measurement, date and caveat across the copies. If two copies disagree on a
//        number, do not silently pick one — report the disagreement and keep both readings.
//   3. If it genuinely cannot be resolved this turn, add it to DUPLICATE_ALLOWLIST below with a
//      reason and a re-measure date, per test/retired-identifiers-guard.test.mjs's convention.
//      A stale allowlist entry (past its re-measure date) is itself a test failure — this list
//      cannot be used to quietly bury a duplicate forever.
//
// ROW SHAPE, established by reading the file (not assumed): a row-defining ID is the FIRST cell
// of a markdown table row — `| <id> | body | state | source |` (some rows carry extra appended
// cells beyond these 4; that is a separate, already-filed defect — DOC-TABLE1 — and irrelevant
// here). The ID cell may carry a leading status emoji (🚨/⭐/🟡/👤/…), bold markers (`**ID**`),
// and a trailing parenthetical annotation (`ID3e (original measurement)`, `COPILOT-OPEN (was
// COPILOT-CHAT-OPEN)`) — the parenthetical is part of the identifying token (it is how the file
// already disambiguates a handful of legitimately-paired rows) and is captured, not stripped.
// A prose mention of an ID INSIDE another row's body cell — "see also SEC2", a Source column
// citation, a sentence explaining a pointer — is NOT a row and must not be counted: only cells
// at split-position 1 (the first cell after the leading `|`) are examined.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKLOG_PATH = join(ROOT, 'docs', 'os', 'PLANNED-BACKLOG.md');

// Genuine duplicates not yet resolved. Each entry names the ID, WHY it is still duplicated, and
// a re-measure date — past that date, the entry itself fails, so this cannot rot into a lie.
// Empty by design: every duplicate found 2026-09-12 was resolved in the same change that shipped
// this guard (see the file header). Add an entry here only if a genuinely new, unresolved
// duplicate is found and cannot be fixed in the same turn.
const DUPLICATE_ALLOWLIST = {
  // 'SOME-ID': { reason: '...', remeasureBy: '2026-10-15' },
};

const HEADER_CELL_NAMES = new Set(['item', 'state', 'source', 'notes', 'number', '#']);

// Matches the ID token at the start of a table row's first cell: optional leading non-word
// junk (emoji, whitespace, a leading `🚨`/`⭐`/`👤`/`🟡`/etc.), optional `**bold**` wrapping,
// the token itself (letters/digits/underscore/hyphen, must start with a letter), and an
// optional trailing parenthetical annotation that is part of the same identifying label.
const ID_CELL_RE = /^[^\w*]*(\*{0,2})([A-Za-z][A-Za-z0-9_-]{0,60})\1(\s*\([^)]*\))?[^\w]*$/u;

function parseRowIds(text) {
  const lines = text.split('\n');
  const occurrences = new Map(); // id -> [{line, raw}]
  lines.forEach((line, idx) => {
    if (!line.startsWith('|')) return;
    const cells = line.split('|');
    if (cells.length < 3) return; // need at least |id|body|
    const firstCell = cells[1].trim();
    const m = ID_CELL_RE.exec(firstCell);
    if (!m) return;
    const idText = m[2] + (m[3] ? m[3].trim() : '');
    if (HEADER_CELL_NAMES.has(idText.toLowerCase())) return;
    // Skip markdown table separator rows like |---|---|---|
    if (/^:?-{2,}:?$/.test(firstCell.replace(/\*/g, ''))) return;
    if (!occurrences.has(idText)) occurrences.set(idText, []);
    occurrences.get(idText).push({ line: idx + 1, raw: line.slice(0, 120) });
  });
  return occurrences;
}

describe('PLANNED-BACKLOG.md row IDs are unique', () => {
  const text = readFileSync(BACKLOG_PATH, 'utf8');
  const occurrences = parseRowIds(text);

  it('found a plausible number of row-defining IDs (parser sanity check)', () => {
    // A population control: if this collapses to a handful of ids, the row-shape regex broke
    // and every other assertion in this file would pass vacuously.
    assert.ok(
      occurrences.size > 400,
      `Parsed only ${occurrences.size} distinct row IDs out of docs/os/PLANNED-BACKLOG.md — ` +
      `the ID_CELL_RE row-shape pattern in this test may no longer match the file's table rows. ` +
      `Fix the pattern before trusting the uniqueness assertion below.`,
    );
  });

  it('every row ID appears on exactly one row (or is allowlisted)', () => {
    const dups = [...occurrences.entries()].filter(([id, rows]) => rows.length > 1);
    const unresolved = dups.filter(([id]) => !(id in DUPLICATE_ALLOWLIST));

    if (unresolved.length > 0) {
      const detail = unresolved
        .map(([id, rows]) => `  "${id}" appears ${rows.length}x, at line(s) ${rows.map((r) => r.line).join(', ')}`)
        .join('\n');
      assert.fail(
        `docs/os/PLANNED-BACKLOG.md has ${unresolved.length} duplicate row ID(s):\n${detail}\n\n` +
        `REPAIR PROCEDURE:\n` +
        `1. Read every occurrence of the flagged ID.\n` +
        `2. Classify it: COLLISION (unrelated content — one ID naming two different issues) or\n` +
        `   RESTATEMENT (the same issue written more than once).\n` +
        `3a. COLLISION: keep the ID on whichever row more citations already point at (grep the\n` +
        `    repo, count, don't guess). Rename the OTHER occurrence to a free ID in its own\n` +
        `    section's series, update every citation to it in the same change, and leave a\n` +
        `    one-line pointer on the renamed row.\n` +
        `3b. RESTATEMENT: merge into ONE row keeping every distinct measurement/date/caveat. If\n` +
        `    two copies disagree on a number, report the disagreement rather than silently\n` +
        `    picking one.\n` +
        `4. If it cannot be resolved this turn, add it to DUPLICATE_ALLOWLIST in this file with\n` +
        `   a reason and a re-measure date.`,
      );
    }
  });

  it('the duplicate allowlist has no stale entries', () => {
    const today = new Date().toISOString().slice(0, 10);
    const stale = Object.entries(DUPLICATE_ALLOWLIST).filter(
      ([, entry]) => entry.remeasureBy && entry.remeasureBy < today,
    );
    assert.deepEqual(
      stale,
      [],
      `DUPLICATE_ALLOWLIST in test/backlog-id-uniqueness.test.mjs has entries past their ` +
      `re-measure date: ${stale.map(([id, e]) => `${id} (due ${e.remeasureBy})`).join(', ')}. ` +
      `Re-measure each: either the duplicate is now resolved (remove the entry) or it still ` +
      `needs fixing (fix it, or extend remeasureBy with a note explaining why it is still open).`,
    );
  });

  it('the duplicate allowlist has no entries for IDs that are no longer duplicated', () => {
    const ghosts = Object.keys(DUPLICATE_ALLOWLIST).filter((id) => {
      const rows = occurrences.get(id);
      return !rows || rows.length <= 1;
    });
    assert.deepEqual(
      ghosts,
      [],
      `DUPLICATE_ALLOWLIST names ID(s) that are not (or no longer) duplicated in the file: ` +
      `${ghosts.join(', ')}. Remove the stale allowlist entry — an allowlist cannot be allowed ` +
      `to describe a problem that does not exist.`,
    );
  });

  it('does not count a prose mention inside another row as a duplicate row (positive control)', () => {
    // Build a synthetic table where "SEC2" appears once as a real row and once only in prose
    // inside a DIFFERENT row's body cell (a "see also SEC2" style cross-reference). The parser
    // must report exactly one occurrence of SEC2.
    const synthetic = [
      '| # | Item | State | Source |',
      '|---|---|---|---|',
      '| SEC2 | Rotate the key. | 🔴 | src |',
      '| OTHER | A different row that mentions SEC2 in prose, see also SEC2 for context. | 🟢 | src |',
    ].join('\n');
    const parsed = parseRowIds(synthetic);
    assert.equal(parsed.get('SEC2')?.length, 1, 'a prose mention of an ID must not be counted as a second row');
    assert.equal(parsed.get('OTHER')?.length, 1);
  });

  it('DOES flag a genuine seeded duplicate (positive control — proves the detector can fail)', () => {
    const synthetic = [
      '| # | Item | State | Source |',
      '|---|---|---|---|',
      '| DUPTEST | First occurrence. | 🔴 | src |',
      '| DUPTEST | Second, unrelated occurrence — a real collision. | 🟢 | src |',
    ].join('\n');
    const parsed = parseRowIds(synthetic);
    assert.equal(parsed.get('DUPTEST')?.length, 2, 'the parser must detect two real row occurrences of one ID');
  });
});
