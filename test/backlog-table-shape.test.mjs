/**
 * Guard: docs/os/PLANNED-BACKLOG.md tables must not get structurally worse.
 *
 * WHY THIS EXISTS (DOC-TABLE1, 2026-09-12)
 * PLANNED-BACKLOG.md is the repo's answer to "what is intended work?", and a future session
 * reads it to decide what to do next. Two defects were measured in it on 2026-09-12, both
 * produced by the same habit: recording an update by APPENDING NEW CELLS to the right of an
 * existing row instead of editing the row in place.
 *
 *   1. WRONG-WIDTH ROWS (45 measured). Markdown renders only as many cells as the header
 *      declares. Every cell past the 4th is dropped from the rendered table — and the cell
 *      that gets appended is almost always the live-verification result, i.e. the most
 *      current fact in the row. The row looks complete in the raw file and reads as stale
 *      in the rendered one.
 *
 *   2. DUPLICATE IDs (17 measured). The same item ID appears two or three times, each copy
 *      a different snapshot of its history, so a reader takes whichever they scroll to
 *      first. MB2a/MB3/MB4 were deduplicated by hand on 2026-09-12 and were RE-INTRODUCED
 *      within the hour: a concurrent branch had edited its own copies, so the merge kept
 *      both sides and git reported no conflict. That is the real lesson here — with several
 *      sessions editing this file at once, a one-time cleanup does not hold. Only a guard
 *      that fails the build holds.
 *
 * WHY A RATCHET AND NOT A CLEAN ASSERTION
 * The 45 + 17 existing violations cannot be fixed mechanically: the duplicate copies differ
 * in content, so choosing a survivor is a judgment call per row. Asserting zero today would
 * mean either a red suite for everyone or a rushed merge that loses real facts. So the
 * baselines below are the MEASURED CURRENT STATE and may only ever go DOWN. New damage
 * fails immediately; existing damage gets paid off row by row, each payment lowering the
 * baseline so it can never come back.
 *
 * THE FIX WHEN THIS GOES RED:
 *   - Wrong width: do not add a column. Fold the new information INTO the existing Item
 *     cell (and update the State cell), which is what the 4-column header promises.
 *   - Duplicate ID: merge the copies into one row, keeping every fact from each, and delete
 *     the others. If a merge re-introduced a copy, resolve it by merging content rather than
 *     keeping both rows.
 *   - Then LOWER the baseline constant below to the new measured count, in the same commit.
 *     A fix that leaves the baseline high is not a fix; it just buys room for new damage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKLOG_FILE = path.join(REPO_ROOT, 'docs', 'os', 'PLANNED-BACKLOG.md');

// Measured against the committed file on 2026-09-12 (DOC-TABLE1). RATCHET: may only DECREASE.
// 2026-09-12: duplicates 17 -> 14 after PR #2405 merged three restated rows. Baseline lowered
// to match, per the rule below: a fix that leaves the baseline high just buys room for new damage.
// Lower these in the same commit that fixes rows. Never raise them to make a build pass —
// raising one is the exact failure this guard exists to prevent.
export const WRONG_WIDTH_BASELINE = 39;
export const DUPLICATE_ID_BASELINE = 0;

// DOC-TABLE2 (2026-09-15). Measured on the committed file: raw `|` characters inside code spans
// within table rows. GFM requires a pipe to be escaped EVEN INSIDE a code span, so each of these
// splits the row into an extra cell when GitHub renders it — the row looks fine in the raw file and
// renders as a broken table. RATCHET: may only DECREASE. Fix by writing `\\|` inside the code span.
export const UNESCAPED_PIPE_BASELINE = 25;

// DOC-TABLE3 (2026-09-15). Lines that LOOK like table rows (they start with `|`) but belong to no
// table, because a stray blank line split the table in two or the row was prepended ABOVE its own
// header. GitHub renders them as literal text, not a table — and, worse, THIS GUARD CANNOT SEE
// THEM AT ALL: every detector above iterates parsed tables, so an orphaned row is silently exempt
// from the width, duplicate-ID and pipe-escaping checks. 27 such rows were found on 2026-09-15
// (spans of 2, 13 and 12), including DOC-TABLE1's and DOC-TABLE2's own rows. That is I11 applied
// to a doc guard: a monitor must alert on its own blindness. Fixed to zero in the same commit, and
// this baseline is 0 because there is no judgment call here — the fix is mechanical.
export const ORPHAN_ROW_BASELINE = 0;

/**
 * Split a markdown table row into cells, ignoring pipes inside `code spans` and escaped
 * pipes. The backlog is full of cells like `a|b` in code, so a naive split miscounts.
 */
export function splitCells(line) {
  const out = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode && line[i - 1] !== '\\') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  // Leading/trailing pipes produce empty edge cells; they are delimiters, not columns.
  if (out.length && out[0].trim() === '') out.shift();
  if (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

/**
 * Find raw, unescaped `|` characters inside code spans on a table row (DOC-TABLE2).
 *
 * WHY THIS IS A SEPARATE DETECTOR AND NOT A FIX TO splitCells:
 * splitCells is deliberately backtick-aware so that column COUNTING is not thrown off by code
 * containing pipes. GitHub's renderer is not: GFM splits the row on that pipe regardless of the
 * code span. So the guard and the renderer disagree about what a cell boundary is, and the guard
 * is the MORE PERMISSIVE of the two — it passes rows GitHub renders as broken tables. Making
 * splitCells renderer-accurate would fix the disagreement in the wrong direction (every such row
 * would report as wrong-width, hiding the real cause). Naming the defect directly is what tells a
 * future session what to actually type: escape the pipe.
 */
export function unescapedPipesInCodeSpans(line) {
  const hits = [];
  const re = /`([^`]*)`/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const body = m[1];
    for (let k = 0; k < body.length; k++) {
      if (body[k] === '|' && (k === 0 || body[k - 1] !== '\\')) {
        hits.push(body);
        break;
      }
    }
  }
  return hits;
}

const isSeparatorRow = (line) =>
  line.includes('-') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line);

/** Parse every markdown table: a header row immediately followed by a |---|---| separator. */
export function parseTables(text) {
  const lines = text.split('\n');
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    const isHeader =
      lines[i].trim().startsWith('|') &&
      i + 1 < lines.length &&
      isSeparatorRow(lines[i + 1]);
    if (!isHeader) continue;

    const columns = splitCells(lines[i]).length;
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      rows.push({ line: j + 1, cells: splitCells(lines[j]) });
    }
    tables.push({ headerLine: i + 1, columns, rows });
    i = j - 1;
  }
  return tables;
}

function analyze(text) {
  const tables = parseTables(text);
  // DOC-TABLE3: any `|`-leading line the parser did not attribute to a table.
  const claimed = new Set();
  for (const t of tables) {
    claimed.add(t.headerLine);
    claimed.add(t.headerLine + 1);
    for (const r of t.rows) claimed.add(r.line);
  }
  const orphanRows = [];
  text.split('\n').forEach((l, i) => {
    if (l.trim().startsWith('|') && !claimed.has(i + 1)) {
      orphanRows.push(`  line ${i + 1}: "${l.replace(/[*~`|]/g, '').trim().slice(0, 50)}"`);
    }
  });
  const wrongWidth = [];
  const duplicateIds = [];
  const unescapedPipes = [];
  for (const table of tables) {
    const seen = new Map();
    for (const row of table.rows) {
      for (const span of unescapedPipesInCodeSpans(row.cells.join('|'))) {
        unescapedPipes.push(`  line ${row.line}: \`${span.slice(0, 60)}\``);
      }
      if (row.cells.length !== table.columns) {
        wrongWidth.push(
          `  line ${row.line}: ${row.cells.length} cells, header declares ${table.columns}` +
            ` — "${row.cells[0].replace(/[*~`]/g, '').trim().slice(0, 40)}"`
        );
      }
      const id = row.cells[0].replace(/[*~`]/g, '').trim();
      if (!id) continue;
      if (seen.has(id)) {
        duplicateIds.push(`  "${id}" at lines ${seen.get(id)} and ${row.line}`);
      } else {
        seen.set(id, row.line);
      }
    }
  }
  return { tables, wrongWidth, duplicateIds, unescapedPipes, orphanRows };
}

const read = () => fs.readFileSync(BACKLOG_FILE, 'utf8');

test('PLANNED-BACKLOG.md rows match their table header width (ratchet)', () => {
  const { wrongWidth } = analyze(read());
  assert.ok(
    wrongWidth.length <= WRONG_WIDTH_BASELINE,
    `PLANNED-BACKLOG.md has ${wrongWidth.length} rows whose cell count differs from their ` +
      `table header, above the ratchet baseline of ${WRONG_WIDTH_BASELINE}.\n\n` +
      `Markdown DROPS every cell past the header width when rendering, and the dropped cell ` +
      `is usually the live-verification result — the most current fact in the row.\n\n` +
      `Fix: fold the new information into the existing Item cell and update the State cell. ` +
      `Do not add a column.\n\n${wrongWidth.join('\n')}`
  );
});

test('PLANNED-BACKLOG.md has no new duplicate item IDs (ratchet)', () => {
  const { duplicateIds } = analyze(read());
  assert.ok(
    duplicateIds.length <= DUPLICATE_ID_BASELINE,
    `PLANNED-BACKLOG.md has ${duplicateIds.length} duplicate item IDs, above the ratchet ` +
      `baseline of ${DUPLICATE_ID_BASELINE}.\n\n` +
      `Each copy is a different snapshot of the item's history, so a reader takes whichever ` +
      `they scroll to first. This commonly arrives via a MERGE: two branches each edited ` +
      `their own copy of a row, so git kept both sides without reporting a conflict.\n\n` +
      `Fix: merge the copies into one row keeping every fact, delete the others, and lower ` +
      `DUPLICATE_ID_BASELINE in the same commit.\n\n${duplicateIds.join('\n')}`
  );
});

test('PLANNED-BACKLOG.md escapes pipes inside code spans (ratchet)', () => {
  const { unescapedPipes } = analyze(read());
  assert.ok(
    unescapedPipes.length <= UNESCAPED_PIPE_BASELINE,
    `PLANNED-BACKLOG.md has ${unescapedPipes.length} table rows with a raw \`|\` inside a code ` +
      `span, above the ratchet baseline of ${UNESCAPED_PIPE_BASELINE}.\n\n` +
      `GFM requires a pipe to be escaped EVEN INSIDE a code span. GitHub splits the row on it, so ` +
      `the row renders as a broken table while looking correct in the raw file — and this guard's ` +
      `own column counter is backtick-aware, so it cannot see the defect.\n\n` +
      `Fix: write \\| inside the code span, then lower UNESCAPED_PIPE_BASELINE in the same ` +
      `commit.\n\n${unescapedPipes.join('\n')}`
  );
});

test('PLANNED-BACKLOG.md has no orphaned table rows (ratchet)', () => {
  const { orphanRows } = analyze(read());
  assert.ok(
    orphanRows.length <= ORPHAN_ROW_BASELINE,
    `PLANNED-BACKLOG.md has ${orphanRows.length} lines that start with \`|\` but belong to no ` +
      `table, above the baseline of ${ORPHAN_ROW_BASELINE}.\n\n` +
      `GitHub renders these as literal text rather than table rows — AND every other check in ` +
      `this file iterates parsed tables, so an orphaned row is invisible to the width, ` +
      `duplicate-ID and pipe-escaping guards too. A row can therefore be doubly broken and ` +
      `silently pass.\n\n` +
      `Cause is almost always one of two things: a stray BLANK LINE inside a table (delete it), ` +
      `or a row prepended ABOVE its own header (move it below the |---| separator).\n\n` +
      `${orphanRows.join('\n')}`
  );
});

test('the ratchet baselines are finite and the parser actually finds tables', () => {
  // Positive control: prove the assertions above can fail, so an edit that hollows out the
  // check (baseline set to Infinity, or a parser change that silently finds nothing) is caught.
  assert.ok(Number.isFinite(WRONG_WIDTH_BASELINE) && WRONG_WIDTH_BASELINE >= 0);
  assert.ok(Number.isFinite(DUPLICATE_ID_BASELINE) && DUPLICATE_ID_BASELINE >= 0);
  assert.ok(Number.isFinite(UNESCAPED_PIPE_BASELINE) && UNESCAPED_PIPE_BASELINE >= 0);
  assert.ok(Number.isFinite(ORPHAN_ROW_BASELINE) && ORPHAN_ROW_BASELINE >= 0);

  const { tables } = analyze(read());
  assert.ok(tables.length > 10, `expected many tables in the backlog, found ${tables.length}`);
  const rowCount = tables.reduce((sum, t) => sum + t.rows.length, 0);
  assert.ok(rowCount > 100, `expected hundreds of backlog rows, found ${rowCount}`);
});

test('the detectors fire on known-bad fixtures', () => {
  // Positive control on the detectors themselves, independent of the real file.
  const tooWide = ['| # | Item |', '|---|---|', '| A | ok |', '| B | one | two |'].join('\n');
  assert.equal(analyze(tooWide).wrongWidth.length, 1);

  const duped = ['| # | Item |', '|---|---|', '| A | first |', '| A | second |'].join('\n');
  assert.equal(analyze(duped).duplicateIds.length, 1);

  const clean = ['| # | Item |', '|---|---|', '| A | ok |', '| B | ok |'].join('\n');
  assert.equal(analyze(clean).wrongWidth.length, 0);
  assert.equal(analyze(clean).duplicateIds.length, 0);

  // A pipe inside a code span must not be counted as a cell delimiter for WIDTH purposes...
  const codePipe = ['| # | Item |', '|---|---|', '| A | `a|b` |'].join('\n');
  assert.equal(analyze(codePipe).wrongWidth.length, 0);
  // ...but it IS a rendering defect, and the DOC-TABLE2 detector must say so. These two
  // assertions on the same fixture are the point: the guard and GitHub disagree, and the
  // disagreement is now named rather than silently tolerated.
  assert.equal(analyze(codePipe).unescapedPipes.length, 1);

  // Negative control: an ESCAPED pipe inside a code span renders correctly and must not fire.
  const escaped = ['| # | Item |', '|---|---|', '| A | `a\\|b` |'].join('\n');
  assert.equal(analyze(escaped).unescapedPipes.length, 0);
  assert.equal(analyze(escaped).wrongWidth.length, 0);

  // Negative control: a pipe OUTSIDE any code span is an ordinary delimiter, not this defect.
  const plain = ['| # | Item |', '|---|---|', '| A | ok |'].join('\n');
  assert.equal(analyze(plain).unescapedPipes.length, 0);
  assert.equal(analyze(plain).orphanRows.length, 0);

  // DOC-TABLE3 positive controls: a blank line splitting a table, and a row above its header.
  const split = ['| # | Item |', '|---|---|', '| A | ok |', '', '| B | ok |'].join('\n');
  assert.equal(analyze(split).orphanRows.length, 1);
  const aboveHeader = ['| B | early |', '| # | Item |', '|---|---|', '| A | ok |'].join('\n');
  assert.equal(analyze(aboveHeader).orphanRows.length, 1);

  // And the point of the whole detector: an orphaned row is invisible to the other checks.
  const hiddenDupe = ['| # | Item |', '|---|---|', '| A | ok |', '', '| A | dupe |'].join('\n');
  assert.equal(analyze(hiddenDupe).duplicateIds.length, 0);
  assert.equal(analyze(hiddenDupe).orphanRows.length, 1);
});
